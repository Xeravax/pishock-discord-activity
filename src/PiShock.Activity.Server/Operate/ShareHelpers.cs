namespace PiShock.Activity.Server.Operate;

public static class ShareHelpers
{
    public static (int MaxIntensity, int MaxDurationMs) ClampShareLimits(
        int deviceMaxIntensity,
        int deviceMaxDurationMs,
        object? requestedMaxIntensity = null,
        object? requestedMaxDurationMs = null,
        object? previousMaxIntensity = null,
        object? previousMaxDurationMs = null)
    {
        static int ToInt(object? value, int fallback)
        {
            if (value is null) return fallback;
            return value switch
            {
                int i => i,
                long l => (int)l,
                double d => (int)d,
                float f => (int)f,
                string s when int.TryParse(s, out var n) => n,
                _ => Convert.ToInt32(value),
            };
        }

        var maxIntensity = Math.Max(
            1,
            Math.Min(
                deviceMaxIntensity,
                ToInt(requestedMaxIntensity ?? previousMaxIntensity ?? deviceMaxIntensity, deviceMaxIntensity)));

        var maxDurationMs = Math.Max(
            OperatePolicy.AbsMinDurationMs,
            Math.Min(
                deviceMaxDurationMs,
                ToInt(requestedMaxDurationMs ?? previousMaxDurationMs ?? deviceMaxDurationMs, deviceMaxDurationMs)));

        return (maxIntensity, maxDurationMs);
    }

    public static string? RetainedShareCode(string? previousShareCode, string? clientShareCode = null) =>
        previousShareCode;

    public static object SerializeShare(
        int shockerId,
        string shockerName,
        string? hubClientId,
        string? shareCode,
        int deviceMaxIntensity,
        int deviceMaxDurationMs,
        bool enabled,
        bool paused,
        int maxIntensity,
        int maxDurationMs,
        bool canShock,
        bool canVibrate,
        bool canBeep,
        bool canHold) => new
    {
        shockerId,
        shockerName,
        hubClientId,
        hasShareCode = !string.IsNullOrEmpty(shareCode),
        deviceMaxIntensity,
        deviceMaxDurationMs,
        enabled,
        paused,
        maxIntensity,
        maxDurationMs,
        canShock,
        canVibrate,
        canBeep,
        canHold,
    };
}
