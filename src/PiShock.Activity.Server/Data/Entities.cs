using System.Text.Json.Serialization;

namespace PiShock.Activity.Server.Data;

// Entity classes mirror prisma/schema.prisma field-for-field (PascalCase CLR names; the
// camelCase quoted column names are applied in AppDbContext.OnModelCreating).

public class DiscordUser
{
    public string Id { get; set; } = "";
    public string? Username { get; set; }
    public string? GlobalName { get; set; }
    public string? Avatar { get; set; }
    public DateTime? ConsentAt { get; set; }

    /// <summary>Personal Discord Activity operate caps (own devices). Separate from PiShock device max.</summary>
    public int ActivityMaxIntensity { get; set; } = 100;

    public int ActivityMaxDurationMs { get; set; } = 15000;

    /// <summary>
    /// Owner kill-switch: shocker ids with emergency stop latched in. Blocks all commands until released.
    /// Column is nullable in PostgreSQL (Prisma <c>Int[] @default([])</c>); treat null as empty.
    /// </summary>
    public int[]? EmergencyStopShockerIds { get; set; } = [];

    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    [JsonIgnore] public PiShockSession? PishockSession { get; set; }
    [JsonIgnore] public List<CommandLog> CommandLogs { get; set; } = [];
    [JsonIgnore] public List<ActivityShare> ActivityShares { get; set; } = [];

    /// <summary>Bans this user (as owner) has issued.</summary>
    [JsonIgnore] public List<ActivityBan> ActivityBans { get; set; } = [];

    /// <summary>Bans where this user is the banned party.</summary>
    [JsonIgnore] public List<ActivityBan> BannedBy { get; set; } = [];
}

public class PiShockSession
{
    public string Id { get; set; } = Cuid.NewCuid();
    public string DiscordUserId { get; set; } = "";
    public int PishockUserId { get; set; }

    /// <summary>AES-256-GCM ciphertext of the PiShock session token (never returned to the browser).</summary>
    public string EncryptedToken { get; set; } = "";

    public string TokenIv { get; set; } = "";
    public string TokenAuthTag { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    [JsonIgnore] public DiscordUser? DiscordUser { get; set; }
}

public class ActivityShare
{
    public string Id { get; set; } = Cuid.NewCuid();
    public string DiscordUserId { get; set; } = "";
    public int ShockerId { get; set; }
    public string ShockerName { get; set; } = "";
    public string? HubClientId { get; set; }

    /// <summary>PiShock share code used when the executor has their own session (OperateByShare).</summary>
    public string? ShareCode { get; set; }

    /// <summary>Hard ceiling from the PiShock device/share (UI red zone above this).</summary>
    public int DeviceMaxIntensity { get; set; } = 100;

    public int DeviceMaxDurationMs { get; set; } = 15000;
    public bool Enabled { get; set; } = true;
    public bool Paused { get; set; }

    /// <summary>Discord Activity Limit — must be ≤ device max; separate from PiShock website limits.</summary>
    public int MaxIntensity { get; set; } = 100;

    public int MaxDurationMs { get; set; } = 15000;
    public bool CanShock { get; set; } = true;
    public bool CanVibrate { get; set; } = true;
    public bool CanBeep { get; set; } = true;
    public bool CanHold { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    [JsonIgnore] public DiscordUser? DiscordUser { get; set; }
}

public class ActivityBan
{
    public string Id { get; set; } = Cuid.NewCuid();
    public string OwnerDiscordUserId { get; set; } = "";
    public string BannedDiscordUserId { get; set; } = "";
    public DateTime CreatedAt { get; set; }

    [JsonIgnore] public DiscordUser? Owner { get; set; }
    [JsonIgnore] public DiscordUser? Banned { get; set; }
}

public class CommandLog
{
    public string Id { get; set; } = Cuid.NewCuid();
    public string DiscordUserId { get; set; } = "";
    public string? ExecutorDiscordUserId { get; set; }
    public string? TargetDiscordUserId { get; set; }

    /// <summary>Display name when the executor is not a Discord user (e.g. PiShock website panel).</summary>
    public string? ExecutorLabel { get; set; }

    public string Action { get; set; } = "";
    public int? ShockerId { get; set; }
    public string? ShareCode { get; set; }
    public int? Intensity { get; set; }
    public int? DurationMs { get; set; }
    public bool Success { get; set; }
    public string? Detail { get; set; }

    /// <summary>"discord" = this Discord activity app; "website" = PiShock website / other panel.</summary>
    public string Source { get; set; } = "discord";

    public string? InstanceId { get; set; }
    public string? GuildId { get; set; }
    public string? ChannelId { get; set; }
    public string? LocationKind { get; set; }
    public string? LocationName { get; set; }
    public string? LocationIconUrl { get; set; }

    /// <summary>Stable key for synced website device logs (dedupe).</summary>
    public string? ExternalLogKey { get; set; }

    public DateTime CreatedAt { get; set; }

    [JsonIgnore] public DiscordUser? DiscordUser { get; set; }
}
