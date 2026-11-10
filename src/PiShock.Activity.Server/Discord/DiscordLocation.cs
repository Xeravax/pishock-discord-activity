using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Text.Json;

namespace PiShock.Activity.Server.Discord;

public sealed class ActivityLocationContext
{
    public string? InstanceId { get; init; }
    public string? GuildId { get; init; }
    public string? ChannelId { get; init; }
    public string? LocationKind { get; init; }
    public string? LocationName { get; init; }
    public string? LocationIconUrl { get; init; }
}

public sealed class ClientLocationHint
{
    public string? GuildId { get; init; }
    public string? ChannelId { get; init; }
    public string? LocationKind { get; init; }
    public string? LocationName { get; init; }
    public string? LocationIconUrl { get; init; }
}

public static class DiscordLocation
{
    private sealed record CacheEntry(long At, ActivityLocationContext Value);

    private static readonly ConcurrentDictionary<string, CacheEntry> LocationCache = new();
    private static readonly long CacheTtlMs = (long)TimeSpan.FromMinutes(5).TotalMilliseconds;
    private const int CachePruneThreshold = 2000;

    private static ActivityLocationContext Empty() => new();

    private static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    private static string? GuildIconUrl(string guildId, string? icon)
    {
        if (string.IsNullOrEmpty(icon)) return null;
        var ext = icon.StartsWith("a_", StringComparison.Ordinal) ? "gif" : "png";
        return $"https://cdn.discordapp.com/icons/{guildId}/{icon}.{ext}?size=64";
    }

    /// <summary>GET a Discord API v10 path with the bot token; returns the root JSON object or null on any failure.</summary>
    private static async Task<JsonElement?> BotGetJsonAsync(
        AppEnv env,
        HttpClient http,
        string path,
        CancellationToken ct)
    {
        if (string.IsNullOrEmpty(env.DiscordBotToken)) return null;
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, $"https://discord.com/api/v10{path}");
            req.Headers.Authorization = new AuthenticationHeaderValue("Bot", env.DiscordBotToken);
            using var res = await http.SendAsync(req, ct);
            if (!res.IsSuccessStatusCode) return null;
            await using var stream = await res.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return null;
            return doc.RootElement.Clone();
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>JS-style <c>x != null ? String(x) : null</c> for a JSON property.</summary>
    private static string? OptString(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v)) return null;
        return v.ValueKind switch
        {
            JsonValueKind.Null or JsonValueKind.Undefined => null,
            JsonValueKind.String => v.GetString(),
            _ => v.ToString(),
        };
    }

    /// <summary>
    /// Resolve a human-readable Discord location (guild or DM/group) for an activity instance.
    /// Prefers a client hint (user OAuth guilds list) when IDs match; falls back to the bot API.
    /// </summary>
    public static async Task<ActivityLocationContext> ResolveActivityLocationAsync(
        AppEnv env,
        HttpClient http,
        string? instanceId,
        ActivityInstanceInfo? prefetched = null,
        ClientLocationHint? clientHint = null,
        CancellationToken ct = default)
    {
        var id = instanceId?.Trim() ?? "";
        if (id.Length == 0 && clientHint is null) return Empty();

        var cacheKey = id.Length > 0
            ? id
            : $"hint:{clientHint?.GuildId ?? ""}:{clientHint?.ChannelId ?? ""}";

        if (clientHint is null
            && LocationCache.TryGetValue(cacheKey, out var cached)
            && NowMs() - cached.At < CacheTtlMs)
        {
            return cached.Value;
        }

        var instance = prefetched;
        if (instance is null && id.Length > 0)
        {
            try
            {
                instance = await DiscordInstance.VerifyActivityInstanceAsync(
                    env, id, http, allowMissingBot: true);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch
            {
                instance = null;
            }
        }

        var location = instance?.Location;
        var guildId = !string.IsNullOrEmpty(location?.GuildId)
            ? location!.GuildId
            : (!string.IsNullOrEmpty(clientHint?.GuildId) ? clientHint!.GuildId : null);
        var channelId = !string.IsNullOrEmpty(location?.ChannelId)
            ? location!.ChannelId
            : (!string.IsNullOrEmpty(clientHint?.ChannelId) ? clientHint!.ChannelId : null);
        var locationKind = !string.IsNullOrEmpty(location?.Kind)
            ? location!.Kind
            : guildId is not null
                ? "gc"
                : channelId is not null
                    ? "dm"
                    : null;

        string? locationName = null;
        string? locationIconUrl = null;

        var fromClient = SanitizeClientHint(clientHint, guildId, channelId);
        if (fromClient is not null)
        {
            locationName = fromClient.LocationName;
            locationIconUrl = fromClient.LocationIconUrl;
            if (!string.IsNullOrEmpty(fromClient.LocationKind)) locationKind = fromClient.LocationKind;
        }

        if ((string.IsNullOrEmpty(locationName) || string.IsNullOrEmpty(locationIconUrl)) && guildId is not null)
        {
            var guild = await BotGetJsonAsync(env, http, $"/guilds/{Uri.EscapeDataString(guildId)}", ct);
            if (guild is { } g)
            {
                var gName = OptString(g, "name");
                if (string.IsNullOrEmpty(locationName) && gName is not null) locationName = gName;
                if (string.IsNullOrEmpty(locationIconUrl))
                {
                    locationIconUrl = GuildIconUrl(guildId, OptString(g, "icon"));
                }
            }
        }

        if (string.IsNullOrEmpty(locationName) && guildId is null && channelId is not null)
        {
            var channel = await BotGetJsonAsync(env, http, $"/channels/{Uri.EscapeDataString(channelId)}", ct);
            if (channel is { } ch)
            {
                double type = double.NaN;
                if (ch.TryGetProperty("type", out var typeEl))
                {
                    if (typeEl.ValueKind == JsonValueKind.Number) type = typeEl.GetDouble();
                    else if (typeEl.ValueKind == JsonValueKind.String
                             && double.TryParse(typeEl.GetString(), System.Globalization.NumberStyles.Float,
                                 System.Globalization.CultureInfo.InvariantCulture, out var parsed))
                        type = parsed;
                }

                var name = OptString(ch, "name")?.Trim() ?? "";
                if (name.Length > 0) locationName = name;
                else if (type == 1) locationName = "Direct Message";
                else if (type == 3) locationName = "Group DM";
                else locationName = "Private Channel";

                var icon = OptString(ch, "icon");
                if (!string.IsNullOrEmpty(icon) && string.IsNullOrEmpty(locationIconUrl))
                {
                    locationIconUrl = $"https://cdn.discordapp.com/channel-icons/{channelId}/{icon}.png?size=64";
                }
            }
            else if (string.IsNullOrEmpty(locationName))
            {
                locationName = "Direct Message";
            }
        }

        if (string.IsNullOrEmpty(locationName) && guildId is not null) locationName = "Discord Server";

        var value = new ActivityLocationContext
        {
            InstanceId = id.Length > 0 ? id : null,
            GuildId = guildId,
            ChannelId = channelId,
            LocationKind = locationKind,
            LocationName = locationName,
            LocationIconUrl = locationIconUrl,
        };

        if (LocationCache.Count > CachePruneThreshold) PruneCache();
        LocationCache[cacheKey] = new CacheEntry(NowMs(), value);
        return value;
    }

    private static void PruneCache()
    {
        var now = NowMs();
        foreach (var kv in LocationCache)
        {
            if (now - kv.Value.At >= CacheTtlMs) LocationCache.TryRemove(kv.Key, out _);
        }
    }

    public static ActivityLocationContext? SanitizeClientHint(
        ClientLocationHint? hint,
        string? trustedGuildId,
        string? trustedChannelId)
    {
        if (hint is null) return null;
        var hintGuild = hint.GuildId is not null ? hint.GuildId : null;
        var hintChannel = hint.ChannelId is not null ? hint.ChannelId : null;

        if (!string.IsNullOrEmpty(trustedGuildId) && !string.IsNullOrEmpty(hintGuild) && hintGuild != trustedGuildId)
            return null;
        if (!string.IsNullOrEmpty(trustedChannelId) && !string.IsNullOrEmpty(hintChannel) && hintChannel != trustedChannelId)
            return null;
        if (!string.IsNullOrEmpty(trustedGuildId) && hintGuild is null && hintChannel is null)
            return null;

        var name = hint.LocationName?.Trim() ?? "";
        if (name.Length > 120) name = name[..120];
        var iconUrl = hint.LocationIconUrl?.Trim() ?? "";
        if (!string.IsNullOrEmpty(iconUrl)
            && !System.Text.RegularExpressions.Regex.IsMatch(
                iconUrl,
                @"^https://cdn\.discordapp\.com/(icons|channel-icons)/",
                System.Text.RegularExpressions.RegexOptions.IgnoreCase))
        {
            iconUrl = "";
        }

        if (string.IsNullOrEmpty(name) && string.IsNullOrEmpty(iconUrl)) return null;
        return new ActivityLocationContext
        {
            LocationKind = hint.LocationKind is not null
                ? (hint.LocationKind.Length > 32 ? hint.LocationKind[..32] : hint.LocationKind)
                : null,
            LocationName = string.IsNullOrEmpty(name) ? null : name,
            LocationIconUrl = string.IsNullOrEmpty(iconUrl) ? null : iconUrl,
        };
    }
}
