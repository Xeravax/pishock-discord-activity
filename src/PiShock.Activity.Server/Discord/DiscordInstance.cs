using System.Net.Http.Headers;
using System.Text.Json;

namespace PiShock.Activity.Server.Discord;

public sealed class ActivityInstanceInfo
{
    public string ApplicationId { get; set; } = "";
    public string InstanceId { get; set; } = "";
    public string? LaunchId { get; set; }
    public List<string> Users { get; set; } = [];
    public ActivityInstanceLocation? Location { get; set; }
}

public sealed class ActivityInstanceLocation
{
    public string? Id { get; set; }
    public string? Kind { get; set; }
    public string? ChannelId { get; set; }
    public string? GuildId { get; set; }
}

public sealed class InstanceAuthError : Exception
{
    public int Status { get; }

    public InstanceAuthError(string message, int status = 403) : base(message)
    {
        Status = status;
    }
}

public static class DiscordInstance
{
    public static async Task<ActivityInstanceInfo?> VerifyActivityInstanceAsync(
        AppEnv env,
        string instanceId,
        HttpClient http,
        string? requireUserId = null,
        IEnumerable<string>? requireUserIds = null,
        bool allowMissingBot = false)
    {
        if (string.IsNullOrEmpty(instanceId))
        {
            throw new InstanceAuthError("Missing activity instanceId", 400);
        }

        var allowSkip = allowMissingBot && env.AllowMissingBotInstanceCheck;
        if (string.IsNullOrEmpty(env.DiscordBotToken))
        {
            if (allowSkip) return null;
            throw new InstanceAuthError(
                "DISCORD_BOT_TOKEN is required for Discord participant actions",
                503);
        }

        var url =
            $"https://discord.com/api/v10/applications/{env.DiscordClientId}/activity-instances/{Uri.EscapeDataString(instanceId)}";
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bot", env.DiscordBotToken);
        using var res = await http.SendAsync(req);
        if (res.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            throw new InstanceAuthError("Activity instance is not active", 403);
        }
        if (!res.IsSuccessStatusCode)
        {
            var text = await res.Content.ReadAsStringAsync();
            throw new InstanceAuthError(
                $"Activity instance check failed: {(int)res.StatusCode} {text}",
                502);
        }

        await using var stream = await res.Content.ReadAsStreamAsync();
        using var doc = await JsonDocument.ParseAsync(stream);
        var root = doc.RootElement;
        var users = root.TryGetProperty("users", out var usersEl) && usersEl.ValueKind == JsonValueKind.Array
            ? usersEl.EnumerateArray().Select(u => u.ToString()).ToList()
            : [];

        var info = new ActivityInstanceInfo
        {
            ApplicationId = root.TryGetProperty("application_id", out var app) ? app.ToString() : "",
            InstanceId = root.TryGetProperty("instance_id", out var iid) ? iid.ToString() : instanceId,
            Users = users,
            LaunchId = OptString(root, "launch_id"),
            Location = root.TryGetProperty("location", out var locEl) && locEl.ValueKind == JsonValueKind.Object
                ? new ActivityInstanceLocation
                {
                    Id = OptString(locEl, "id"),
                    Kind = OptString(locEl, "kind"),
                    ChannelId = OptString(locEl, "channel_id"),
                    GuildId = OptString(locEl, "guild_id"),
                }
                : null,
        };

        if (!string.IsNullOrEmpty(requireUserId) && !users.Contains(requireUserId))
        {
            throw new InstanceAuthError("You are not a participant in this activity instance", 403);
        }

        foreach (var uid in requireUserIds ?? [])
        {
            if (!users.Contains(uid))
            {
                throw new InstanceAuthError(
                    "Target is not a participant in this activity instance",
                    403);
            }
        }

        return info;
    }

    private static string? OptString(JsonElement el, string name)
    {
        if (!el.TryGetProperty(name, out var v)) return null;
        return v.ValueKind switch
        {
            JsonValueKind.Null or JsonValueKind.Undefined => null,
            JsonValueKind.String => v.GetString(),
            _ => v.ToString(),
        };
    }
}
