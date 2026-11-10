using System.Globalization;
using System.Text.Json;

namespace PiShock.Activity.Web.Models;

public sealed class OfficialLogPerson
{
    public string Id { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string AvatarUrl { get; set; } = "";
}

public sealed class OfficialLogLocation
{
    public string? Kind { get; set; }
    public string? Name { get; set; }
    public string? IconUrl { get; set; }
    public string? GuildId { get; set; }
    public string? ChannelId { get; set; }
}

public sealed class OfficialLogEntry
{
    public string Id { get; set; } = "";
    public OfficialLogPerson From { get; set; } = new();
    public OfficialLogPerson To { get; set; } = new();
    public string Source { get; set; } = "discord"; // discord | website
    public OfficialLogLocation? Location { get; set; }
    public string Action { get; set; } = "other"; // shock | vibrate | beep | other
    public int? Intensity { get; set; }
    public double? DurationSec { get; set; }
    public long At { get; set; }
}

/// <summary>Raw /api/logs row kept for hydrating the PIP "last hit" surface.</summary>
public sealed class ActivityLogRow
{
    public string Id { get; set; } = "";
    public string Action { get; set; } = "";
    public int? Intensity { get; set; }
    public int? DurationMs { get; set; }
    public bool Success { get; set; }
    public long At { get; set; }
    public string? ExecutorId { get; set; }
    public string? ExecutorDisplayName { get; set; }
    public string? ExecutorAvatar { get; set; }
    public string? TargetId { get; set; }
}

public static class LogNormalizer
{
    private static OfficialLogPerson Person(JsonElement raw, string fallbackId)
    {
        var obj = raw.ValueKind == JsonValueKind.Object;
        var id = (obj ? Json.Str(raw, "id") : null) ?? fallbackId;
        var display = (obj ? Json.Str(raw, "displayName", "globalName", "username") : null) ?? "Unknown";
        var avatarUrl = obj ? Json.Str(raw, "avatarUrl") : null;
        if (string.IsNullOrEmpty(avatarUrl))
        {
            avatarUrl = ParticipantUtil.AvatarUrl(id.StartsWith("label:") ? "0" : id, obj ? Json.Str(raw, "avatar") : null);
        }
        return new OfficialLogPerson { Id = id, DisplayName = display, AvatarUrl = avatarUrl };
    }

    private static string NormalizeAction(string raw, int? intensity)
    {
        var a = raw.ToLowerInvariant();
        if (a.Contains("vib") || a == "v" || a == "1" || a.Contains("warning")) return "vibrate";
        if (a.Contains("beep") || a == "b" || a == "2") return "beep";
        if (a.Contains("shock") || a == "s" || a == "0" || a.Contains("hold")) return "shock";
        if (intensity is > 0) return "shock";
        return "other";
    }

    private static long ParseAt(string? iso, int idx)
    {
        if (DateTimeOffset.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var dt))
        {
            return dt.ToUnixTimeMilliseconds();
        }
        return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - idx;
    }

    /// <summary>Normalize the global public activity feed from GET /api/logs.</summary>
    public static List<OfficialLogEntry> NormalizePublic(JsonElement rows)
    {
        var outList = new List<OfficialLogEntry>();
        if (rows.ValueKind != JsonValueKind.Array) return outList;
        var idx = 0;
        foreach (var row in rows.EnumerateArray())
        {
            idx++;
            var actionRaw = (Json.Str(row, "action") ?? "").ToLowerInvariant();
            if (actionRaw is "end" or "stop" || actionRaw.EndsWith("_end") ||
                actionRaw.StartsWith("emergency_stop") || actionRaw.StartsWith("pause_"))
            {
                continue;
            }

            JsonElement executor = default, target = default;
            Json.TryGet(row, out executor, "executor");
            Json.TryGet(row, out target, "target");
            var executorId = Json.Str(executor, "id") ?? "";
            var targetId = Json.Str(target, "id") ?? "";
            if (executorId.Length == 0 || targetId.Length == 0) continue;

            int? intensity = Json.Num(row, "intensity") is { } iv ? (int)iv : null;
            int? durationMs = Json.Num(row, "durationMs") is { } dv ? (int)dv : null;
            var at = ParseAt(Json.Str(row, "createdAt"), idx);
            var source = Json.Str(row, "source") == "website" ? "website" : "discord";

            OfficialLogLocation? location = null;
            if (Json.TryGet(row, out var loc, "location") && loc.ValueKind == JsonValueKind.Object &&
                !string.IsNullOrEmpty(Json.Str(loc, "name")))
            {
                location = new OfficialLogLocation
                {
                    Kind = Json.Str(loc, "kind"),
                    Name = Json.Str(loc, "name"),
                    IconUrl = Json.Str(loc, "iconUrl"),
                    GuildId = Json.Str(loc, "guildId"),
                    ChannelId = Json.Str(loc, "channelId"),
                };
            }

            outList.Add(new OfficialLogEntry
            {
                Id = Json.Str(row, "id") ?? $"public-{at}-{idx}",
                From = Person(executor, executorId),
                To = Person(target, targetId),
                Source = source,
                Location = location,
                Action = NormalizeAction(actionRaw, intensity),
                Intensity = intensity,
                DurationSec = durationMs is { } ms ? Math.Round(ms / 1000.0 * 10) / 10 : null,
                At = at,
            });
        }
        return outList.OrderByDescending(e => e.At).ToList();
    }

    public static List<ActivityLogRow> NormalizeRows(JsonElement rows)
    {
        var list = new List<ActivityLogRow>();
        if (rows.ValueKind != JsonValueKind.Array) return list;
        var idx = 0;
        foreach (var row in rows.EnumerateArray())
        {
            idx++;
            Json.TryGet(row, out var executor, "executor");
            Json.TryGet(row, out var target, "target");
            list.Add(new ActivityLogRow
            {
                Id = Json.Str(row, "id") ?? "",
                Action = Json.Str(row, "action") ?? "",
                Intensity = Json.Num(row, "intensity") is { } i ? (int)i : null,
                DurationMs = Json.Num(row, "durationMs") is { } d ? (int)d : null,
                Success = Json.Bool(row, "success") ?? false,
                At = ParseAt(Json.Str(row, "createdAt"), idx),
                ExecutorId = Json.Str(executor, "id") ?? Json.Str(row, "executorDiscordUserId"),
                ExecutorDisplayName = Json.Str(executor, "displayName", "globalName", "username"),
                ExecutorAvatar = Json.Str(executor, "avatar"),
                TargetId = Json.Str(target, "id") ?? Json.Str(row, "targetDiscordUserId"),
            });
        }
        return list;
    }
}
