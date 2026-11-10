using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using PiShock.Activity.Server.Data;

namespace PiShock.Activity.Server.Discord;

public sealed class DiscordUserInfo
{
    [JsonPropertyName("id")]
    public string Id { get; init; } = "";

    [JsonPropertyName("username")]
    public string Username { get; init; } = "";

    [JsonPropertyName("global_name")]
    public string? GlobalName { get; init; }

    [JsonPropertyName("avatar")]
    public string? Avatar { get; init; }
}

public sealed class DiscordTokenExchangeResult
{
    [JsonPropertyName("access_token")]
    public string AccessToken { get; init; } = "";

    [JsonPropertyName("token_type")]
    public string TokenType { get; init; } = "";

    [JsonPropertyName("expires_in")]
    public int ExpiresIn { get; init; }

    [JsonPropertyName("user")]
    public DiscordUserInfo User { get; init; } = new();
}

public sealed class DiscordAuthError : Exception
{
    public int Status { get; }

    public DiscordAuthError(string message, int status) : base(message)
    {
        Status = status;
    }
}

public sealed class DiscordAuthService
{
    private sealed record CacheEntry(DiscordUserInfo User, long ExpiresAt);

    private static readonly ConcurrentDictionary<string, CacheEntry> TokenCache = new();
    private static readonly long CacheTtlMs = 60_000;
    private const int CachePruneThreshold = 2000;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private readonly AppEnv _env;
    private readonly IHttpClientFactory _httpFactory;
    private readonly AppDbContext _db;

    public DiscordAuthService(AppEnv env, IHttpClientFactory httpFactory, AppDbContext db)
    {
        _env = env;
        _httpFactory = httpFactory;
        _db = db;
    }

    private static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    public async Task<DiscordTokenExchangeResult> ExchangeDiscordCodeAsync(
        string code,
        CancellationToken ct = default)
    {
        var http = _httpFactory.CreateClient();
        using var content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["client_id"] = _env.DiscordClientId,
            ["client_secret"] = _env.DiscordClientSecret,
            ["grant_type"] = "authorization_code",
            ["code"] = code,
        });

        using var tokenRes = await http.PostAsync("https://discord.com/api/oauth2/token", content, ct);
        if (!tokenRes.IsSuccessStatusCode)
        {
            var text = await tokenRes.Content.ReadAsStringAsync(ct);
            throw new DiscordAuthError(
                $"Discord token exchange failed: {(int)tokenRes.StatusCode} {text}",
                502);
        }

        await using var stream = await tokenRes.Content.ReadAsStreamAsync(ct);
        var tokenData = await JsonSerializer.DeserializeAsync<TokenResponse>(stream, JsonOptions, ct)
            ?? throw new DiscordAuthError("Discord token exchange returned an empty response", 502);
        if (string.IsNullOrEmpty(tokenData.AccessToken))
        {
            throw new DiscordAuthError("Discord token exchange returned no access_token", 502);
        }

        var user = await FetchDiscordUserAsync(http, tokenData.AccessToken, ct);
        await UpsertDiscordUserAsync(user, ct);

        return new DiscordTokenExchangeResult
        {
            AccessToken = tokenData.AccessToken,
            TokenType = tokenData.TokenType ?? "",
            ExpiresIn = tokenData.ExpiresIn,
            User = user,
        };
    }

    public async Task<DiscordUserInfo> ResolveBearerUserAsync(
        string accessToken,
        CancellationToken ct = default)
    {
        if (TokenCache.TryGetValue(accessToken, out var cached) && cached.ExpiresAt > NowMs())
        {
            return cached.User;
        }

        var http = _httpFactory.CreateClient();
        var user = await FetchDiscordUserAsync(http, accessToken, ct);
        await UpsertDiscordUserAsync(user, ct);

        if (TokenCache.Count > CachePruneThreshold) PruneCache();
        TokenCache[accessToken] = new CacheEntry(user, NowMs() + CacheTtlMs);
        return user;
    }

    private static void PruneCache()
    {
        var now = NowMs();
        foreach (var kv in TokenCache)
        {
            if (kv.Value.ExpiresAt <= now) TokenCache.TryRemove(kv.Key, out _);
        }
    }

    private static async Task<DiscordUserInfo> FetchDiscordUserAsync(
        HttpClient http,
        string accessToken,
        CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, "https://discord.com/api/users/@me");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        using var res = await http.SendAsync(req, ct);

        if (res.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
        {
            throw new DiscordAuthError("Discord access token rejected", 401);
        }
        if (!res.IsSuccessStatusCode)
        {
            var text = await res.Content.ReadAsStringAsync(ct);
            throw new DiscordAuthError($"Discord /users/@me failed: {(int)res.StatusCode} {text}", 502);
        }

        await using var stream = await res.Content.ReadAsStreamAsync(ct);
        var user = await JsonSerializer.DeserializeAsync<DiscordUserInfo>(stream, JsonOptions, ct);
        if (user is null || string.IsNullOrEmpty(user.Id))
        {
            throw new DiscordAuthError("Discord /users/@me returned an invalid user", 502);
        }
        return user;
    }

    private async Task UpsertDiscordUserAsync(DiscordUserInfo user, CancellationToken ct)
    {
        try
        {
            await UpsertCoreAsync(user, ct);
        }
        catch (DbUpdateException)
        {
            // Concurrent first-login insert race: drop tracked state and retry as an update.
            _db.ChangeTracker.Clear();
            await UpsertCoreAsync(user, ct);
        }
    }

    private async Task UpsertCoreAsync(DiscordUserInfo user, CancellationToken ct)
    {
        var existing = await _db.DiscordUsers.FirstOrDefaultAsync(u => u.Id == user.Id, ct);
        if (existing is null)
        {
            _db.DiscordUsers.Add(new DiscordUser
            {
                Id = user.Id,
                Username = user.Username,
                GlobalName = user.GlobalName,
                Avatar = user.Avatar,
            });
        }
        else
        {
            existing.Username = user.Username;
            existing.GlobalName = user.GlobalName;
            existing.Avatar = user.Avatar;
        }
        await _db.SaveChangesAsync(ct);
    }

    private sealed class TokenResponse
    {
        [JsonPropertyName("access_token")]
        public string AccessToken { get; set; } = "";

        [JsonPropertyName("token_type")]
        public string? TokenType { get; set; }

        [JsonPropertyName("expires_in")]
        public int ExpiresIn { get; set; }
    }
}
