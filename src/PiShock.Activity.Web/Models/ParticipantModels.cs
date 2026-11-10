using System.Text.Json;
using System.Text.Json.Serialization;
using System.Numerics;

namespace PiShock.Activity.Web.Models;

public sealed class DiscordParticipant
{
    public string Id { get; set; } = "";
    public string? Username { get; set; }
    public string? GlobalName { get; set; }
    public string? Avatar { get; set; }
    public string DisplayName { get; set; } = "Unknown";
    public string AvatarUrl { get; set; } = "";
}

public sealed class ParticipantShockerStatus
{
    [JsonPropertyName("shockerId")] public int ShockerId { get; set; }
    [JsonPropertyName("shockerName")] public string ShockerName { get; set; } = "";
    [JsonPropertyName("hubClientId")] public string? HubClientId { get; set; }
    [JsonPropertyName("deviceMaxIntensity")] public int DeviceMaxIntensity { get; set; } = 100;
    [JsonPropertyName("deviceMaxDurationMs")] public int DeviceMaxDurationMs { get; set; } = 15_000;
    [JsonPropertyName("maxIntensity")] public int MaxIntensity { get; set; } = 100;
    [JsonPropertyName("maxDurationMs")] public int MaxDurationMs { get; set; } = 15_000;
    [JsonPropertyName("canShock")] public bool CanShock { get; set; }
    [JsonPropertyName("canVibrate")] public bool CanVibrate { get; set; }
    [JsonPropertyName("canBeep")] public bool CanBeep { get; set; }
    [JsonPropertyName("canHold")] public bool CanHold { get; set; }
    [JsonPropertyName("paused")] public bool Paused { get; set; }
    [JsonPropertyName("emergencyStop")] public bool EmergencyStop { get; set; }
}

public sealed class ParticipantStatus
{
    [JsonPropertyName("discordUserId")] public string DiscordUserId { get; set; } = "";
    [JsonPropertyName("username")] public string? Username { get; set; }
    [JsonPropertyName("globalName")] public string? GlobalName { get; set; }
    [JsonPropertyName("avatar")] public string? Avatar { get; set; }
    [JsonPropertyName("linked")] public bool Linked { get; set; }
    [JsonPropertyName("consent")] public bool Consent { get; set; }
    [JsonPropertyName("available")] public bool Available { get; set; }
    [JsonPropertyName("paused")] public bool Paused { get; set; }
    [JsonPropertyName("emergencyStop")] public bool EmergencyStop { get; set; }
    [JsonPropertyName("bannedYou")] public bool BannedYou { get; set; }
    [JsonPropertyName("shockers")] public List<ParticipantShockerStatus> Shockers { get; set; } = [];
}

public sealed class ParticipantStatusResponse
{
    [JsonPropertyName("participants")]
    public List<ParticipantStatus>? Participants { get; set; }
}

public static class ParticipantUtil
{
    private static int DefaultAvatarIndex(string userId)
    {
        if (userId.Length > 0 && userId.All(char.IsDigit) && BigInteger.TryParse(userId, out var big))
        {
            return (int)((big >> 22) % 6);
        }

        var hash = 0;
        foreach (var c in userId)
        {
            hash = unchecked((hash << 5) - hash + c);
        }
        return Math.Abs(hash == int.MinValue ? 0 : hash) % 6;
    }

    public static string AvatarUrl(string id, string? avatar = null) =>
        !string.IsNullOrEmpty(avatar)
            ? $"https://cdn.discordapp.com/avatars/{id}/{avatar}.png?size=128"
            : $"https://cdn.discordapp.com/embed/avatars/{DefaultAvatarIndex(id)}.png";

    public static DiscordParticipant Normalize(JsonElement raw)
    {
        var id = Json.Str(raw, "id", "user_id") ?? "";
        var username = Json.Str(raw, "username");
        var globalName = Json.Str(raw, "global_name", "globalName");
        var avatar = Json.Str(raw, "avatar");
        var nick = Json.Str(raw, "nickname", "nick");
        var display = !string.IsNullOrEmpty(nick) ? nick
            : !string.IsNullOrEmpty(globalName) ? globalName
            : !string.IsNullOrEmpty(username) ? username
            : "Unknown";
        return new DiscordParticipant
        {
            Id = id,
            Username = username,
            GlobalName = globalName,
            Avatar = avatar,
            DisplayName = display,
            AvatarUrl = AvatarUrl(id, avatar),
        };
    }

    public static List<DiscordParticipant> NormalizeList(JsonElement list)
    {
        var rows = new List<DiscordParticipant>();
        if (list.ValueKind != JsonValueKind.Array) return rows;
        foreach (var item in list.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object) rows.Add(Normalize(item));
        }
        return rows;
    }
}
