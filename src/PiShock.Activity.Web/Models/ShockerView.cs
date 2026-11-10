namespace PiShock.Activity.Web.Models;

/// <summary>Port of the React ShockerView type.</summary>
public sealed class ShockerView
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string? HubName { get; set; }
    public string? ClientId { get; set; }
    public bool Owned { get; set; }
    public bool Paused { get; set; }
    public string? ShareCode { get; set; }
    public int? ShareId { get; set; }

    /// <summary>When set, operate goes through /api/participants/:id/operate.</summary>
    public string? TargetDiscordUserId { get; set; }

    public bool CanShock { get; set; } = true;
    public bool CanVibrate { get; set; } = true;
    public bool CanBeep { get; set; } = true;
    public bool CanHold { get; set; } = true;
    public bool CanPause { get; set; }

    /// <summary>Effective usable max = min(device, activity).</summary>
    public int MaxIntensity { get; set; } = 100;
    public int MaxDuration { get; set; } = 15_000;

    public int? DeviceMaxIntensity { get; set; }
    public int? DeviceMaxDuration { get; set; }
    public int? ActivityMaxIntensity { get; set; }
    public int? ActivityMaxDuration { get; set; }

    public bool DiscordShareEnabled { get; set; }
    public int? DiscordShareMaxIntensity { get; set; }
    public int? DiscordShareMaxDuration { get; set; }

    public bool IsV3 { get; set; } = true;
    public bool? Online { get; set; }
    public bool EmergencyStop { get; set; }

    public ShockerView Clone() => (ShockerView)MemberwiseClone();

    /// <summary>Usable intensity ceiling (min of device and activity limits).</summary>
    public int UsableIntensity =>
        Math.Min(DeviceMaxIntensity ?? MaxIntensity, ActivityMaxIntensity ?? MaxIntensity);

    /// <summary>Usable duration ceiling in ms.</summary>
    public int UsableDuration =>
        Math.Min(DeviceMaxDuration ?? MaxDuration, ActivityMaxDuration ?? MaxDuration);

    public string MultiColorKey =>
        TargetDiscordUserId is not null ? $"u:{TargetDiscordUserId}:s:{Id}"
        : Owned ? $"own:{Id}"
        : $"s:{Id}";

    public string MultiUserKey =>
        TargetDiscordUserId is not null ? $"u:{TargetDiscordUserId}"
        : Owned ? "own"
        : $"s:{Id}";

    public string MultiColor => MultiColors.ForShocker(MultiUserKey, Id);
}

public sealed class HubInfo
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string? LastSeen { get; set; }
    public bool Online { get; set; }
}

public sealed class WarningSpec
{
    public bool Active { get; set; }
    public int Intensity { get; set; }
    public int DurationMs { get; set; }
    public int Min { get; set; }
    public int Max { get; set; }
}

/// <summary>Port of OfficialOperateInput.</summary>
public sealed class OfficialOperateInput
{
    public int ShockerId { get; set; }
    public string? ShareCode { get; set; }
    public string? ClientId { get; set; }
    public string? TargetDiscordUserId { get; set; }
    public string Operation { get; set; } = "vibrate";
    public int Intensity { get; set; }
    public int DurationMs { get; set; }
    public bool CanShock { get; set; }
    public bool CanVibrate { get; set; }
    public bool CanBeep { get; set; }
    public bool CanHold { get; set; }
    public int MaxIntensity { get; set; }
    public int MaxDuration { get; set; }
    public WarningSpec? Warning { get; set; }
    public bool Hold { get; set; }

    /// <summary>Wire body matching the React client (camelCase; warning keys are PascalCase like the server expects).</summary>
    public Dictionary<string, object?> ToBody()
    {
        var body = new Dictionary<string, object?>
        {
            ["shockerId"] = ShockerId,
            ["operation"] = Operation,
            ["intensity"] = Intensity,
            ["durationMs"] = DurationMs,
            ["canShock"] = CanShock,
            ["canVibrate"] = CanVibrate,
            ["canBeep"] = CanBeep,
            ["canHold"] = CanHold,
            ["maxIntensity"] = MaxIntensity,
            ["maxDuration"] = MaxDuration,
            ["hold"] = Hold,
        };
        if (ShareCode is not null) body["shareCode"] = ShareCode;
        if (ClientId is not null) body["clientId"] = ClientId;
        if (TargetDiscordUserId is not null) body["targetDiscordUserId"] = TargetDiscordUserId;
        if (Warning is not null)
        {
            body["warning"] = new Dictionary<string, object?>
            {
                ["Active"] = Warning.Active,
                ["Intensity"] = Warning.Intensity,
                ["DurationMs"] = Warning.DurationMs,
                ["Min"] = Warning.Min,
                ["Max"] = Warning.Max,
            };
        }
        return body;
    }
}

public sealed class EmergencyStopInput
{
    public int ShockerId { get; set; }
    public string? ClientId { get; set; }
    public bool Engaged { get; set; }
}

public sealed class IncomingShockHit
{
    public string ExecutorDiscordUserId { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string AvatarUrl { get; set; } = "";
    public string Action { get; set; } = "";
    public int? Intensity { get; set; }
    public int? DurationMs { get; set; }
    public long At { get; set; }
    public bool Success { get; set; }
    public string? TargetDiscordUserId { get; set; }
    public string? TargetDisplayName { get; set; }
    public string? TargetAvatarUrl { get; set; }

    /// <summary>"personal" = last hit on you; "activity" = latest from public log.</summary>
    public string Kind { get; set; } = "personal";
}

public static class MultiColors
{
    public static uint HashString(string s)
    {
        uint hash = 0;
        foreach (var c in s) hash = unchecked(hash * 31 + c);
        return hash;
    }

    private static string HslToHex(double h, double s, double l)
    {
        var sat = s / 100;
        var light = l / 100;
        var c = (1 - Math.Abs(2 * light - 1)) * sat;
        var hp = (((h % 360) + 360) % 360) / 60;
        var x = c * (1 - Math.Abs(hp % 2 - 1));
        double r, g, b;
        if (hp < 1) (r, g, b) = (c, x, 0);
        else if (hp < 2) (r, g, b) = (x, c, 0);
        else if (hp < 3) (r, g, b) = (0, c, x);
        else if (hp < 4) (r, g, b) = (0, x, c);
        else if (hp < 5) (r, g, b) = (x, 0, c);
        else (r, g, b) = (c, 0, x);
        var m = light - c / 2;
        string To(double v) => ((int)Math.Round((v + m) * 255)).ToString("x2");
        return $"#{To(r)}{To(g)}{To(b)}";
    }

    private static double BaseHue(string userKey) => HashString(userKey) % 360;

    public static string ForUser(string userKey) => HslToHex(BaseHue(userKey), 62, 58);

    public static string ForShocker(string userKey, int shockerId)
    {
        var baseHue = BaseHue(userKey);
        var h = HashString($"s:{shockerId}");
        var hue = (baseHue + ((int)(h % 5) - 2) * 10 + 360) % 360;
        var sat = 58 + (h % 4) * 7;
        var light = 52 + ((h >> 3) % 4) * 5;
        return HslToHex(hue, sat, light);
    }
}
