using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json;
using PiShock.Activity.Server.PiShock;

namespace PiShock.Activity.Server.Operate;

public static class OperatePolicy
{
    public const int AbsMaxIntensity = 100;
    public const int AbsMaxDurationMs = 15_000;
    public const int AbsMinDurationMs = 16;
    public const int HoldAutoEndGraceMs = 250;

    private const int OperateRateWindowMs = 60_000;
    private const int OperateRateMax = 30;

    private static readonly ConcurrentDictionary<string, List<long>> RateBuckets = new();
    private static readonly ConcurrentDictionary<string, Timer> HoldEndTimers = new();

    public sealed class OperateModeFlags
    {
        public bool CanShock { get; set; } = true;
        public bool CanVibrate { get; set; } = true;
        public bool CanBeep { get; set; } = true;
        public bool CanHold { get; set; } = true;
    }

    public sealed class ResolvedOperatePolicy
    {
        public required string OwnerDiscordUserId { get; init; }
        public int? ShockerId { get; init; }
        public string? ShareCode { get; init; }
        public string? HubClientId { get; init; }
        public int MaxIntensity { get; init; }
        public int MaxDurationMs { get; init; }
        public required OperateModeFlags Flags { get; init; }
        public bool CrossUser { get; init; }
    }

    public sealed class OperatePolicyError : Exception
    {
        public int Status { get; }
        public string Code { get; }

        public OperatePolicyError(string message, int status, string code) : base(message)
        {
            Status = status;
            Code = code;
        }
    }

    public sealed class ActivitySharePolicyRow
    {
        public required string DiscordUserId { get; init; }
        public int ShockerId { get; init; }
        public string? ShareCode { get; init; }
        public string? HubClientId { get; init; }
        public int DeviceMaxIntensity { get; init; }
        public int DeviceMaxDurationMs { get; init; }
        public bool Enabled { get; init; }
        public bool Paused { get; init; }
        public int MaxIntensity { get; init; }
        public int MaxDurationMs { get; init; }
        public bool CanShock { get; init; }
        public bool CanVibrate { get; init; }
        public bool CanBeep { get; init; }
        public bool CanHold { get; init; }
    }

    public sealed class OperatePolicyDeps
    {
        public required Func<string, Task<(int ActivityMaxIntensity, int ActivityMaxDurationMs)>> GetPersonalActivityLimits { get; init; }
        public required Func<PiShockCreds, Task<ControlSnapshot>> FetchControlSnapshot { get; init; }
        public required Func<string, Task<ActivitySharePolicyRow?>> FindActivityShareByCode { get; init; }
        public required Func<string, int, Task<ActivitySharePolicyRow?>> FindActivityShareByShocker { get; init; }
        public required Func<string, Task<bool>> GetConsent { get; init; }
        public required Func<string, string, Task<bool>> IsExecutorBanned { get; init; }
        public required Func<string, int, Task<bool>> IsEmergencyStopped { get; init; }
    }

    public static void AssertOperateRateLimit(string discordUserId)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var bucket = RateBuckets.GetOrAdd(discordUserId, _ => []);
        lock (bucket)
        {
            bucket.RemoveAll(t => now - t >= OperateRateWindowMs);
            if (bucket.Count >= OperateRateMax)
            {
                throw new OperatePolicyError(
                    "Too many commands — wait a moment before trying again",
                    429,
                    "RATE_LIMIT");
            }
            bucket.Add(now);
        }
    }

    public static int ClampIntensity(object? value, int max)
    {
        var n = ToDouble(value, 1);
        return (int)Math.Max(0, Math.Min(AbsMaxIntensity, Math.Min(max, n)));
    }

    public static int ClampDurationMs(object? value, int max)
    {
        var n = ToDouble(value, 300);
        return (int)Math.Max(AbsMinDurationMs, Math.Min(AbsMaxDurationMs, Math.Min(max, n)));
    }

    public static void AssertModeAllowed(string operation, bool hold, OperateModeFlags flags)
    {
        if ((operation is "shock" or "hold") && !flags.CanShock)
            throw new OperatePolicyError("Shock not allowed", 405, "MODE_DENIED");
        if ((operation is "vibrate" or "warning") && !flags.CanVibrate)
            throw new OperatePolicyError("Vibrate not allowed", 405, "MODE_DENIED");
        if (operation == "beep" && !flags.CanBeep)
            throw new OperatePolicyError("Beep not allowed", 405, "MODE_DENIED");
        if (hold && !flags.CanHold)
            throw new OperatePolicyError("Hold not allowed", 405, "MODE_DENIED");
    }

    public static void AssertWithinCeilings(
        object? intensity,
        object? durationMs,
        int maxIntensity,
        int maxDurationMs)
    {
        if (ToDouble(intensity, 1) > maxIntensity)
            throw new OperatePolicyError("Intensity exceeds allowed maximum", 412, "INTENSITY_CEILING");
        if (ToDouble(durationMs, 300) > maxDurationMs)
            throw new OperatePolicyError("Duration exceeds allowed maximum", 416, "DURATION_CEILING");
    }

    public static int? ShockerIdOf(JsonElement row)
    {
        var id = NumField(row, "Id", "id", "ShockerId", "shockerId");
        return id is > 0 ? (int)id.Value : null;
    }

    public static int? ShockerIdOf(Dictionary<string, object?> row)
    {
        var id = NumField(row, "Id", "id", "ShockerId", "shockerId");
        return id is > 0 ? (int)id.Value : null;
    }

    public static string? ShareCodeOf(JsonElement row) =>
        StrField(row, "ShareCode", "shareCode", "Code", "code");

    public static string? ShareCodeOf(Dictionary<string, object?> row) =>
        StrField(row, "ShareCode", "shareCode", "Code", "code");

    public static int DeviceMaxIntensityOf(JsonElement row)
    {
        var n = NumField(row, "MaxIntensity", "maxIntensity", "DeviceMaxIntensity");
        return Math.Max(1, Math.Min(AbsMaxIntensity, (int)(n ?? AbsMaxIntensity)));
    }

    public static int DeviceMaxIntensityOf(Dictionary<string, object?> row)
    {
        var n = NumField(row, "MaxIntensity", "maxIntensity", "DeviceMaxIntensity");
        return Math.Max(1, Math.Min(AbsMaxIntensity, (int)(n ?? AbsMaxIntensity)));
    }

    public static int DeviceMaxDurationMsOf(JsonElement row)
    {
        var ms = NumField(row, "MaxDurationMs", "maxDurationMs", "deviceMaxDurationMs");
        if (ms is not null)
            return Math.Max(AbsMinDurationMs, Math.Min(AbsMaxDurationMs, (int)ms.Value));
        var sec = NumField(row, "MaxDuration", "maxDuration", "Duration");
        if (sec is not null)
        {
            var asMs = sec.Value <= 60 ? (int)Math.Round(sec.Value * 1000) : (int)sec.Value;
            return Math.Max(AbsMinDurationMs, Math.Min(AbsMaxDurationMs, asMs));
        }
        return AbsMaxDurationMs;
    }

    public static int DeviceMaxDurationMsOf(Dictionary<string, object?> row)
    {
        var ms = NumField(row, "MaxDurationMs", "maxDurationMs", "deviceMaxDurationMs");
        if (ms is not null)
            return Math.Max(AbsMinDurationMs, Math.Min(AbsMaxDurationMs, (int)ms.Value));
        var sec = NumField(row, "MaxDuration", "maxDuration", "Duration");
        if (sec is not null)
        {
            var asMs = sec.Value <= 60 ? (int)Math.Round(sec.Value * 1000) : (int)sec.Value;
            return Math.Max(AbsMinDurationMs, Math.Min(AbsMaxDurationMs, asMs));
        }
        return AbsMaxDurationMs;
    }

    public static string? HubClientIdOf(JsonElement row) =>
        StrField(row, "ClientId", "clientId", "HubId", "hubId");

    public static string? HubClientIdOf(Dictionary<string, object?> row) =>
        StrField(row, "ClientId", "clientId", "HubId", "hubId");

    public static JsonElement? FindShockerInSnapshot(ControlSnapshot snapshot, int shockerId)
    {
        foreach (var raw in snapshot.Shockers)
        {
            if (raw.ValueKind != JsonValueKind.Object) continue;
            if (ShockerIdOf(raw) == shockerId) return raw;
        }
        return null;
    }

    public static JsonElement? FindClaimedShareInSnapshot(ControlSnapshot snapshot, string shareCode)
    {
        var want = shareCode.Trim().ToLowerInvariant();
        foreach (var raw in snapshot.Shared)
        {
            if (raw.ValueKind != JsonValueKind.Object) continue;
            var code = ShareCodeOf(raw);
            if (code is not null && code.ToLowerInvariant() == want) return raw;
        }
        return null;
    }

    public static HashSet<string> OwnedHubClientIds(ControlSnapshot snapshot)
    {
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var raw in snapshot.Hubs.Concat(snapshot.Shockers))
        {
            if (raw.ValueKind != JsonValueKind.Object) continue;
            var id = HubClientIdOf(raw);
            if (id is not null) ids.Add(id);
        }
        return ids;
    }

    public static async Task<ResolvedOperatePolicy> ResolveOwnOperatePolicyAsync(
        string callerDiscordUserId,
        PiShockCreds creds,
        int? shockerId,
        string? shareCode,
        OperatePolicyDeps deps)
    {
        var personal = await deps.GetPersonalActivityLimits(callerDiscordUserId);
        var snapshot = await deps.FetchControlSnapshot(creds);

        // Match JS truthiness: empty string skips; whitespace-only still enters.
        if (!string.IsNullOrEmpty(shareCode))
        {
            var code = shareCode.Trim();
            var registered = string.IsNullOrEmpty(code)
                ? null
                : await deps.FindActivityShareByCode(code);

            if (registered is not null)
            {
                if (registered.DiscordUserId != callerDiscordUserId)
                {
                    if (!await deps.GetConsent(registered.DiscordUserId))
                        throw new OperatePolicyError("Target has not consented", 403, "TARGET_CONSENT");
                    if (await deps.IsExecutorBanned(registered.DiscordUserId, callerDiscordUserId))
                        throw new OperatePolicyError(
                            "This user has blocked you from controlling their device",
                            403,
                            "BANNED");
                    if (!registered.Enabled || registered.Paused)
                        throw new OperatePolicyError("Share is not available", 404, "TARGET_UNAVAILABLE");
                    if (await deps.IsEmergencyStopped(registered.DiscordUserId, registered.ShockerId))
                        throw new OperatePolicyError("Owner has emergency stop engaged", 423, "EMERGENCY_STOP");

                    return new ResolvedOperatePolicy
                    {
                        OwnerDiscordUserId = registered.DiscordUserId,
                        ShockerId = registered.ShockerId,
                        ShareCode = registered.ShareCode,
                        HubClientId = registered.HubClientId,
                        MaxIntensity = Math.Min(registered.MaxIntensity, registered.DeviceMaxIntensity),
                        MaxDurationMs = Math.Min(registered.MaxDurationMs, registered.DeviceMaxDurationMs),
                        Flags = new OperateModeFlags
                        {
                            CanShock = registered.CanShock,
                            CanVibrate = registered.CanVibrate,
                            CanBeep = registered.CanBeep,
                            CanHold = registered.CanHold,
                        },
                        CrossUser = true,
                    };
                }

                if (await deps.IsEmergencyStopped(callerDiscordUserId, registered.ShockerId))
                {
                    throw new OperatePolicyError(
                        "Emergency stop is engaged — release STOP to allow commands",
                        423,
                        "EMERGENCY_STOP");
                }

                return new ResolvedOperatePolicy
                {
                    OwnerDiscordUserId = callerDiscordUserId,
                    ShockerId = registered.ShockerId,
                    ShareCode = registered.ShareCode,
                    HubClientId = registered.HubClientId,
                    MaxIntensity = Math.Min(
                        Math.Min(registered.MaxIntensity, registered.DeviceMaxIntensity),
                        personal.ActivityMaxIntensity),
                    MaxDurationMs = Math.Min(
                        Math.Min(registered.MaxDurationMs, registered.DeviceMaxDurationMs),
                        personal.ActivityMaxDurationMs),
                    Flags = new OperateModeFlags
                    {
                        CanShock = registered.CanShock,
                        CanVibrate = registered.CanVibrate,
                        CanBeep = registered.CanBeep,
                        CanHold = registered.CanHold,
                    },
                    CrossUser = false,
                };
            }

            var claimed = string.IsNullOrEmpty(code)
                ? null
                : FindClaimedShareInSnapshot(snapshot, code);
            if (claimed is null)
                throw new OperatePolicyError("Unknown or unauthorized share code", 404, "SHARE_UNKNOWN");

            var claimedShockerId = ShockerIdOf(claimed.Value) ?? shockerId;
            if (claimedShockerId is not null
                && await deps.IsEmergencyStopped(callerDiscordUserId, claimedShockerId.Value))
            {
                throw new OperatePolicyError(
                    "Emergency stop is engaged — release STOP to allow commands",
                    423,
                    "EMERGENCY_STOP");
            }

            var deviceMaxI = DeviceMaxIntensityOf(claimed.Value);
            var deviceMaxD = DeviceMaxDurationMsOf(claimed.Value);
            return new ResolvedOperatePolicy
            {
                OwnerDiscordUserId = callerDiscordUserId,
                ShockerId = claimedShockerId,
                ShareCode = code,
                HubClientId = HubClientIdOf(claimed.Value),
                MaxIntensity = Math.Min(deviceMaxI, personal.ActivityMaxIntensity),
                MaxDurationMs = Math.Min(deviceMaxD, personal.ActivityMaxDurationMs),
                Flags = new OperateModeFlags(),
                CrossUser = false,
            };
        }

        var sid = shockerId ?? double.NaN;
        // Match Number(undefined) => NaN, Number(0) => 0
        double sidNum;
        if (shockerId is null) sidNum = double.NaN;
        else sidNum = shockerId.Value;

        if (double.IsNaN(sidNum) || sidNum <= 0)
            throw new OperatePolicyError("Missing shockerId or shareCode", 400, "BAD_REQUEST");

        var shockerIdInt = (int)sidNum;
        if (await deps.IsEmergencyStopped(callerDiscordUserId, shockerIdInt))
        {
            throw new OperatePolicyError(
                "Emergency stop is engaged — release STOP to allow commands",
                423,
                "EMERGENCY_STOP");
        }

        var owned = FindShockerInSnapshot(snapshot, shockerIdInt);
        if (owned is null)
            throw new OperatePolicyError("Shocker not found on this PiShock account", 404, "SHOCKER_UNKNOWN");

        var activityShare = await deps.FindActivityShareByShocker(callerDiscordUserId, shockerIdInt);
        var deviceMaxIntensity = activityShare is not null
            ? Math.Min(activityShare.DeviceMaxIntensity, DeviceMaxIntensityOf(owned.Value))
            : DeviceMaxIntensityOf(owned.Value);
        var deviceMaxDuration = activityShare is not null
            ? Math.Min(activityShare.DeviceMaxDurationMs, DeviceMaxDurationMsOf(owned.Value))
            : DeviceMaxDurationMsOf(owned.Value);

        return new ResolvedOperatePolicy
        {
            OwnerDiscordUserId = callerDiscordUserId,
            ShockerId = shockerIdInt,
            ShareCode = null,
            HubClientId = activityShare?.HubClientId ?? HubClientIdOf(owned.Value),
            MaxIntensity = Math.Min(deviceMaxIntensity, personal.ActivityMaxIntensity),
            MaxDurationMs = Math.Min(deviceMaxDuration, personal.ActivityMaxDurationMs),
            Flags = activityShare is not null
                ? new OperateModeFlags
                {
                    CanShock = activityShare.CanShock,
                    CanVibrate = activityShare.CanVibrate,
                    CanBeep = activityShare.CanBeep,
                    CanHold = activityShare.CanHold,
                }
                : new OperateModeFlags(),
            CrossUser = false,
        };
    }

    // Overload that accepts Dictionary rows for tests
    public static int DeviceMaxDurationMsOf(IReadOnlyDictionary<string, object?> row)
    {
        var dict = row.ToDictionary(kv => kv.Key, kv => kv.Value);
        return DeviceMaxDurationMsOf(dict);
    }

    public static string HoldTimerKey(string ownerDiscordUserId, int shockerId) =>
        $"{ownerDiscordUserId}:{shockerId}";

    public static void ClearHoldAutoEnd(string ownerDiscordUserId, int shockerId)
    {
        var key = HoldTimerKey(ownerDiscordUserId, shockerId);
        if (HoldEndTimers.TryRemove(key, out var existing))
        {
            existing.Dispose();
        }
    }

    public static void ScheduleHoldAutoEnd(
        PiShockCreds creds,
        string ownerDiscordUserId,
        int shockerId,
        string clientId,
        int durationMs,
        string? shareCode,
        string? agentName,
        Func<PiShockCreds, string, int, string?, string?, Task> publishEnd)
    {
        ClearHoldAutoEnd(ownerDiscordUserId, shockerId);
        var delay = Math.Max(AbsMinDurationMs, durationMs) + HoldAutoEndGraceMs;
        var key = HoldTimerKey(ownerDiscordUserId, shockerId);
        Timer? timer = null;
        timer = new Timer(_ =>
        {
            HoldEndTimers.TryRemove(key, out Timer? _);
            _ = publishEnd(creds, clientId, shockerId, shareCode, agentName ?? "Hold Limit");
            timer?.Dispose();
        }, null, delay, Timeout.Infinite);
        HoldEndTimers[key] = timer;
    }

    public static async Task<(int DeviceMaxIntensity, int DeviceMaxDurationMs, string? HubClientId, bool Found)>
        ResolveDeviceCeilingsFromPiShockAsync(
            PiShockCreds creds,
            int shockerId,
            Func<PiShockCreds, Task<ControlSnapshot>> fetchSnapshot)
    {
        var snapshot = await fetchSnapshot(creds);
        var owned = FindShockerInSnapshot(snapshot, shockerId);
        if (owned is null)
        {
            return (AbsMaxIntensity, AbsMaxDurationMs, null, false);
        }
        return (
            DeviceMaxIntensityOf(owned.Value),
            DeviceMaxDurationMsOf(owned.Value),
            HubClientIdOf(owned.Value),
            true);
    }

    public static string? VerifyOwnedClientId(ControlSnapshot snapshot, object? clientId)
    {
        if (clientId is null) return null;
        var want = clientId.ToString()?.Trim() ?? "";
        if (string.IsNullOrEmpty(want)) return null;
        var owned = OwnedHubClientIds(snapshot);
        return owned.Contains(want) ? want : null;
    }

    private static double ToDouble(object? value, double fallback)
    {
        if (value is null) return fallback;
        return value switch
        {
            double d => d,
            float f => f,
            int i => i,
            long l => l,
            decimal m => (double)m,
            string s when double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            JsonElement je when je.ValueKind == JsonValueKind.Number => je.GetDouble(),
            JsonElement je when je.ValueKind == JsonValueKind.String
                && double.TryParse(je.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => Convert.ToDouble(value, CultureInfo.InvariantCulture),
        };
    }

    private static double? NumField(JsonElement row, params string[] keys)
    {
        foreach (var key in keys)
        {
            if (!row.TryGetProperty(key, out var v)) continue;
            if (v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out var d) && double.IsFinite(d))
                return d;
            if (v.ValueKind == JsonValueKind.String
                && !string.IsNullOrWhiteSpace(v.GetString())
                && double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n)
                && double.IsFinite(n))
                return n;
        }
        return null;
    }

    private static double? NumField(Dictionary<string, object?> row, params string[] keys)
    {
        foreach (var key in keys)
        {
            if (!row.TryGetValue(key, out var v) || v is null) continue;
            try
            {
                var d = ToDouble(v, double.NaN);
                if (double.IsFinite(d)) return d;
            }
            catch
            {
                // ignore
            }
        }
        return null;
    }

    private static string? StrField(JsonElement row, params string[] keys)
    {
        foreach (var key in keys)
        {
            if (!row.TryGetProperty(key, out var v)) continue;
            var s = v.ToString()?.Trim();
            if (!string.IsNullOrEmpty(s)) return s;
        }
        return null;
    }

    private static string? StrField(Dictionary<string, object?> row, params string[] keys)
    {
        foreach (var key in keys)
        {
            if (!row.TryGetValue(key, out var v) || v is null) continue;
            var s = v.ToString()?.Trim();
            if (!string.IsNullOrEmpty(s)) return s;
        }
        return null;
    }
}
