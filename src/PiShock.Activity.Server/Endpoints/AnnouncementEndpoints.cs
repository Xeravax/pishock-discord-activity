using System.Globalization;
using System.Text.Json;
using PiShock.Activity.Server.Security;
using PiShock.Activity.Server.Shared;

namespace PiShock.Activity.Server.Endpoints;

public sealed record LiveAnnouncement(string Text, string? Link, string? Expires);

/// <summary>Port of src/server/routes/announcements.ts: cached passthrough of the PiShock dashboard banner.</summary>
public static class AnnouncementEndpoints
{
    private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan UpstreamTimeout = TimeSpan.FromSeconds(8);

    private sealed record CacheEntry(long AtMs, IReadOnlyList<LiveAnnouncement> Items);

    private static volatile CacheEntry? _cache;

    public static IEndpointRouteBuilder MapAnnouncementEndpoints(this IEndpointRouteBuilder app)
    {
        // Public (GET /api/announcements is on ActivityAuthFilter's allow-list).
        app.MapActivityApi()
            .MapGet("/announcements", GetAnnouncementsAsync)
            .WithName("GetAnnouncements")
            .WithTags("Announcements")
            .AllowAnonymous();

        return app;
    }

    private static async Task<IResult> GetAnnouncementsAsync(
        HttpContext ctx,
        IHttpClientFactory httpFactory,
        ILoggerFactory loggerFactory)
    {
        try
        {
            var announcements = await FetchLiveAnnouncementsAsync(httpFactory, ctx.RequestAborted);
            return ApiResults.Json(new { announcements });
        }
        catch (Exception err) when (!ctx.RequestAborted.IsCancellationRequested)
        {
            loggerFactory.CreateLogger("PiShock.Activity.Announcements")
                .LogWarning(err, "Failed to fetch PiShock announcements");
            return ApiResults.Json(
                new { error = "Failed to load announcements", announcements = Array.Empty<LiveAnnouncement>() },
                502);
        }
    }

    private static async Task<IReadOnlyList<LiveAnnouncement>> FetchLiveAnnouncementsAsync(
        IHttpClientFactory httpFactory,
        CancellationToken ct)
    {
        var cached = _cache;
        var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        if (cached is not null && nowMs - cached.AtMs < (long)CacheTtl.TotalMilliseconds)
        {
            return cached.Items;
        }

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(UpstreamTimeout);

        using var req = new HttpRequestMessage(HttpMethod.Get, Constants.PiShockAnnouncementsLive);
        req.Headers.TryAddWithoutValidation("Accept", "application/json");
        using var res = await httpFactory.CreateClient().SendAsync(req, timeout.Token);
        if (!res.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"Announcements upstream {(int)res.StatusCode}");
        }

        await using var stream = await res.Content.ReadAsStreamAsync(timeout.Token);
        using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: timeout.Token);
        var items = Normalize(doc.RootElement);

        _cache = new CacheEntry(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), items);
        return items;
    }

    /// <summary>Keeps rows with text, drops expired ones, trims text/link.</summary>
    private static List<LiveAnnouncement> Normalize(JsonElement raw)
    {
        var result = new List<LiveAnnouncement>();
        if (raw.ValueKind != JsonValueKind.Array) return result;

        var now = DateTimeOffset.UtcNow;
        foreach (var row in raw.EnumerateArray())
        {
            if (row.ValueKind != JsonValueKind.Object) continue;

            var text = StringProp(row, "AnnouncementText")?.Trim() ?? "";
            if (text.Length == 0) continue;

            var expires = ExpiresProp(row);
            if (expires is not null
                && DateTimeOffset.TryParse(
                    expires,
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                    out var expiresAt)
                && expiresAt <= now)
            {
                continue;
            }

            var link = StringProp(row, "Link")?.Trim();
            result.Add(new LiveAnnouncement(text, string.IsNullOrEmpty(link) ? null : link, expires));
        }
        return result;
    }

    private static string? StringProp(JsonElement row, string name) =>
        row.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    /// <summary>JS: null / "" → null, string → as is, anything else → String(value).</summary>
    private static string? ExpiresProp(JsonElement row)
    {
        if (!row.TryGetProperty("Expires", out var value)) return null;
        return value.ValueKind switch
        {
            JsonValueKind.Null or JsonValueKind.Undefined => null,
            JsonValueKind.String => string.IsNullOrEmpty(value.GetString()) ? null : value.GetString(),
            _ => value.ToString(),
        };
    }
}
