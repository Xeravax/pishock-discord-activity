using System.Text.Json;
using PiShock.Activity.Server.Data;
using PiShock.Activity.Server.Operate;
using PiShock.Activity.Server.PiShock;
using PiShock.Activity.Server.Realtime;
using PiShock.Activity.Server.Security;

namespace PiShock.Activity.Server.Endpoints;

/// <summary>Port of src/server/routes/activity-share.ts (uses <see cref="ShareHelpers"/> for limits/serialization).</summary>
public static class ActivityShareEndpoints
{
    public static IEndpointRouteBuilder MapActivityShareEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapActivityApi();

        api.MapGet("/activity/share", GetShareAsync).WithName("GetActivityShare").WithTags("ActivityShare");
        api.MapGet("/activity/settings", GetSettingsAsync).WithName("GetActivitySettings").WithTags("ActivityShare");
        api.MapPut("/activity/settings", PutSettingsAsync).WithName("UpdateActivitySettings").WithTags("ActivityShare");
        api.MapPut("/activity/share", PutShareAsync).WithName("UpdateActivityShare").WithTags("ActivityShare");

        return app;
    }

    // ───────────────────────── routes ─────────────────────────

    private static async Task<IResult> GetShareAsync(HttpContext ctx, SessionStore sessions)
    {
        var blocked = ControlGuards.RequireSession(ctx);
        if (blocked is not null) return blocked;

        var userId = ctx.DiscordUser().Id;
        var ct = ctx.RequestAborted;

        // Same scoped DbContext: queries must run one after another.
        var shares = await sessions.ListActivitySharesAsync(userId, ct);
        var bans = await sessions.ListActivityBansAsync(userId, ct);
        var personal = await sessions.GetPersonalActivityLimitsAsync(userId, ct);

        return ApiResults.Json(new
        {
            shares = shares.Select(SerializeShare).ToList(),
            bannedDiscordUserIds = bans.Select(b => b.BannedDiscordUserId).ToList(),
            available = shares.Any(s => s.Enabled && !s.Paused),
            personal = ApiResults.Personal(personal),
        });
    }

    private static async Task<IResult> GetSettingsAsync(HttpContext ctx, SessionStore sessions)
    {
        var blocked = ControlGuards.RequireSession(ctx);
        if (blocked is not null) return blocked;

        var userId = ctx.DiscordUser().Id;
        var ct = ctx.RequestAborted;

        var shares = await sessions.ListActivitySharesAsync(userId, ct);
        var personal = await sessions.GetPersonalActivityLimitsAsync(userId, ct);

        return ApiResults.Json(new
        {
            personal = ApiResults.Personal(personal),
            shares = shares.Select(SerializeShare).ToList(),
        });
    }

    private static async Task<IResult> PutSettingsAsync(
        HttpContext ctx,
        ActivitySettingsRequest? body,
        PiShockApiClient api,
        SessionStore sessions,
        RealtimeHub hub)
    {
        var blocked = ControlGuards.RequireSession(ctx);
        if (blocked is not null) return blocked;

        body ??= new ActivitySettingsRequest();
        var userId = ctx.DiscordUser().Id;
        var creds = ctx.PiShockCreds()!;
        var ct = ctx.RequestAborted;

        if (body.Personal is not null)
        {
            await sessions.SetPersonalActivityLimitsAsync(
                userId,
                body.Personal.ActivityMaxIntensity,
                body.Personal.ActivityMaxDurationMs,
                ct);
        }

        var existing = await sessions.ListActivitySharesAsync(userId, ct);
        var shares = existing;
        if (body.Shares is not null)
        {
            var normalized = await NormalizeAllAsync(body.Shares, existing, creds, api, ct);
            if (normalized.Error is not null)
            {
                return ApiResults.Error(400, normalized.Error);
            }
            shares = await sessions.ReplaceActivitySharesAsync(userId, normalized.Rows, ct);
        }

        if (body.BannedDiscordUserIds is not null)
        {
            await sessions.ReplaceActivityBansAsync(userId, CleanBanIds(body.BannedDiscordUserIds, userId), ct);
        }

        var personal = await sessions.GetPersonalActivityLimitsAsync(userId, ct);
        hub.BroadcastAll(RealtimeEvents.ActivityShareChanged(userId));
        return ApiResults.Json(new
        {
            personal = ApiResults.Personal(personal),
            shares = shares.Select(SerializeShare).ToList(),
        });
    }

    private static async Task<IResult> PutShareAsync(
        HttpContext ctx,
        ActivityShareRequest? body,
        PiShockApiClient api,
        SessionStore sessions,
        RealtimeHub hub)
    {
        var blocked = ControlGuards.RequireSession(ctx);
        if (blocked is not null) return blocked;

        body ??= new ActivityShareRequest();
        var userId = ctx.DiscordUser().Id;
        var creds = ctx.PiShockCreds()!;
        var ct = ctx.RequestAborted;

        var existing = await sessions.ListActivitySharesAsync(userId, ct);
        var normalized = await NormalizeAllAsync(body.Shares ?? [], existing, creds, api, ct);
        if (normalized.Error is not null)
        {
            return ApiResults.Error(400, normalized.Error);
        }

        var shares = await sessions.ReplaceActivitySharesAsync(userId, normalized.Rows, ct);
        var bans = await sessions.ListActivityBansAsync(userId, ct);
        if (body.BannedDiscordUserIds is not null)
        {
            bans = await sessions.ReplaceActivityBansAsync(userId, CleanBanIds(body.BannedDiscordUserIds, userId), ct);
        }

        hub.BroadcastAll(RealtimeEvents.ActivityShareChanged(userId));
        return ApiResults.Json(new
        {
            shares = shares.Select(SerializeShare).ToList(),
            bannedDiscordUserIds = bans.Select(b => b.BannedDiscordUserId).ToList(),
            available = shares.Any(s => s.Enabled && !s.Paused),
        });
    }

    /// <summary>Drops empty ids and the owner themselves (you cannot ban yourself).</summary>
    private static List<string> CleanBanIds(IEnumerable<string> ids, string ownerId) =>
        ids.Where(id => !string.IsNullOrEmpty(id) && id != ownerId).ToList();

    // ───────────────────────── normalization ─────────────────────────

    private static async Task<(List<ActivityShareInput> Rows, string? Error)> NormalizeAllAsync(
        IEnumerable<IncomingShare> incoming,
        List<ActivityShare> existing,
        PiShockCreds creds,
        PiShockApiClient api,
        CancellationToken ct)
    {
        // Map semantics: the last row for a shocker wins
        var existingByShocker = new Dictionary<int, ActivityShare>();
        foreach (var share in existing) existingByShocker[share.ShockerId] = share;

        var rows = new List<ActivityShareInput>();
        foreach (var share in incoming)
        {
            ActivityShare? prev = null;
            if (share.ShockerId is { } id) existingByShocker.TryGetValue(id, out prev);

            var (row, error) = await NormalizeShareRowAsync(share, prev, creds, api, ct);
            if (row is null)
            {
                return ([], error);
            }
            rows.Add(row);
        }
        return (rows, null);
    }

    private static async Task<(ActivityShareInput? Row, string? Error)> NormalizeShareRowAsync(
        IncomingShare s,
        ActivityShare? prev,
        PiShockCreds creds,
        PiShockApiClient api,
        CancellationToken ct)
    {
        if (s.ShockerId is not { } shockerId || shockerId <= 0)
        {
            return (null, "Each share requires a valid shockerId");
        }

        var ceilings = await OperatePolicy.ResolveDeviceCeilingsFromPiShockAsync(
            creds,
            shockerId,
            c => api.FetchControlSnapshotAsync(c, ct));

        var deviceMaxIntensity = ceilings.Found
            ? ceilings.DeviceMaxIntensity
            : Math.Max(
                1,
                Math.Min(OperatePolicy.AbsMaxIntensity, prev?.DeviceMaxIntensity ?? OperatePolicy.AbsMaxIntensity));
        var deviceMaxDurationMs = ceilings.Found
            ? ceilings.DeviceMaxDurationMs
            : Math.Max(
                OperatePolicy.AbsMinDurationMs,
                Math.Min(
                    OperatePolicy.AbsMaxDurationMs,
                    prev?.DeviceMaxDurationMs ?? OperatePolicy.AbsMaxDurationMs));
        // Prefer live PiShock hub id; fall back to previously stored value only
        var hubClientId = ceilings.HubClientId ?? prev?.HubClientId;

        var canShock = s.CanShock != false;
        var canVibrate = s.CanVibrate != false;
        var canBeep = s.CanBeep != false;
        var canHold = s.CanHold != false;

        var (maxIntensity, maxDurationMs) = ShareHelpers.ClampShareLimits(
            deviceMaxIntensity,
            deviceMaxDurationMs,
            requestedMaxIntensity: s.MaxIntensity,
            requestedMaxDurationMs: s.MaxDurationMs,
            previousMaxIntensity: prev?.MaxIntensity,
            previousMaxDurationMs: prev?.MaxDurationMs);

        // Never accept a client-supplied share code — only keep prior server-created codes
        var shareCode = ShareHelpers.RetainedShareCode(prev?.ShareCode, s.ShareCode);
        var capsChanged =
            string.IsNullOrEmpty(shareCode)
            || (prev is not null
                && (prev.MaxIntensity != maxIntensity
                    || prev.MaxDurationMs != maxDurationMs
                    || prev.CanShock != canShock
                    || prev.CanVibrate != canVibrate
                    || prev.CanBeep != canBeep));

        if (string.IsNullOrEmpty(shareCode) || capsChanged)
        {
            try
            {
                var created = await api.CreateShareAsync(
                    creds,
                    new Dictionary<string, object?>
                    {
                        ["ShockerId"] = shockerId,
                        ["MaxIntensity"] = maxIntensity,
                        ["MaxDuration"] = Math.Max(
                            1,
                            Math.Min(15, (int)Math.Round(maxDurationMs / 1000.0, MidpointRounding.AwayFromZero))),
                        ["CanShock"] = canShock,
                        ["CanVibrate"] = canVibrate,
                        ["CanBeep"] = canBeep,
                    },
                    ct);
                var nextCode = ExtractShareCode(created.Data);
                if (nextCode is not null) shareCode = nextCode;
            }
            catch (Exception) when (!ct.IsCancellationRequested)
            {
                // Fall back to target-session OperateById when share creation fails
            }
        }

        var name = !string.IsNullOrEmpty(s.ShockerName)
            ? s.ShockerName
            : !string.IsNullOrEmpty(prev?.ShockerName)
                ? prev.ShockerName
                : $"Shocker {shockerId}";

        return (
            new ActivityShareInput
            {
                ShockerId = shockerId,
                ShockerName = name.Length > 120 ? name[..120] : name,
                HubClientId = hubClientId,
                ShareCode = shareCode,
                DeviceMaxIntensity = deviceMaxIntensity,
                DeviceMaxDurationMs = deviceMaxDurationMs,
                Enabled = s.Enabled != false,
                Paused = s.Paused == true,
                MaxIntensity = maxIntensity,
                MaxDurationMs = maxDurationMs,
                CanShock = canShock,
                CanVibrate = canVibrate,
                CanBeep = canBeep,
                CanHold = canHold,
            },
            null);
    }

    /// <summary>Finds a share code in a PiShock create-share response (object, or first match in an array).</summary>
    private static string? ExtractShareCode(JsonElement? data)
    {
        if (data is not { } value) return null;

        if (value.ValueKind == JsonValueKind.Object)
        {
            foreach (var key in new[] { "ShareCode", "shareCode", "Code", "code" })
            {
                if (value.TryGetProperty(key, out var direct)
                    && direct.ValueKind == JsonValueKind.String
                    && !string.IsNullOrWhiteSpace(direct.GetString()))
                {
                    return direct.GetString()!.Trim();
                }
            }
            return null;
        }

        if (value.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in value.EnumerateArray())
            {
                var found = ExtractShareCode(item);
                if (found is not null) return found;
            }
        }
        return null;
    }

    /// <summary>API responses expose presence of a share code, never the raw capability string.</summary>
    private static object SerializeShare(ActivityShare s) =>
        ShareHelpers.SerializeShare(
            s.ShockerId,
            s.ShockerName,
            s.HubClientId,
            s.ShareCode,
            s.DeviceMaxIntensity,
            s.DeviceMaxDurationMs,
            s.Enabled,
            s.Paused,
            s.MaxIntensity,
            s.MaxDurationMs,
            s.CanShock,
            s.CanVibrate,
            s.CanBeep,
            s.CanHold);
}

// ───────────────────────── request bodies ─────────────────────────

public sealed class IncomingShare
{
    public int? ShockerId { get; set; }
    public string? ShockerName { get; set; }
    public string? HubClientId { get; set; }

    /// <summary>Ignored — share codes are only ever created server-side.</summary>
    public string? ShareCode { get; set; }

    public double? DeviceMaxIntensity { get; set; }
    public double? DeviceMaxDurationMs { get; set; }
    public bool? Enabled { get; set; }
    public bool? Paused { get; set; }
    public double? MaxIntensity { get; set; }
    public double? MaxDurationMs { get; set; }
    public bool? CanShock { get; set; }
    public bool? CanVibrate { get; set; }
    public bool? CanBeep { get; set; }
    public bool? CanHold { get; set; }
}

public sealed class PersonalLimitsRequest
{
    public int? ActivityMaxIntensity { get; set; }
    public int? ActivityMaxDurationMs { get; set; }
}

public sealed class ActivitySettingsRequest
{
    public PersonalLimitsRequest? Personal { get; set; }
    public List<IncomingShare>? Shares { get; set; }
    public List<string>? BannedDiscordUserIds { get; set; }
}

public sealed class ActivityShareRequest
{
    public List<IncomingShare>? Shares { get; set; }
    public List<string>? BannedDiscordUserIds { get; set; }
}
