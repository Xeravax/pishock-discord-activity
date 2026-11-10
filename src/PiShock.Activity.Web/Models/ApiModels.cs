using System.Text.Json.Serialization;

namespace PiShock.Activity.Web.Models;

public sealed class MeResponse
{
    [JsonPropertyName("consent")]
    public bool Consent { get; set; }

    [JsonPropertyName("pishockLinked")]
    public bool PishockLinked { get; set; }

    [JsonPropertyName("pishockUserId")]
    public int? PishockUserId { get; set; }

    [JsonPropertyName("user")]
    public MeUser? User { get; set; }

    [JsonPropertyName("personal")]
    public PersonalLimits? Personal { get; set; }

    [JsonPropertyName("emergencyStopShockerIds")]
    public int[]? EmergencyStopShockerIds { get; set; }

    public string DisplayName => User?.GlobalName is { Length: > 0 } g ? g : User?.Username ?? "You";
}

public sealed class MeUser
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("username")]
    public string Username { get; set; } = "";

    [JsonPropertyName("global_name")]
    public string? GlobalName { get; set; }

    [JsonPropertyName("avatar")]
    public string? Avatar { get; set; }
}

public sealed class PersonalLimits
{
    [JsonPropertyName("activityMaxIntensity")]
    public int ActivityMaxIntensity { get; set; } = 100;

    [JsonPropertyName("activityMaxDurationMs")]
    public int ActivityMaxDurationMs { get; set; } = 15_000;

    public PersonalLimits Clone() => new()
    {
        ActivityMaxIntensity = ActivityMaxIntensity,
        ActivityMaxDurationMs = ActivityMaxDurationMs,
    };
}

/// <summary>Per-shocker Discord share config (used for both /activity/share and /activity/settings).</summary>
public sealed class ShareLimitRow
{
    [JsonPropertyName("shockerId")]
    public int ShockerId { get; set; }

    [JsonPropertyName("shockerName")]
    public string ShockerName { get; set; } = "";

    [JsonPropertyName("hubClientId")]
    public string? HubClientId { get; set; }

    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; } = true;

    [JsonPropertyName("paused")]
    public bool Paused { get; set; }

    [JsonPropertyName("deviceMaxIntensity")]
    public int? DeviceMaxIntensity { get; set; }

    [JsonPropertyName("deviceMaxDurationMs")]
    public int? DeviceMaxDurationMs { get; set; }

    [JsonPropertyName("maxIntensity")]
    public int MaxIntensity { get; set; } = 100;

    [JsonPropertyName("maxDurationMs")]
    public int MaxDurationMs { get; set; } = 15_000;

    [JsonPropertyName("canShock")]
    public bool CanShock { get; set; } = true;

    [JsonPropertyName("canVibrate")]
    public bool CanVibrate { get; set; } = true;

    [JsonPropertyName("canBeep")]
    public bool CanBeep { get; set; } = true;

    [JsonPropertyName("canHold")]
    public bool CanHold { get; set; } = true;

    public static ShareLimitRow FromShocker(ShockerView s)
    {
        var deviceMaxI = Math.Min(100, s.DeviceMaxIntensity ?? s.MaxIntensity);
        var deviceMaxD = Math.Min(15_000, s.DeviceMaxDuration ?? s.MaxDuration);
        return new ShareLimitRow
        {
            ShockerId = s.Id,
            ShockerName = s.Name,
            HubClientId = s.ClientId,
            Enabled = true,
            Paused = false,
            DeviceMaxIntensity = deviceMaxI,
            DeviceMaxDurationMs = deviceMaxD,
            MaxIntensity = Math.Min(deviceMaxI, s.ActivityMaxIntensity ?? deviceMaxI),
            MaxDurationMs = Math.Min(deviceMaxD, s.ActivityMaxDuration ?? deviceMaxD),
            CanShock = s.CanShock,
            CanVibrate = s.CanVibrate,
            CanBeep = s.CanBeep,
            CanHold = s.CanHold,
        };
    }
}

public sealed class ActivityShareResponse
{
    [JsonPropertyName("shares")]
    public List<ShareLimitRow> Shares { get; set; } = [];

    [JsonPropertyName("bannedDiscordUserIds")]
    public List<string> BannedDiscordUserIds { get; set; } = [];

    [JsonPropertyName("available")]
    public bool Available { get; set; }

    [JsonPropertyName("personal")]
    public PersonalLimits? Personal { get; set; }
}

public sealed class ActivitySettingsResponse
{
    [JsonPropertyName("personal")]
    public PersonalLimits Personal { get; set; } = new();

    [JsonPropertyName("shares")]
    public List<ShareLimitRow> Shares { get; set; } = [];
}

public sealed class AnnouncementItem
{
    [JsonPropertyName("text")]
    public string Text { get; set; } = "";

    [JsonPropertyName("link")]
    public string? Link { get; set; }

    [JsonPropertyName("expires")]
    public string? Expires { get; set; }

    public string Key => $"{Text}::{Link ?? ""}";
}

public sealed class AnnouncementsResponse
{
    [JsonPropertyName("announcements")]
    public List<AnnouncementItem>? Announcements { get; set; }
}

/// <summary>Row shown in the (demo) command log.</summary>
public sealed class CommandLogRow
{
    public string Id { get; set; } = "";
    public string Action { get; set; } = "";
    public int? ShockerId { get; set; }
    public int? Intensity { get; set; }
    public int? DurationMs { get; set; }
    public bool Success { get; set; }
    public string? Detail { get; set; }
    public DateTime CreatedAt { get; set; }
    public string? ExecutorDiscordUserId { get; set; }
    public string? TargetDiscordUserId { get; set; }
}
