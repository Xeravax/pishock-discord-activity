using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Kiota.Abstractions.Authentication;

namespace PiShock.Activity.ApiClient;

/// <summary>
/// Typed activity API client. Uses Kiota auth abstractions so a later
/// <c>kiota generate</c> from <c>openapi/openapi.json</c> can replace the request bodies
/// while keeping the same Discord bearer provider wiring in Blazor.
/// Sources are committed (manual / Kiota-shaped) until regenerate — see <c>kiota-lock.json</c>.
/// </summary>
public sealed class ActivityApiClient(HttpClient http, IAccessTokenProvider tokenProvider)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    // ───────────────────────── Auth ─────────────────────────

    /// <summary>POST /api/auth/discord — no Discord bearer (code exchange).</summary>
    public Task<JsonElement> ExchangeDiscordCodeAsync(object body, CancellationToken ct = default) =>
        SendJsonAsync(HttpMethod.Post, "api/auth/discord", ct, body, omitAuth: true);

    public async Task<MeResponse> GetMeAsync(CancellationToken ct = default)
    {
        using var req = await CreateAsync(HttpMethod.Get, "api/me", ct);
        using var res = await http.SendAsync(req, ct);
        await EnsureSuccessAsync(res, ct);
        return (await res.Content.ReadFromJsonAsync<MeResponse>(JsonOptions, ct))!;
    }

    public Task<JsonElement> AcceptConsentAsync(object body, CancellationToken ct = default) =>
        SendJsonAsync(HttpMethod.Post, "api/consent", ct, body);

    public Task<JsonElement> RevokeConsentAsync(CancellationToken ct = default) =>
        SendJsonAsync(HttpMethod.Delete, "api/consent", ct);

    // ───────────────────────── Announcements ─────────────────────────

    public Task<JsonElement> GetAnnouncementsAsync(CancellationToken ct = default) =>
        SendJsonAsync(HttpMethod.Get, "api/announcements", ct, omitAuth: true);

    // ───────────────────────── PiShock session ─────────────────────────

    public Task<JsonElement> StartPiShockLoginAsync(object? body = null, CancellationToken ct = default) =>
        SendJsonAsync(HttpMethod.Post, "api/pishock/login/start", ct, body ?? new { });

    public Task<JsonElement> GetPiShockLoginStatusAsync(CancellationToken ct = default) =>
        SendJsonAsync(HttpMethod.Get, "api/pishock/login/status", ct);

    public Task<JsonElement> ConfirmPiShockLoginAsync(object? body = null, CancellationToken ct = default) =>
        SendJsonAsync(HttpMethod.Post, "api/pishock/login/confirm", ct, body ?? new { });

    public Task<JsonElement> CancelPiShockLoginAsync(object? body = null, CancellationToken ct = default) =>
        SendJsonAsync(HttpMethod.Post, "api/pishock/login/cancel", ct, body ?? new { });

    public Task<JsonElement> DeletePiShockSessionAsync(CancellationToken ct = default) =>
        SendJsonAsync(HttpMethod.Delete, "api/pishock/session", ct);

    // ───────────────────────── Control ─────────────────────────

    public Task<JsonElement> ListDevicesAsync(CancellationToken ct = default) =>
        SendJsonAsync(HttpMethod.Get, "api/devices", ct);

    public Task<JsonElement> SetEmergencyStopAsync(object body, CancellationToken ct = default) =>
        SendJsonAsync(HttpMethod.Put, "api/emergency-stop", ct, body);

    public Task<JsonElement> OperateAsync(object body, CancellationToken ct = default) =>
        SendJsonAsync(HttpMethod.Post, "api/operate", ct, body);

    public Task<JsonElement> PauseAsync(object body, CancellationToken ct = default) =>
        SendJsonAsync(HttpMethod.Post, "api/pause", ct, body);

    public Task<JsonElement> ListLinksAsync(CancellationToken ct = default) =>
        SendJsonAsync(HttpMethod.Get, "api/links", ct);

    public Task<JsonElement> CreateLinkAsync(object body, CancellationToken ct = default) =>
        SendJsonAsync(HttpMethod.Post, "api/links", ct, body);

    public Task<JsonElement> DeleteLinkAsync(string linkId, CancellationToken ct = default) =>
        SendJsonAsync(HttpMethod.Delete, $"api/links/{Uri.EscapeDataString(linkId)}", ct);

    public Task<JsonElement> CreateShareAsync(object body, CancellationToken ct = default) =>
        SendJsonAsync(HttpMethod.Post, "api/shares", ct, body);

    public Task<JsonElement> ClaimShareAsync(object body, CancellationToken ct = default) =>
        SendJsonAsync(HttpMethod.Put, "api/shares", ct, body);

    public Task<JsonElement> DeleteShareAsync(string shareId, CancellationToken ct = default) =>
        SendJsonAsync(HttpMethod.Delete, $"api/shares/{Uri.EscapeDataString(shareId)}", ct);

    public Task<JsonElement> ListLogsAsync(int? limit = null, CancellationToken ct = default)
    {
        var path = limit is null ? "api/logs" : $"api/logs?limit={limit.Value}";
        return SendJsonAsync(HttpMethod.Get, path, ct);
    }

    public Task<JsonElement> GetBrokerStatusAsync(
        IEnumerable<string>? clientIds = null,
        int? waitMs = null,
        CancellationToken ct = default)
    {
        var qs = new List<string>();
        if (clientIds is not null)
        {
            var joined = string.Join(',', clientIds.Where(id => !string.IsNullOrWhiteSpace(id)));
            if (joined.Length > 0) qs.Add($"clientIds={Uri.EscapeDataString(joined)}");
        }
        if (waitMs is int w) qs.Add($"waitMs={w}");
        var path = qs.Count == 0 ? "api/broker/status" : $"api/broker/status?{string.Join('&', qs)}";
        return SendJsonAsync(HttpMethod.Get, path, ct);
    }

    // ───────────────────────── Activity share ─────────────────────────

    public Task<JsonElement> GetActivityShareAsync(CancellationToken ct = default) =>
        SendJsonAsync(HttpMethod.Get, "api/activity/share", ct);

    public Task<JsonElement> GetActivitySettingsAsync(CancellationToken ct = default) =>
        SendJsonAsync(HttpMethod.Get, "api/activity/settings", ct);

    public Task<JsonElement> UpdateActivitySettingsAsync(object body, CancellationToken ct = default) =>
        SendJsonAsync(HttpMethod.Put, "api/activity/settings", ct, body);

    public Task<JsonElement> UpdateActivityShareAsync(object body, CancellationToken ct = default) =>
        SendJsonAsync(HttpMethod.Put, "api/activity/share", ct, body);

    // ───────────────────────── Participants ─────────────────────────

    public Task<JsonElement> GetParticipantStatusAsync(object body, CancellationToken ct = default) =>
        SendJsonAsync(HttpMethod.Post, "api/participants/status", ct, body);

    public Task<JsonElement> OperateParticipantAsync(
        string targetDiscordUserId,
        object body,
        CancellationToken ct = default) =>
        SendJsonAsync(
            HttpMethod.Post,
            $"api/participants/{Uri.EscapeDataString(targetDiscordUserId)}/operate",
            ct,
            body);

    // ───────────────────────── plumbing ─────────────────────────

    private async Task<JsonElement> SendJsonAsync(
        HttpMethod method,
        string path,
        CancellationToken ct,
        object? body = null,
        bool omitAuth = false)
    {
        using var req = await CreateAsync(method, path, ct, body, omitAuth);
        using var res = await http.SendAsync(req, ct);
        await EnsureSuccessAsync(res, ct);
        if (res.Content.Headers.ContentLength == 0
            || res.StatusCode == System.Net.HttpStatusCode.NoContent)
        {
            return default;
        }

        var text = await res.Content.ReadAsStringAsync(ct);
        if (string.IsNullOrWhiteSpace(text)) return default;
        return JsonSerializer.Deserialize<JsonElement>(text, JsonOptions);
    }

    private async Task<HttpRequestMessage> CreateAsync(
        HttpMethod method,
        string path,
        CancellationToken ct,
        object? body = null,
        bool omitAuth = false)
    {
        var req = new HttpRequestMessage(method, path);
        if (body is not null) req.Content = JsonContent.Create(body, options: JsonOptions);

        if (!omitAuth)
        {
            var uri = new Uri(http.BaseAddress ?? new Uri("http://localhost/"), path);
            var token = await tokenProvider.GetAuthorizationTokenAsync(uri, cancellationToken: ct);
            if (!string.IsNullOrEmpty(token))
            {
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            }
        }

        return req;
    }

    private static async Task EnsureSuccessAsync(HttpResponseMessage res, CancellationToken ct)
    {
        if (res.IsSuccessStatusCode) return;

        var text = await res.Content.ReadAsStringAsync(ct);
        object? body = null;
        if (!string.IsNullOrWhiteSpace(text))
        {
            try
            {
                body = JsonSerializer.Deserialize<JsonElement>(text, JsonOptions);
            }
            catch (JsonException)
            {
                body = text;
            }
        }

        throw new ApiError((int)res.StatusCode, body);
    }
}

/// <summary>Kiota <see cref="IAccessTokenProvider"/> that yields the Discord activity bearer.</summary>
public sealed class DiscordBearerTokenProvider(Func<Task<string?>> getToken) : IAccessTokenProvider
{
    public AllowedHostsValidator AllowedHostsValidator { get; } = new();

    public async Task<string> GetAuthorizationTokenAsync(
        Uri uri,
        Dictionary<string, object>? additionalAuthenticationContext = null,
        CancellationToken cancellationToken = default) =>
        (await getToken()) ?? string.Empty;
}
