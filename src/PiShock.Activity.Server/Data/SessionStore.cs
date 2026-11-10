using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using PiShock.Activity.Server.Operate;
using PiShock.Activity.Server.PiShock;
using PiShock.Activity.Server.Security;
using PiShock.Activity.Server.Shared;

namespace PiShock.Activity.Server.Data;

/// <summary>Input for <see cref="SessionStore.LogCommandAsync"/> (port of the logCommand input object).</summary>
public sealed class CommandLogInput
{
    public required string DiscordUserId { get; init; }
    public string? ExecutorDiscordUserId { get; init; }
    public string? TargetDiscordUserId { get; init; }
    public string? ExecutorLabel { get; init; }
    public required string Action { get; init; }
    public int? ShockerId { get; init; }
    public string? ShareCode { get; init; }
    public int? Intensity { get; init; }
    public int? DurationMs { get; init; }
    public required bool Success { get; init; }
    public string? Detail { get; init; }

    /// <summary>"discord" (default) or "website".</summary>
    public string? Source { get; init; }

    public string? InstanceId { get; init; }
    public string? GuildId { get; init; }
    public string? ChannelId { get; init; }
    public string? LocationKind { get; init; }
    public string? LocationName { get; init; }
    public string? LocationIconUrl { get; init; }
    public string? ExternalLogKey { get; init; }
}

/// <summary>One row of <see cref="SessionStore.ReplaceActivitySharesAsync"/> input.</summary>
public sealed class ActivityShareInput
{
    public int ShockerId { get; init; }
    public required string ShockerName { get; init; }
    public string? HubClientId { get; init; }
    public string? ShareCode { get; init; }
    public int? DeviceMaxIntensity { get; init; }
    public int? DeviceMaxDurationMs { get; init; }
    public bool? Enabled { get; init; }
    public bool? Paused { get; init; }
    public int? MaxIntensity { get; init; }
    public int? MaxDurationMs { get; init; }
    public bool? CanShock { get; init; }
    public bool? CanVibrate { get; init; }
    public bool? CanBeep { get; init; }
    public bool? CanHold { get; init; }
}

public sealed record PersonalActivityLimits(int ActivityMaxIntensity, int ActivityMaxDurationMs);

public sealed record EmergencyStopResult(bool Engaged, int[] EmergencyStopShockerIds);

/// <summary>Command log row as returned to its owner. ShareCode is only populated for the device owner's own rows.</summary>
public sealed record CommandLogView(
    string Id,
    string DiscordUserId,
    string? ExecutorDiscordUserId,
    string? TargetDiscordUserId,
    string? ExecutorLabel,
    string Action,
    int? ShockerId,
    string? ShareCode,
    bool HasShareCode,
    int? Intensity,
    int? DurationMs,
    bool Success,
    string? Detail,
    string Source,
    string? InstanceId,
    string? GuildId,
    string? ChannelId,
    string? LocationKind,
    string? LocationName,
    string? LocationIconUrl,
    string? ExternalLogKey,
    DateTime CreatedAt);

public sealed record PublicLogPerson(
    string Id,
    string? Username,
    string? GlobalName,
    string DisplayName,
    string? Avatar,
    string AvatarUrl);

public sealed record PublicLogLocation(
    string? Kind,
    string? Name,
    string? IconUrl,
    string? GuildId,
    string? ChannelId);

public sealed record PublicLogEntry(
    string Id,
    string Action,
    int? ShockerId,
    int? Intensity,
    int? DurationMs,
    bool Success,
    DateTime CreatedAt,
    string Source,
    PublicLogLocation? Location,
    PublicLogPerson Executor,
    PublicLogPerson Target);

/// <summary>
/// Port of src/server/session.ts. All persistence for PiShock sessions, consent, activity shares/bans,
/// personal limits, emergency stop and command logs. Register as scoped (needs <see cref="AppDbContext"/>).
/// </summary>
public sealed class SessionStore(AppDbContext db, AppEnv env)
{
    private static readonly HashSet<string> PublicLogNoise =
    [
        "end",
        "stop",
        "participant_end",
        "emergency_stop_on",
        "emergency_stop_off",
        "pause_share",
        "pause_link",
    ];

    // ---------------------------------------------------------------- PiShock session

    public Task<DiscordUser?> FindUserAsync(string id, CancellationToken ct = default) =>
        db.DiscordUsers.AsNoTracking().FirstOrDefaultAsync(u => u.Id == id, ct);

    public async Task SavePiShockSessionAsync(
        string discordUserId,
        int userId,
        string token,
        CancellationToken ct = default)
    {
        var enc = TokenCrypto.EncryptToken(env.TokenKey, token);
        var row = await db.PiShockSessions.FirstOrDefaultAsync(s => s.DiscordUserId == discordUserId, ct);
        if (row is null)
        {
            db.PiShockSessions.Add(new PiShockSession
            {
                DiscordUserId = discordUserId,
                PishockUserId = userId,
                EncryptedToken = enc.EncryptedToken,
                TokenIv = enc.TokenIv,
                TokenAuthTag = enc.TokenAuthTag,
            });
        }
        else
        {
            row.PishockUserId = userId;
            row.EncryptedToken = enc.EncryptedToken;
            row.TokenIv = enc.TokenIv;
            row.TokenAuthTag = enc.TokenAuthTag;
        }
        await db.SaveChangesAsync(ct);
    }

    public async Task<PiShockCreds?> LoadPiShockCredsAsync(string discordUserId, CancellationToken ct = default)
    {
        var row = await db.PiShockSessions.AsNoTracking()
            .FirstOrDefaultAsync(s => s.DiscordUserId == discordUserId, ct);
        if (row is null) return null;
        var token = TokenCrypto.DecryptToken(env.TokenKey, row.EncryptedToken, row.TokenIv, row.TokenAuthTag);
        return new PiShockCreds(row.PishockUserId, token);
    }

    public Task ClearPiShockSessionAsync(string discordUserId, CancellationToken ct = default) =>
        db.PiShockSessions.Where(s => s.DiscordUserId == discordUserId).ExecuteDeleteAsync(ct);

    // ---------------------------------------------------------------- Consent

    public async Task<bool> GetConsentAsync(string discordUserId, CancellationToken ct = default)
    {
        var consentAt = await db.DiscordUsers.AsNoTracking()
            .Where(u => u.Id == discordUserId)
            .Select(u => u.ConsentAt)
            .FirstOrDefaultAsync(ct);
        return consentAt is not null;
    }

    public async Task SetConsentAsync(string discordUserId, CancellationToken ct = default)
    {
        var user = await RequireUserAsync(discordUserId, ct);
        user.ConsentAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
    }

    public async Task ClearConsentAsync(string discordUserId, CancellationToken ct = default)
    {
        var user = await RequireUserAsync(discordUserId, ct);
        user.ConsentAt = null;
        await db.SaveChangesAsync(ct);
    }

    // ---------------------------------------------------------------- Activity shares

    public async Task<ActivityShare?> FindActivityShareByCodeAsync(string shareCode, CancellationToken ct = default)
    {
        var code = shareCode.Trim();
        if (code.Length == 0) return null;
        return await db.ActivityShares.AsNoTracking().FirstOrDefaultAsync(s => s.ShareCode == code, ct);
    }

    public Task<ActivityShare?> FindActivityShareByShockerAsync(
        string discordUserId,
        int shockerId,
        CancellationToken ct = default) =>
        db.ActivityShares.AsNoTracking()
            .FirstOrDefaultAsync(s => s.DiscordUserId == discordUserId && s.ShockerId == shockerId, ct);

    public Task<List<ActivityShare>> ListActivitySharesAsync(string discordUserId, CancellationToken ct = default) =>
        db.ActivityShares.AsNoTracking()
            .Where(s => s.DiscordUserId == discordUserId)
            .OrderByDescending(s => s.UpdatedAt)
            .ToListAsync(ct);

    public Task<List<ActivityShare>> ListEnabledActivitySharesAsync(
        string discordUserId,
        CancellationToken ct = default) =>
        db.ActivityShares.AsNoTracking()
            .Where(s => s.DiscordUserId == discordUserId && s.Enabled)
            .OrderByDescending(s => s.UpdatedAt)
            .ToListAsync(ct);

    public async Task<List<ActivityShare>> ReplaceActivitySharesAsync(
        string discordUserId,
        IEnumerable<ActivityShareInput> shares,
        CancellationToken ct = default)
    {
        var inputs = shares.ToList();
        await using (var tx = await db.Database.BeginTransactionAsync(ct))
        {
            await db.ActivityShares.Where(s => s.DiscordUserId == discordUserId).ExecuteDeleteAsync(ct);
            if (inputs.Count > 0)
            {
                foreach (var s in inputs)
                {
                    var deviceMaxIntensity = Math.Max(1, Math.Min(100, s.DeviceMaxIntensity ?? 100));
                    var deviceMaxDurationMs = Math.Max(16, Math.Min(15_000, s.DeviceMaxDurationMs ?? 15_000));
                    db.ActivityShares.Add(new ActivityShare
                    {
                        DiscordUserId = discordUserId,
                        ShockerId = s.ShockerId,
                        ShockerName = s.ShockerName,
                        HubClientId = s.HubClientId,
                        ShareCode = string.IsNullOrEmpty(s.ShareCode) ? null : s.ShareCode,
                        DeviceMaxIntensity = deviceMaxIntensity,
                        DeviceMaxDurationMs = deviceMaxDurationMs,
                        Enabled = s.Enabled != false,
                        Paused = s.Paused == true,
                        MaxIntensity = Math.Max(1, Math.Min(deviceMaxIntensity, s.MaxIntensity ?? deviceMaxIntensity)),
                        MaxDurationMs = Math.Max(
                            16,
                            Math.Min(deviceMaxDurationMs, s.MaxDurationMs ?? deviceMaxDurationMs)),
                        CanShock = s.CanShock != false,
                        CanVibrate = s.CanVibrate != false,
                        CanBeep = s.CanBeep != false,
                        CanHold = s.CanHold != false,
                    });
                }
                await db.SaveChangesAsync(ct);
            }
            await tx.CommitAsync(ct);
        }

        db.ChangeTracker.Clear();
        return await ListActivitySharesAsync(discordUserId, ct);
    }

    /// <summary>Adapts an <see cref="ActivityShare"/> row to the shape <see cref="OperatePolicy"/> consumes.</summary>
    public static OperatePolicy.ActivitySharePolicyRow? ToPolicyRow(ActivityShare? share) =>
        share is null
            ? null
            : new OperatePolicy.ActivitySharePolicyRow
            {
                DiscordUserId = share.DiscordUserId,
                ShockerId = share.ShockerId,
                ShareCode = share.ShareCode,
                HubClientId = share.HubClientId,
                DeviceMaxIntensity = share.DeviceMaxIntensity,
                DeviceMaxDurationMs = share.DeviceMaxDurationMs,
                Enabled = share.Enabled,
                Paused = share.Paused,
                MaxIntensity = share.MaxIntensity,
                MaxDurationMs = share.MaxDurationMs,
                CanShock = share.CanShock,
                CanVibrate = share.CanVibrate,
                CanBeep = share.CanBeep,
                CanHold = share.CanHold,
            };

    // ---------------------------------------------------------------- Personal limits + emergency stop

    public async Task<PersonalActivityLimits> GetPersonalActivityLimitsAsync(
        string discordUserId,
        CancellationToken ct = default)
    {
        var user = await db.DiscordUsers.AsNoTracking()
            .Where(u => u.Id == discordUserId)
            .Select(u => new { u.ActivityMaxIntensity, u.ActivityMaxDurationMs })
            .FirstOrDefaultAsync(ct);
        return new PersonalActivityLimits(user?.ActivityMaxIntensity ?? 100, user?.ActivityMaxDurationMs ?? 15_000);
    }

    public async Task<DiscordUser> SetPersonalActivityLimitsAsync(
        string discordUserId,
        int? activityMaxIntensity,
        int? activityMaxDurationMs,
        CancellationToken ct = default)
    {
        var user = await RequireUserAsync(discordUserId, ct);
        user.ActivityMaxIntensity = Math.Max(1, Math.Min(100, activityMaxIntensity ?? 100));
        user.ActivityMaxDurationMs = Math.Max(16, Math.Min(15_000, activityMaxDurationMs ?? 15_000));
        await db.SaveChangesAsync(ct);
        return user;
    }

    public async Task<int[]> GetEmergencyStopShockerIdsAsync(string discordUserId, CancellationToken ct = default)
    {
        var ids = await db.DiscordUsers.AsNoTracking()
            .Where(u => u.Id == discordUserId)
            .Select(u => u.EmergencyStopShockerIds)
            .FirstOrDefaultAsync(ct);
        return ids ?? [];
    }

    public async Task<bool> IsEmergencyStoppedAsync(
        string discordUserId,
        int shockerId,
        CancellationToken ct = default)
    {
        var ids = await GetEmergencyStopShockerIdsAsync(discordUserId, ct);
        return ids.Contains(shockerId);
    }

    /// <summary>Latch or release owner emergency stop for a shocker. Returns the new engaged state.</summary>
    public async Task<EmergencyStopResult> SetEmergencyStopAsync(
        string discordUserId,
        int shockerId,
        bool engaged,
        CancellationToken ct = default)
    {
        var user = await RequireUserAsync(discordUserId, ct);
        var current = user.EmergencyStopShockerIds ?? [];
        var next = engaged
            ? current.Append(shockerId).Distinct().ToArray()
            : current.Where(id => id != shockerId).ToArray();
        user.EmergencyStopShockerIds = next;
        await db.SaveChangesAsync(ct);
        var saved = user.EmergencyStopShockerIds ?? [];
        return new EmergencyStopResult(saved.Contains(shockerId), saved);
    }

    // ---------------------------------------------------------------- Bans

    public Task<List<ActivityBan>> ListActivityBansAsync(string ownerDiscordUserId, CancellationToken ct = default) =>
        db.ActivityBans.AsNoTracking()
            .Where(b => b.OwnerDiscordUserId == ownerDiscordUserId)
            .OrderByDescending(b => b.CreatedAt)
            .ToListAsync(ct);

    public async Task<List<ActivityBan>> ReplaceActivityBansAsync(
        string ownerDiscordUserId,
        IEnumerable<string> bannedDiscordUserIds,
        CancellationToken ct = default)
    {
        var unique = bannedDiscordUserIds.Where(id => !string.IsNullOrEmpty(id)).Distinct().ToList();
        await using (var tx = await db.Database.BeginTransactionAsync(ct))
        {
            await db.ActivityBans.Where(b => b.OwnerDiscordUserId == ownerDiscordUserId).ExecuteDeleteAsync(ct);
            if (unique.Count > 0)
            {
                // Ensure banned users exist as DiscordUser rows (minimal stub).
                var existing = await db.DiscordUsers.AsNoTracking()
                    .Where(u => unique.Contains(u.Id))
                    .Select(u => u.Id)
                    .ToListAsync(ct);
                var existingSet = existing.ToHashSet();
                foreach (var id in unique.Where(id => !existingSet.Contains(id)))
                {
                    db.DiscordUsers.Add(new DiscordUser { Id = id });
                }
                foreach (var bannedId in unique)
                {
                    db.ActivityBans.Add(new ActivityBan
                    {
                        OwnerDiscordUserId = ownerDiscordUserId,
                        BannedDiscordUserId = bannedId,
                    });
                }
                await db.SaveChangesAsync(ct);
            }
            await tx.CommitAsync(ct);
        }

        db.ChangeTracker.Clear();
        return await ListActivityBansAsync(ownerDiscordUserId, ct);
    }

    public Task<bool> IsExecutorBannedAsync(
        string ownerDiscordUserId,
        string executorDiscordUserId,
        CancellationToken ct = default) =>
        db.ActivityBans.AsNoTracking()
            .AnyAsync(
                b => b.OwnerDiscordUserId == ownerDiscordUserId && b.BannedDiscordUserId == executorDiscordUserId,
                ct);

    // ---------------------------------------------------------------- Command logs

    public async Task LogCommandAsync(CommandLogInput input, CancellationToken ct = default)
    {
        db.CommandLogs.Add(new CommandLog
        {
            DiscordUserId = input.DiscordUserId,
            ExecutorDiscordUserId = input.ExecutorDiscordUserId,
            TargetDiscordUserId = input.TargetDiscordUserId,
            ExecutorLabel = input.ExecutorLabel,
            Action = input.Action,
            ShockerId = input.ShockerId,
            ShareCode = input.ShareCode,
            Intensity = input.Intensity,
            DurationMs = input.DurationMs,
            Success = input.Success,
            Detail = input.Detail,
            Source = input.Source ?? "discord",
            InstanceId = input.InstanceId,
            GuildId = input.GuildId,
            ChannelId = input.ChannelId,
            LocationKind = input.LocationKind,
            LocationName = input.LocationName,
            LocationIconUrl = input.LocationIconUrl,
            ExternalLogKey = input.ExternalLogKey,
        });
        await db.SaveChangesAsync(ct);
    }

    public async Task<List<CommandLogView>> ListCommandLogsAsync(
        string discordUserId,
        int limit = 50,
        CancellationToken ct = default)
    {
        var rows = await db.CommandLogs.AsNoTracking()
            .Where(c => c.DiscordUserId == discordUserId
                || c.ExecutorDiscordUserId == discordUserId
                || c.TargetDiscordUserId == discordUserId)
            .OrderByDescending(c => c.CreatedAt)
            .Take(limit)
            .ToListAsync(ct);

        // Share codes are a capability — only the device owner's own log rows may see them.
        return rows.Select(row =>
        {
            var hasShareCode = !string.IsNullOrEmpty(row.ShareCode);
            var deviceOwnerId = row.TargetDiscordUserId ?? row.DiscordUserId;
            var canSeeShareCode = hasShareCode
                && deviceOwnerId == discordUserId
                && row.DiscordUserId == discordUserId;
            return new CommandLogView(
                row.Id,
                row.DiscordUserId,
                row.ExecutorDiscordUserId,
                row.TargetDiscordUserId,
                row.ExecutorLabel,
                row.Action,
                row.ShockerId,
                canSeeShareCode ? row.ShareCode : null,
                hasShareCode,
                row.Intensity,
                row.DurationMs,
                row.Success,
                row.Detail,
                row.Source,
                row.InstanceId,
                row.GuildId,
                row.ChannelId,
                row.LocationKind,
                row.LocationName,
                row.LocationIconUrl,
                row.ExternalLogKey,
                row.CreatedAt);
        }).ToList();
    }

    /// <summary>
    /// Global recent feed: who shocked/vibed/beeped whom, across all instances.
    /// Dedupes dual participant writes by keeping the target's copy only. Never returns share codes.
    /// </summary>
    public async Task<List<PublicLogEntry>> ListPublicCommandLogsAsync(int limit = 200, CancellationToken ct = default)
    {
        var take = Math.Max(1, Math.Min(250, limit));
        var rows = await db.CommandLogs.AsNoTracking()
            .Where(c => c.Success
                && c.TargetDiscordUserId != null
                && (c.ExecutorDiscordUserId != null || c.ExecutorLabel != null))
            .OrderByDescending(c => c.CreatedAt)
            .Take(take * 3)
            .Select(c => new
            {
                c.Id,
                c.DiscordUserId,
                c.ExecutorDiscordUserId,
                c.TargetDiscordUserId,
                c.ExecutorLabel,
                c.Action,
                c.ShockerId,
                c.Intensity,
                c.DurationMs,
                c.Success,
                c.Source,
                c.LocationKind,
                c.LocationName,
                c.LocationIconUrl,
                c.GuildId,
                c.ChannelId,
                c.CreatedAt,
            })
            .ToListAsync(ct);

        var deduped = rows
            .Where(row => !string.IsNullOrEmpty(row.TargetDiscordUserId)
                && row.DiscordUserId == row.TargetDiscordUserId
                && IsPublicLogAction(row.Action)
                && (!string.IsNullOrEmpty(row.ExecutorDiscordUserId) || !string.IsNullOrEmpty(row.ExecutorLabel)))
            .Take(take)
            .ToList();

        var userIds = deduped
            .SelectMany(row => new[] { row.ExecutorDiscordUserId, row.TargetDiscordUserId })
            .Where(id => !string.IsNullOrEmpty(id))
            .Select(id => id!)
            .Distinct()
            .ToList();

        var users = userIds.Count > 0
            ? await db.DiscordUsers.AsNoTracking()
                .Where(u => userIds.Contains(u.Id))
                .Select(u => new { u.Id, u.Username, u.GlobalName, u.Avatar })
                .ToListAsync(ct)
            : [];
        var byId = users.ToDictionary(
            u => u.Id,
            u => new PublicLogUser(u.Id, u.Username, u.GlobalName, u.Avatar));

        return deduped.Select(row =>
        {
            var targetId = row.TargetDiscordUserId!;
            var executorId = row.ExecutorDiscordUserId;
            var executor = !string.IsNullOrEmpty(executorId)
                ? PublicLogPersonFor(byId.GetValueOrDefault(executorId), executorId)
                : new PublicLogPerson(
                    $"label:{(string.IsNullOrEmpty(row.ExecutorLabel) ? "website" : row.ExecutorLabel)}",
                    null,
                    null,
                    string.IsNullOrEmpty(row.ExecutorLabel) ? "Website" : row.ExecutorLabel,
                    null,
                    DiscordAvatarUrl("0", null));
            var hasLocation = !string.IsNullOrEmpty(row.LocationName) || !string.IsNullOrEmpty(row.LocationIconUrl);
            return new PublicLogEntry(
                row.Id,
                row.Action,
                row.ShockerId,
                row.Intensity,
                row.DurationMs,
                row.Success,
                row.CreatedAt,
                row.Source == "website" ? "website" : "discord",
                hasLocation
                    ? new PublicLogLocation(
                        row.LocationKind,
                        row.LocationName,
                        row.LocationIconUrl,
                        row.GuildId,
                        row.ChannelId)
                    : null,
                executor,
                PublicLogPersonFor(byId.GetValueOrDefault(targetId), targetId));
        }).ToList();
    }

    public static bool IsPublicLogAction(string action)
    {
        var a = action.ToLowerInvariant();
        if (PublicLogNoise.Contains(a)) return false;
        if (a.EndsWith("_end", StringComparison.Ordinal)) return false;
        return true;
    }

    public static string DiscordAvatarUrl(string id, string? avatar)
    {
        if (!string.IsNullOrEmpty(avatar))
        {
            return $"https://cdn.discordapp.com/avatars/{id}/{avatar}.png?size=64";
        }

        // Mirrors the JS int32 hash: (hash * 31 + charCode) | 0, then Math.abs(hash) % 6.
        var hash = 0;
        unchecked
        {
            foreach (var ch in id) hash = hash * 31 + ch;
        }
        var abs = Math.Abs((long)hash);
        return $"https://cdn.discordapp.com/embed/avatars/{abs % 6}.png";
    }

    private sealed record PublicLogUser(string Id, string? Username, string? GlobalName, string? Avatar);

    private static PublicLogPerson PublicLogPersonFor(PublicLogUser? user, string fallbackId)
    {
        var id = user?.Id ?? fallbackId;
        var displayName = !string.IsNullOrEmpty(user?.GlobalName)
            ? user!.GlobalName!
            : !string.IsNullOrEmpty(user?.Username)
                ? user!.Username!
                : "Unknown";
        return new PublicLogPerson(
            id,
            user?.Username,
            user?.GlobalName,
            displayName,
            user?.Avatar,
            DiscordAvatarUrl(id, user?.Avatar));
    }

    // ---------------------------------------------------------------- Website device log sync

    private static readonly string[] TimeKeys =
    [
        "Time", "time", "Timestamp", "timestamp", "Date", "date", "Created", "created", "CreatedAt", "createdAt",
        "LogTime", "logTime",
    ];

    private static readonly string[] AgentKeys =
    [
        "AgentName", "agentName", "Username", "UserName", "username", "From", "from", "Name", "name", "Origin",
        "origin",
    ];

    private static readonly string[] ActionKeys = ["Type", "type", "Mode", "mode", "Op", "op", "Operation", "operation"];
    private static readonly string[] IntensityKeys = ["Intensity", "intensity", "Int", "int", "i"];
    private static readonly string[] ShockerKeys = ["ShockerId", "shockerId", "Id", "id"];
    private static readonly string[] LogIdKeys = ["Id", "id", "LogId", "logId"];
    private static readonly string[] ListKeys = ["Logs", "logs", "Items", "items", "Data", "data", "Entries", "entries"];
    private static readonly Regex MsDateRegex = new(@"/Date\((\d+)", RegexOptions.Compiled);

    /// <summary>
    /// Pull PiShock website/device logs for this account into CommandLog (source=website).
    /// Skips rows that already look like Discord Activity commands (those live in our DB).
    /// </summary>
    /// <param name="loadLogs">
    /// Fetches GET /Client/LoadLogs for the credentials and returns the HTTP status plus parsed JSON body
    /// (port of <c>loadLogs(creds)</c> from pishock/client.ts). Exceptions are swallowed (returns 0).
    /// </param>
    public async Task<int> SyncWebsiteDeviceLogsAsync(
        string ownerDiscordUserId,
        PiShockCreds creds,
        Func<PiShockCreds, Task<(int Status, JsonElement? Data)>> loadLogs,
        CancellationToken ct = default)
    {
        JsonElement? raw;
        try
        {
            var result = await loadLogs(creds);
            if (result.Status is 404 or 405) return 0;
            raw = result.Data;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return 0;
        }

        var list = ExtractLogList(raw);
        var inserted = 0;
        var idx = -1;
        foreach (var row in list.Take(100))
        {
            idx++;
            if (row.ValueKind is not (JsonValueKind.Object or JsonValueKind.Array)) continue;

            var agent = PickString(row, AgentKeys) ?? "Website";
            if (IsDiscordAppAgent(agent) || agent == Constants.AgentName) continue;

            var action = NormalizeDeviceLogAction(PickString(row, ActionKeys));
            if (!IsPublicLogAction(action)) continue;

            var intensity = PickNumber(row, IntensityKeys);
            var durationMs = DurationMsFromDeviceLog(row);
            var shockerId = PickNumber(row, ShockerKeys);
            var at = ParseDeviceLogTime(row);
            var externalId = PickString(row, LogIdKeys)
                ?? $"{at.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture)}:{agent}:{action}:"
                + $"{FormatJsNumber(intensity)}:{FormatJsNumber(durationMs)}:"
                + (shockerId is not null ? FormatJsNumber(shockerId) : idx.ToString(CultureInfo.InvariantCulture));
            var externalLogKey = $"website:{ownerDiscordUserId}:{externalId}";

            // Unique externalLogKey → already synced.
            if (await db.CommandLogs.AnyAsync(c => c.ExternalLogKey == externalLogKey, ct)) continue;

            var entity = new CommandLog
            {
                DiscordUserId = ownerDiscordUserId,
                ExecutorDiscordUserId = null,
                TargetDiscordUserId = ownerDiscordUserId,
                ExecutorLabel = agent.Length > 80 ? agent[..80] : agent,
                Action = action,
                ShockerId = shockerId is > 0 ? (int)JsRound(shockerId.Value) : null,
                Intensity = intensity is not null ? (int)JsRound(intensity.Value) : null,
                DurationMs = durationMs is not null ? (int)JsRound(durationMs.Value) : null,
                Success = true,
                Source = "website",
                ExternalLogKey = externalLogKey,
                CreatedAt = at,
                Detail = JsonSerializer.Serialize(new { via = "pishock_load_logs", agent }),
            };

            try
            {
                db.CommandLogs.Add(entity);
                await db.SaveChangesAsync(ct);
                inserted += 1;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // Lost a race on the unique externalLogKey (or any other insert failure) → skip row.
                db.Entry(entity).State = EntityState.Detached;
            }
        }
        return inserted;
    }

    private static List<JsonElement> ExtractLogList(JsonElement? raw)
    {
        if (raw is not { } el) return [];
        if (el.ValueKind == JsonValueKind.Array) return el.EnumerateArray().ToList();
        if (el.ValueKind != JsonValueKind.Object) return [];
        foreach (var key in ListKeys)
        {
            if (el.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Array)
            {
                return v.EnumerateArray().ToList();
            }
        }
        return [];
    }

    private static bool TryGet(JsonElement row, string key, out JsonElement value)
    {
        value = default;
        return row.ValueKind == JsonValueKind.Object && row.TryGetProperty(key, out value);
    }

    private static string? PickString(JsonElement row, string[] keys)
    {
        foreach (var key in keys)
        {
            if (!TryGet(row, key, out var v)) continue;
            string s;
            switch (v.ValueKind)
            {
                case JsonValueKind.Null:
                case JsonValueKind.Undefined:
                    continue;
                case JsonValueKind.String:
                    s = (v.GetString() ?? "").Trim();
                    break;
                case JsonValueKind.Number:
                    s = FormatJsNumber(v.GetDouble());
                    break;
                case JsonValueKind.True:
                    s = "true";
                    break;
                case JsonValueKind.False:
                    s = "false";
                    break;
                default:
                    s = v.GetRawText().Trim();
                    break;
            }
            if (s.Length > 0) return s;
        }
        return null;
    }

    private static double? PickNumber(JsonElement row, string[] keys)
    {
        foreach (var key in keys)
        {
            if (!TryGet(row, key, out var v)) continue;
            switch (v.ValueKind)
            {
                case JsonValueKind.Null:
                case JsonValueKind.Undefined:
                    continue;
                case JsonValueKind.Number:
                    if (v.TryGetDouble(out var d) && double.IsFinite(d)) return d;
                    break;
                case JsonValueKind.String:
                    var str = (v.GetString() ?? "").Trim();
                    if (str.Length == 0) continue; // v === ''
                    if (TryParseJsNumber(str, out var n)) return n;
                    break;
                case JsonValueKind.True:
                    return 1;
                case JsonValueKind.False:
                    return 0;
            }
        }
        return null;
    }

    private static bool TryParseJsNumber(string s, out double value) =>
        double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out value) && double.IsFinite(value);

    private static DateTime ParseDeviceLogTime(JsonElement row)
    {
        var raw = PickString(row, TimeKeys);
        if (raw is null) return DateTime.UtcNow;

        var msMatch = MsDateRegex.Match(raw);
        if (msMatch.Success && long.TryParse(msMatch.Groups[1].Value, out var ms))
        {
            return DateTime.UnixEpoch.AddMilliseconds(ms);
        }

        if (TryParseJsNumber(raw, out var asNum) && asNum > 1_000_000_000)
        {
            var millis = asNum < 1e12 ? asNum * 1000 : asNum;
            return DateTime.UnixEpoch.AddMilliseconds(millis);
        }

        return DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal,
            out var parsed)
            ? parsed.UtcDateTime
            : DateTime.UtcNow;
    }

    private static string NormalizeDeviceLogAction(string? raw)
    {
        var a = (raw ?? "").ToLowerInvariant();
        if (a.Contains("vib") || a == "v" || a == "1") return "vibrate";
        if (a.Contains("beep") || a == "b" || a == "2") return "beep";
        if (a.Contains("shock") || a == "s" || a == "0" || a.Contains("hold")) return "shock";
        return "shock";
    }

    private static double? DurationMsFromDeviceLog(JsonElement row)
    {
        var ms = PickNumber(row, ["DurationMs", "durationMs", "duration_ms"]);
        if (ms is not null) return JsRound(ms.Value);
        var dur = PickNumber(row, ["Duration", "duration", "Dur", "dur", "d"]);
        if (dur is null) return null;
        if (dur > 30) return JsRound(dur.Value);
        return JsRound(dur.Value * 1000);
    }

    private static bool IsDiscordAppAgent(string? agent)
    {
        if (string.IsNullOrEmpty(agent)) return false;
        var a = agent.ToLowerInvariant();
        return a.Contains("discord pishock activity") || a.Contains("discord ·");
    }

    /// <summary>JS <c>Math.round</c> semantics (round half toward +∞).</summary>
    private static double JsRound(double value) => Math.Floor(value + 0.5);

    private static string FormatJsNumber(double? value)
    {
        if (value is not { } v) return "";
        if (Math.Abs(v) < 1e15 && v == Math.Floor(v)) return ((long)v).ToString(CultureInfo.InvariantCulture);
        return v.ToString("R", CultureInfo.InvariantCulture);
    }

    // ---------------------------------------------------------------- Helpers

    private async Task<DiscordUser> RequireUserAsync(string discordUserId, CancellationToken ct)
    {
        var user = await db.DiscordUsers.FirstOrDefaultAsync(u => u.Id == discordUserId, ct);
        return user ?? throw new InvalidOperationException($"DiscordUser {discordUserId} not found.");
    }
}
