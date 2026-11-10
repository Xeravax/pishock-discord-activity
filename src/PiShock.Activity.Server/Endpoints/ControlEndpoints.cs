using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using System.Text.Json;
using PiShock.Activity.Server.Data;
using PiShock.Activity.Server.Discord;
using PiShock.Activity.Server.Operate;
using PiShock.Activity.Server.PiShock;
using PiShock.Activity.Server.Realtime;
using PiShock.Activity.Server.Security;
using PiShock.Activity.Server.Shared;
using OperatePolicyError = PiShock.Activity.Server.Operate.OperatePolicy.OperatePolicyError;

namespace PiShock.Activity.Server.Endpoints;

/// <summary>Port of src/server/routes/control.ts.</summary>
public static class ControlEndpoints
{
    public static IEndpointRouteBuilder MapControlEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapActivityApi();

        api.MapGet("/devices", ListDevicesAsync).WithName("ListDevices").WithTags("Control");
        api.MapPut("/emergency-stop", SetEmergencyStopAsync).WithName("SetEmergencyStop").WithTags("Control");
        api.MapPost("/operate", OperateAsync).WithName("Operate").WithTags("Control");
        api.MapPost("/pause", PauseAsync).WithName("Pause").WithTags("Control");
        api.MapGet("/links", ListLinksAsync).WithName("ListLinks").WithTags("Control");
        api.MapPost("/links", CreateLinkAsync).WithName("CreateLink").WithTags("Control");
        api.MapDelete("/links/{linkId}", DeleteLinkAsync).WithName("DeleteLink").WithTags("Control");
        api.MapPost("/shares", CreateShareAsync).WithName("CreateShare").WithTags("Control");
        api.MapPut("/shares", ClaimShareAsync).WithName("ClaimShare").WithTags("Control");
        api.MapDelete("/shares/{shareId}", DeleteShareAsync).WithName("DeleteShare").WithTags("Control");
        api.MapGet("/logs", ListLogsAsync).WithName("ListLogs").WithTags("Control");
        api.MapGet("/broker/status", GetBrokerStatusAsync).WithName("GetBrokerStatus").WithTags("Control");

        return app;
    }

    // ───────────────────────── devices ─────────────────────────

    private static async Task<IResult> ListDevicesAsync(
        HttpContext ctx,
        PiShockApiClient api,
        SessionStore sessions,
        BrokerService broker)
    {
        var blocked = ControlGuards.RequireSession(ctx);
        if (blocked is not null) return blocked;

        var user = ctx.DiscordUser();
        try
        {
            var snapshot = await api.FetchControlSnapshotAsync(ctx.PiShockCreds()!, ctx.RequestAborted);
            return ApiResults.Json(new
            {
                hubs = snapshot.Hubs,
                shockers = snapshot.Shockers,
                shared = snapshot.Shared,
                links = snapshot.Links,
                online = broker.GetOnlineMap(user.Id),
            });
        }
        catch (PiShockApiError err)
        {
            return await ControlGuards.PiShockErrorAsync(err, user.Id, sessions);
        }
    }

    // ───────────────────────── emergency stop ─────────────────────────

    /// <summary>
    /// Owner kill-switch latch. Engaged = cut current op + reject all further commands for this shocker
    /// (including Discord Shockers) until the owner releases it.
    /// </summary>
    private static async Task<IResult> SetEmergencyStopAsync(
        HttpContext ctx,
        EmergencyStopRequest? body,
        PiShockApiClient api,
        SessionStore sessions,
        BrokerService broker,
        RealtimeHub hub)
    {
        var blocked = ControlGuards.RequireSession(ctx);
        if (blocked is not null) return blocked;

        body ??= new EmergencyStopRequest();
        var user = ctx.DiscordUser();

        if (body.ShockerId is not { } shockerIdRaw || !double.IsFinite(shockerIdRaw) || shockerIdRaw <= 0)
        {
            return ApiResults.Error(400, "shockerId required");
        }
        if (body.Engaged is not { } engaged)
        {
            return ApiResults.Error(400, "engaged boolean required");
        }
        var shockerId = (int)shockerIdRaw;

        var creds = ctx.PiShockCreds()!;
        ControlSnapshot snapshot;
        try
        {
            snapshot = await api.FetchControlSnapshotAsync(creds, ctx.RequestAborted);
        }
        catch (PiShockApiError err)
        {
            return await ControlGuards.PiShockErrorAsync(err, user.Id, sessions);
        }

        var shockerRow = OperatePolicy.FindShockerInSnapshot(snapshot, shockerId);
        if (shockerRow is null)
        {
            return ApiResults.Error(404, "Shocker not found on this PiShock account");
        }

        var clientId = OperatePolicy.VerifyOwnedClientId(snapshot, body.ClientId) ?? RowClientId(shockerRow.Value);

        if (engaged && !string.IsNullOrEmpty(clientId))
        {
            OperatePolicy.ClearHoldAutoEnd(user.Id, shockerId);
            await broker.PublishOperateAsync(
                creds,
                OperateSupport.EndInput(clientId, shockerId, shareCode: null, agentName: "Emergency Stop"),
                ctx.RequestAborted);
        }

        var result = await sessions.SetEmergencyStopAsync(user.Id, shockerId, engaged, ctx.RequestAborted);
        await sessions.LogCommandAsync(
            new CommandLogInput
            {
                DiscordUserId = user.Id,
                Action = engaged ? "emergency_stop_on" : "emergency_stop_off",
                ShockerId = shockerId,
                Intensity = 0,
                DurationMs = 0,
                Success = true,
                Detail = engaged ? "latched" : "released",
            },
            ctx.RequestAborted);
        hub.BroadcastAll(RealtimeEvents.EmergencyStop(
            user.Id,
            shockerId,
            result.Engaged,
            result.EmergencyStopShockerIds));

        return ApiResults.Json(new
        {
            ok = true,
            engaged = result.Engaged,
            emergencyStopShockerIds = result.EmergencyStopShockerIds,
        });
    }

    /// <summary>JS: <c>String(row.ClientId ?? row.clientId ?? '') || null</c>.</summary>
    private static string? RowClientId(JsonElement row)
    {
        if (row.ValueKind != JsonValueKind.Object) return null;
        foreach (var key in new[] { "ClientId", "clientId" })
        {
            if (!row.TryGetProperty(key, out var value) || value.ValueKind is JsonValueKind.Null) continue;
            var text = value.ToString();
            return string.IsNullOrEmpty(text) ? null : text;
        }
        return null;
    }

    // ───────────────────────── operate ─────────────────────────

    private static async Task<IResult> OperateAsync(
        HttpContext ctx,
        OperateRequest? body,
        AppEnv env,
        IHttpClientFactory httpFactory,
        PiShockApiClient api,
        SessionStore sessions,
        BrokerService broker)
    {
        var blocked = ControlGuards.RequireSession(ctx);
        if (blocked is not null) return blocked;

        var user = ctx.DiscordUser();
        var ct = ctx.RequestAborted;

        try
        {
            OperatePolicy.AssertOperateRateLimit(user.Id);
        }
        catch (OperatePolicyError err)
        {
            return ApiResults.PolicyError(err);
        }

        body ??= new OperateRequest();

        var operation = body.Operation;
        if (string.IsNullOrEmpty(operation))
        {
            return ApiResults.Error(400, "Missing operation");
        }
        if (body.ShockerId is null or 0 && string.IsNullOrEmpty(body.ShareCode))
        {
            return ApiResults.Error(400, "Missing shockerId or shareCode");
        }
        if (operation == "stop")
        {
            return ApiResults.Error(
                400,
                "Use emergency-stop latch (press in / press out)",
                "USE_EMERGENCY_STOP_LATCH");
        }

        var creds = ctx.PiShockCreds()!;
        var location = await OperateSupport.ResolveLocationAsync(
            env,
            httpFactory,
            body.InstanceId,
            prefetched: null,
            body.LocationHint,
            ct);

        OperatePolicy.ResolvedOperatePolicy policy;
        try
        {
            policy = await OperatePolicy.ResolveOwnOperatePolicyAsync(
                user.Id,
                creds,
                body.ShockerId,
                body.ShareCode,
                OperateSupport.CreateDeps(sessions, api));
        }
        catch (OperatePolicyError err)
        {
            return ApiResults.PolicyError(err);
        }
        catch (PiShockApiError err)
        {
            return await ControlGuards.PiShockErrorAsync(err, user.Id, sessions);
        }

        var shockerId = policy.ShockerId ?? body.ShockerId;
        var shareCode = policy.ShareCode;
        // Never trust body.clientId — only the resolved hub from PiShock / ActivityShare
        var clientId = policy.HubClientId;
        var logShareCode = policy.CrossUser ? null : shareCode;

        // Tap/Remote release: end the in-progress hold without latching emergency stop
        if (operation == "end")
        {
            if (shockerId is null || clientId is null)
            {
                return ApiResults.Error(400, "end requires a known shocker and hub client");
            }
            OperatePolicy.ClearHoldAutoEnd(policy.OwnerDiscordUserId, shockerId.Value);
            var ended = await broker.PublishOperateAsync(
                creds,
                OperateSupport.EndInput(clientId, shockerId.Value, shareCode, "Tap Release"),
                ct);
            await OperateSupport.LogOperateEventAsync(
                sessions,
                user.Id,
                policy.OwnerDiscordUserId,
                "end",
                shockerId,
                logShareCode,
                intensity: 0,
                durationMs: 0,
                success: ended,
                detail: ended ? "broker" : "broker_failed",
                location);
            if (!ended)
            {
                return ApiResults.Error(502, "Failed to end hold via broker");
            }
            return ApiResults.Json(new { ok = true, via = "broker", ended = true });
        }

        var hold = body.Hold == true || operation == "hold";
        var warning = body.Warning?.Active == true || operation == "warning";

        try
        {
            OperatePolicy.AssertModeAllowed(operation, hold, policy.Flags);
        }
        catch (OperatePolicyError err)
        {
            return ApiResults.PolicyError(err);
        }

        try
        {
            OperatePolicy.AssertWithinCeilings(
                body.Intensity,
                body.DurationMs,
                policy.MaxIntensity,
                policy.MaxDurationMs);
        }
        catch (OperatePolicyError err)
        {
            return ApiResults.PolicyError(err, includeCode: false);
        }

        var intensity = OperatePolicy.ClampIntensity(body.Intensity, policy.MaxIntensity);
        var durationMs = OperatePolicy.ClampDurationMs(body.DurationMs, policy.MaxDurationMs);

        Task LogAsync(bool success, string? detail = null) =>
            OperateSupport.LogOperateEventAsync(
                sessions,
                user.Id,
                policy.OwnerDiscordUserId,
                operation,
                shockerId,
                logShareCode,
                intensity,
                durationMs,
                success,
                detail,
                location);

        void ScheduleHoldEnd()
        {
            OperatePolicy.ScheduleHoldAutoEnd(
                creds,
                policy.OwnerDiscordUserId,
                shockerId!.Value,
                clientId!,
                durationMs,
                shareCode,
                agentName: null,
                OperateSupport.HoldEndPublisher(broker));
        }

        try
        {
            var op = OperateSupport.ToShockerOp(operation);

            // Prefer broker for owned V3 devices (same channel emergency stop cancels)
            if (shockerId is not null && clientId is not null && string.IsNullOrEmpty(shareCode))
            {
                var published = await broker.PublishOperateAsync(
                    creds,
                    new PublishOperateInput
                    {
                        ClientId = clientId,
                        ShockerId = shockerId.Value,
                        Operation = op,
                        Intensity = Math.Max(1, intensity),
                        DurationMs = durationMs,
                        Hold = hold,
                        Warning = warning,
                    },
                    ct);
                if (published)
                {
                    if (hold) ScheduleHoldEnd();
                    await LogAsync(true, "broker");
                    return ApiResults.Json(new { ok = true, via = "broker" });
                }
            }

            if ((hold || warning) && shockerId is not null && clientId is not null)
            {
                var published = await broker.PublishOperateAsync(
                    creds,
                    new PublishOperateInput
                    {
                        ClientId = clientId,
                        ShockerId = shockerId.Value,
                        Operation = op,
                        Intensity = Math.Max(1, intensity),
                        DurationMs = durationMs,
                        Hold = hold,
                        Warning = warning,
                        ShareCode = string.IsNullOrEmpty(shareCode) ? null : shareCode,
                    },
                    ct);
                if (published)
                {
                    if (hold) ScheduleHoldEnd();
                    await LogAsync(true, "broker");
                    return ApiResults.Json(new { ok = true, via = "broker" });
                }
            }

            if (hold || warning)
            {
                if (shockerId is null)
                {
                    return ApiResults.Error(400, "Hold/warning requires shockerId");
                }
                var result = await api.ClientOperateAsync(
                    creds,
                    new ClientOperateRequest(
                        shockerId.Value,
                        Math.Max(1, intensity),
                        Math.Max(1, (int)Math.Round(durationMs / 1000.0, MidpointRounding.AwayFromZero)),
                        (int)op,
                        hold,
                        warning),
                    ct);
                if (result.Status is not (404 or 405))
                {
                    await LogAsync(true);
                    return ApiResults.Json(new { ok = true, via = "client-operate" });
                }
            }

            if (!string.IsNullOrEmpty(shareCode))
            {
                await api.OperateByShareAsync(creds, shareCode, op, Math.Max(1, intensity), durationMs, ct: ct);
            }
            else
            {
                await api.OperateByIdAsync(creds, shockerId!.Value, op, Math.Max(1, intensity), durationMs, ct: ct);
            }

            await LogAsync(true);
            return ApiResults.Json(new { ok = true });
        }
        catch (Exception err)
        {
            await LogAsync(false, err.Message);
            if (err is PiShockApiError apiErr)
            {
                return await ControlGuards.PiShockErrorAsync(apiErr, user.Id, sessions);
            }
            throw;
        }
    }

    // ───────────────────────── pause ─────────────────────────

    private static async Task<IResult> PauseAsync(
        HttpContext ctx,
        PauseRequest? body,
        PiShockApiClient api,
        SessionStore sessions)
    {
        var blocked = ControlGuards.RequireSession(ctx);
        if (blocked is not null) return blocked;

        body ??= new PauseRequest();
        var user = ctx.DiscordUser();
        var creds = ctx.PiShockCreds()!;
        try
        {
            if (body.ShareId is { } shareId)
            {
                var result = await api.PauseShareAsync(creds, shareId, body.PauseState, ctx.RequestAborted);
                if (result.Status is 404 or 405)
                {
                    return ApiResults.Error(result.Status, "Pause share route unavailable");
                }
                await sessions.LogCommandAsync(
                    new CommandLogInput
                    {
                        DiscordUserId = user.Id,
                        Action = "pause_share",
                        Success = true,
                        Detail = $"shareId={shareId}",
                    },
                    ctx.RequestAborted);
                return ApiResults.Json(new { ok = true });
            }
            if (body.LinkId is { } linkId)
            {
                var result = await api.PauseLinkAsync(creds, linkId, body.PauseState, ctx.RequestAborted);
                if (result.Status is 404 or 405)
                {
                    return ApiResults.Error(result.Status, "Pause link route unavailable");
                }
                await sessions.LogCommandAsync(
                    new CommandLogInput
                    {
                        DiscordUserId = user.Id,
                        Action = "pause_link",
                        Success = true,
                        Detail = $"linkId={linkId}",
                    },
                    ctx.RequestAborted);
                return ApiResults.Json(new { ok = true });
            }
            return ApiResults.Error(400, "shareId or linkId required");
        }
        catch (PiShockApiError err)
        {
            return await ControlGuards.PiShockErrorAsync(err, user.Id, sessions);
        }
    }

    // ───────────────────────── links ─────────────────────────

    private static async Task<IResult> ListLinksAsync(HttpContext ctx, PiShockApiClient api, SessionStore sessions)
    {
        var blocked = ControlGuards.RequireSession(ctx);
        if (blocked is not null) return blocked;

        var user = ctx.DiscordUser();
        try
        {
            var snapshot = await api.FetchControlSnapshotAsync(ctx.PiShockCreds()!, ctx.RequestAborted);
            return ApiResults.Json(new { links = snapshot.Links });
        }
        catch (PiShockApiError err)
        {
            return await ControlGuards.PiShockErrorAsync(err, user.Id, sessions);
        }
    }

    private static async Task<IResult> CreateLinkAsync(
        HttpContext ctx,
        [FromBody] Dictionary<string, JsonElement>? body,
        PiShockApiClient api,
        SessionStore sessions)
    {
        var blocked = ControlGuards.RequireSession(ctx);
        if (blocked is not null) return blocked;

        var user = ctx.DiscordUser();
        try
        {
            var result = await api.CreateLinkAsync(
                ctx.PiShockCreds()!,
                body ?? new Dictionary<string, JsonElement>(),
                ctx.RequestAborted);
            if (result.Status is 404 or 405)
            {
                return ApiResults.Error(result.Status, "Create link unavailable");
            }
            return ApiResults.Json(new { ok = true });
        }
        catch (PiShockApiError err)
        {
            return await ControlGuards.PiShockErrorAsync(err, user.Id, sessions);
        }
    }

    private static async Task<IResult> DeleteLinkAsync(
        HttpContext ctx,
        string linkId,
        PiShockApiClient api,
        SessionStore sessions)
    {
        var blocked = ControlGuards.RequireSession(ctx);
        if (blocked is not null) return blocked;

        if (!int.TryParse(linkId, NumberStyles.Integer, CultureInfo.InvariantCulture, out var id))
        {
            return ApiResults.Error(400, "Invalid linkId");
        }

        var user = ctx.DiscordUser();
        try
        {
            var result = await api.DeleteLinkAsync(ctx.PiShockCreds()!, id, ctx.RequestAborted);
            if (result.Status is 404 or 405)
            {
                return ApiResults.Error(result.Status, "Delete link unavailable");
            }
            return ApiResults.Json(new { ok = true });
        }
        catch (PiShockApiError err)
        {
            return await ControlGuards.PiShockErrorAsync(err, user.Id, sessions);
        }
    }

    // ───────────────────────── shares ─────────────────────────

    private static async Task<IResult> CreateShareAsync(
        HttpContext ctx,
        [FromBody] Dictionary<string, JsonElement>? body,
        PiShockApiClient api,
        SessionStore sessions)
    {
        var blocked = ControlGuards.RequireSession(ctx);
        if (blocked is not null) return blocked;

        var user = ctx.DiscordUser();
        try
        {
            var result = await api.CreateShareAsync(
                ctx.PiShockCreds()!,
                body ?? new Dictionary<string, JsonElement>(),
                ctx.RequestAborted);
            if (result.Status is 404 or 405)
            {
                return ApiResults.Error(result.Status, "Create share unavailable");
            }
            return ApiResults.Json(new { ok = true, data = result.Data });
        }
        catch (PiShockApiError err)
        {
            return await ControlGuards.PiShockErrorAsync(err, user.Id, sessions);
        }
    }

    /// <summary>Redeem someone else's share code into this PiShock account.</summary>
    private static async Task<IResult> ClaimShareAsync(
        HttpContext ctx,
        ClaimShareRequest? body,
        PiShockApiClient api,
        SessionStore sessions)
    {
        var blocked = ControlGuards.RequireSession(ctx);
        if (blocked is not null) return blocked;

        body ??= new ClaimShareRequest();
        var codes = body.Shares is not null
            ? body.Shares
            : new[] { body.Code ?? body.ShareCode ?? "" }
                .Select(c => c.Trim())
                .Where(c => c.Length > 0)
                .ToList();
        if (codes.Count == 0)
        {
            return ApiResults.Error(400, "Missing share code");
        }

        var user = ctx.DiscordUser();
        try
        {
            var result = await api.ClaimShareCodesAsync(ctx.PiShockCreds()!, codes, ctx.RequestAborted);
            if (result.Status is 404 or 405)
            {
                return ApiResults.Error(result.Status, "Claim share unavailable");
            }
            return ApiResults.Json(new { ok = true, data = result.Data });
        }
        catch (PiShockApiError err)
        {
            switch (err.Status)
            {
                case 410: return ApiResults.Error(410, "Share code already claimed");
                case 412: return ApiResults.Error(412, "Invalid or empty share code");
                case 416: return ApiResults.Error(416, "Too many share codes");
            }
            return await ControlGuards.PiShockErrorAsync(err, user.Id, sessions);
        }
    }

    private static async Task<IResult> DeleteShareAsync(
        HttpContext ctx,
        string shareId,
        PiShockApiClient api,
        SessionStore sessions)
    {
        var blocked = ControlGuards.RequireSession(ctx);
        if (blocked is not null) return blocked;

        if (!int.TryParse(shareId, NumberStyles.Integer, CultureInfo.InvariantCulture, out var id))
        {
            return ApiResults.Error(400, "Invalid shareId");
        }

        var user = ctx.DiscordUser();
        try
        {
            var result = await api.DeleteShareAsync(ctx.PiShockCreds()!, id, ctx.RequestAborted);
            if (result.Status is 404 or 405)
            {
                return ApiResults.Error(result.Status, "Delete share unavailable");
            }
            return ApiResults.Json(new { ok = true });
        }
        catch (PiShockApiError err)
        {
            return await ControlGuards.PiShockErrorAsync(err, user.Id, sessions);
        }
    }

    // ───────────────────────── logs ─────────────────────────

    private static async Task<IResult> ListLogsAsync(
        HttpContext ctx,
        string? limit,
        PiShockApiClient api,
        SessionStore sessions)
    {
        var blocked = ControlGuards.RequireConsent(ctx);
        if (blocked is not null) return blocked;

        var user = ctx.DiscordUser();
        var ct = ctx.RequestAborted;

        // JS: Number(query.limit ?? 200); non-finite falls back to 200
        var limitValue = 200d;
        if (limit is not null)
        {
            limitValue = string.IsNullOrWhiteSpace(limit)
                ? 0
                : double.TryParse(limit, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
                    ? parsed
                    : double.NaN;
        }
        var effectiveLimit = double.IsFinite(limitValue)
            ? (int)Math.Clamp(limitValue, int.MinValue, int.MaxValue)
            : 200;

        // Import PiShock website/panel device logs into the shared feed when linked
        var creds = ctx.PiShockCreds();
        if (creds is not null)
        {
            try
            {
                await sessions.SyncWebsiteDeviceLogsAsync(
                    user.Id,
                    creds,
                    async c =>
                    {
                        var res = await api.LoadLogsAsync(c, ct: ct);
                        return (res.Status, res.Data);
                    },
                    ct);
            }
            catch (Exception) when (!ct.IsCancellationRequested)
            {
                // optional — public Discord feed still useful
            }
        }

        // Same scoped DbContext: queries must run one after another.
        var publicFeed = await sessions.ListPublicCommandLogsAsync(effectiveLimit, ct);
        var activity = await sessions.ListCommandLogsAsync(user.Id, 50, ct);
        return ApiResults.Json(new
        {
            @public = publicFeed,
            // Deprecated: prefer `public` — kept for PIP / personal hydration
            activity,
        });
    }

    // ───────────────────────── broker status ─────────────────────────

    /// <summary>
    /// Short request/response online probe. Discord's activity proxy times out long-lived SSE (524), so
    /// clients poll this instead.
    /// </summary>
    private static async Task<IResult> GetBrokerStatusAsync(
        HttpContext ctx,
        string? clientIds,
        string? waitMs,
        BrokerService broker,
        SessionStore sessions)
    {
        var blocked = ControlGuards.RequireSession(ctx);
        if (blocked is not null) return blocked;

        var ids = (clientIds ?? "")
            .Split(',')
            .Select(s => s.Trim())
            .Where(s => s.Length > 0)
            .ToList();

        var wait = 2500d;
        if (waitMs is not null)
        {
            wait = string.IsNullOrWhiteSpace(waitMs)
                ? 0
                : double.TryParse(waitMs, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
                    ? parsed
                    : double.NaN;
        }
        var effectiveWait = double.IsFinite(wait) ? (int)Math.Clamp(wait, int.MinValue, int.MaxValue) : 2500;

        var user = ctx.DiscordUser();
        try
        {
            var result = await broker.ProbeOnlineStatusAsync(
                user.Id,
                ctx.PiShockCreds()!,
                ids,
                effectiveWait,
                ctx.RequestAborted);
            return ApiResults.Json(new
            {
                ok = true,
                online = result.Online,
                lastSeenAt = result.LastSeenAt,
                at = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            });
        }
        catch (PiShockApiError err)
        {
            return await ControlGuards.PiShockErrorAsync(err, user.Id, sessions);
        }
    }
}

// ───────────────────────── request bodies ─────────────────────────

public sealed class EmergencyStopRequest
{
    public double? ShockerId { get; set; }
    public bool? Engaged { get; set; }

    /// <summary>Hint only — verified against the account's own hubs before use.</summary>
    public JsonElement? ClientId { get; set; }
}

public sealed class WarningRequest
{
    public bool? Active { get; set; }
    public double? Min { get; set; }
    public double? Max { get; set; }
}

public sealed class OperateRequest
{
    public int? ShockerId { get; set; }
    public string? ShareCode { get; set; }

    /// <summary>shock | vibrate | beep | hold | warning | stop | end</summary>
    public string? Operation { get; set; }

    public double? Intensity { get; set; }
    public double? DurationMs { get; set; }
    public bool? Hold { get; set; }
    public WarningRequest? Warning { get; set; }
    public string? InstanceId { get; set; }
    public ClientLocationHint? LocationHint { get; set; }

    // Legacy client-supplied capability flags / limits / clientId are intentionally not bound:
    // policy is resolved server-side only.
}

public sealed class PauseRequest
{
    public int? ShareId { get; set; }
    public int? LinkId { get; set; }
    public bool? PauseState { get; set; }
}

public sealed class ClaimShareRequest
{
    public string? Code { get; set; }
    public string? ShareCode { get; set; }
    public List<string>? Shares { get; set; }
}
