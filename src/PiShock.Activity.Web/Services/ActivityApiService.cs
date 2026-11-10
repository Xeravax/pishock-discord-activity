using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;
using PiShock.Activity.ApiClient;
using PiShock.Activity.Web.Models;
using MeResponse = PiShock.Activity.Web.Models.MeResponse;

namespace PiShock.Activity.Web.Services;

public sealed class ApiException(int status, string message, string? code, JsonElement body) : Exception(message)
{
    public int Status { get; } = status;
    public string? Code { get; } = code;
    public JsonElement Body { get; } = body;
}

public static class SafetyAck
{
    public const int Version = 1;

    public static readonly string[] Items =
    [
        "I accept full responsibility for safe use and understand my actions will deliver real electronic shocks to other users",
        "I understand device owners can block me and developers cannot override these blocks or restore my access",
        "I understand this controls real electronic shock devices physically attached to other users",
        "I understand developers bear no liability for any harm, injury, or adverse effects from using this application",
        "I confirm voluntary participation with full knowledge of risks",
    ];
}

/// <summary>
/// Blazor-facing API facade. Sets the Discord bearer and <c>/.proxy</c> base URL, then delegates
/// HTTP to the Kiota-shaped <see cref="ActivityApiClient"/>.
/// </summary>
public sealed class ActivityApiService(
    HttpClient http,
    NavigationManager nav,
    IJSRuntime js,
    ActivityApiClient client,
    AccessTokenStore tokens)
{
    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);
    private bool? _embedded;

    public string? AccessToken => tokens.Token;

    public void SetAccessToken(string? token) => tokens.Token = token;

    public Task<bool> IsEmbeddedAsync()
    {
        // Prefer the page URI (no JS). Discord Activities always include frame_id.
        // Fall back to the SDK helper only when the NavigationManager URI is unavailable.
        if (_embedded is null)
        {
            try
            {
                var query = new Uri(nav.Uri).Query.TrimStart('?');
                _embedded = query.Split('&', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .Any(part => part.StartsWith("frame_id=", StringComparison.Ordinal)
                        || part.Equals("frame_id", StringComparison.Ordinal));
            }
            catch
            {
                _embedded = null;
            }
        }

        if (_embedded is not null) return Task.FromResult(_embedded.Value);

        return DetectEmbeddedViaJsAsync();
    }

    private async Task<bool> DetectEmbeddedViaJsAsync()
    {
        try
        {
            _embedded = await js.InvokeAsync<bool>("discordSdk.isEmbedded");
        }
        catch
        {
            _embedded = false;
        }
        return _embedded.Value;
    }

    public async Task EnsureBaseAddressAsync()
    {
        var embedded = await IsEmbeddedAsync();
        var origin = nav.BaseUri.TrimEnd('/');
        http.BaseAddress = new Uri(embedded ? $"{origin}/.proxy/" : $"{origin}/");
    }

    private async Task<T> CallAsync<T>(Func<CancellationToken, Task<T>> action, CancellationToken ct = default)
    {
        await EnsureBaseAddressAsync();
        try
        {
            return await action(ct);
        }
        catch (ApiError err)
        {
            throw ToApiException(err);
        }
    }

    private static ApiException ToApiException(ApiError err)
    {
        var body = err.Body is JsonElement el ? el : default;
        return new ApiException(err.Status, err.Error, err.Code, body);
    }

    private static T Deserialize<T>(JsonElement el)
    {
        if (el.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null)
            return Activator.CreateInstance<T>();
        return el.Deserialize<T>(JsonOpts)!;
    }

    public async Task<MeResponse> GetMeAsync()
    {
        // Prefer wire JSON so Web.Models (personal limits / DisplayName) stay complete.
        var el = await CallAsync(async ct =>
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, "api/me");
            if (!string.IsNullOrEmpty(tokens.Token))
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tokens.Token);
            using var res = await http.SendAsync(req, ct);
            if (!res.IsSuccessStatusCode)
            {
                var text = await res.Content.ReadAsStringAsync(ct);
                object? body = null;
                if (!string.IsNullOrWhiteSpace(text))
                {
                    try { body = JsonSerializer.Deserialize<JsonElement>(text, JsonOpts); }
                    catch (JsonException) { body = text; }
                }
                throw new ApiError((int)res.StatusCode, body);
            }
            var payload = await res.Content.ReadAsStringAsync(ct);
            return string.IsNullOrWhiteSpace(payload)
                ? default
                : JsonSerializer.Deserialize<JsonElement>(payload, JsonOpts);
        });
        return Deserialize<MeResponse>(el);
    }

    public Task PostConsentAsync() => CallAsync(async ct =>
    {
        await client.AcceptConsentAsync(new
        {
            acknowledged = true,
            version = SafetyAck.Version,
            items = SafetyAck.Items,
        }, ct);
        return 0;
    });

    public Task RevokeConsentAsync() => CallAsync(async ct =>
    {
        await client.RevokeConsentAsync(ct);
        return 0;
    });

    public Task<JsonElement> GetDevicesAsync() => CallAsync(ct => client.ListDevicesAsync(ct));

    public Task<JsonElement> GetLogsAsync(int limit = 200) => CallAsync(ct => client.ListLogsAsync(limit, ct));

    public Task<JsonElement> GetBrokerStatusAsync(IEnumerable<string> clientIds, int waitMs) =>
        CallAsync(ct => client.GetBrokerStatusAsync(clientIds, waitMs, ct));

    public async Task OperateAsync(object body, string? targetDiscordUserId = null)
    {
        try
        {
            if (string.IsNullOrEmpty(targetDiscordUserId))
                await CallAsync(async ct => { await client.OperateAsync(body, ct); return 0; });
            else
                await CallAsync(async ct =>
                {
                    await client.OperateParticipantAsync(targetDiscordUserId, body, ct);
                    return 0;
                });
        }
        catch (ApiException ex) when (ex.Code is null)
        {
            throw new ApiException(ex.Status, $"Operate failed ({ex.Status}): {ex.Message}", ex.Code, ex.Body);
        }
    }

    public Task<JsonElement> SetEmergencyStopAsync(EmergencyStopInput input) =>
        CallAsync(ct => client.SetEmergencyStopAsync(new
        {
            shockerId = input.ShockerId,
            clientId = input.ClientId,
            engaged = input.Engaged,
        }, ct));

    public async Task<List<ParticipantStatus>> GetParticipantStatusAsync(string instanceId, IEnumerable<string> ids)
    {
        var el = await CallAsync(ct => client.GetParticipantStatusAsync(new
        {
            instanceId,
            discordUserIds = ids.ToArray(),
        }, ct));
        return Deserialize<ParticipantStatusResponse>(el).Participants ?? [];
    }

    public async Task<(string LoginUrl, string Channel)> StartPiShockLoginAsync()
    {
        var doc = await CallAsync(ct => client.StartPiShockLoginAsync(ct: ct));
        return (Json.Str(doc, "loginUrl") ?? "", Json.Str(doc, "channel") ?? "");
    }

    public Task<JsonElement> GetLoginStatusAsync() => CallAsync(ct => client.GetPiShockLoginStatusAsync(ct));

    public Task ConfirmPiShockLoginAsync() => CallAsync(async ct =>
    {
        await client.ConfirmPiShockLoginAsync(ct: ct);
        return 0;
    });

    public Task CancelPiShockLoginAsync() => CallAsync(async ct =>
    {
        await client.CancelPiShockLoginAsync(ct: ct);
        return 0;
    });

    public Task UnlinkPiShockAsync() => CallAsync(async ct =>
    {
        await client.DeletePiShockSessionAsync(ct);
        return 0;
    });

    public async Task<ActivityShareResponse> GetAvailabilityAsync()
    {
        var el = await CallAsync(ct => client.GetActivityShareAsync(ct));
        return Deserialize<ActivityShareResponse>(el);
    }

    public Task SaveAvailabilityAsync(List<ShareLimitRow> shares, List<string> banned) =>
        CallAsync(async ct =>
        {
            await client.UpdateActivityShareAsync(new { shares, bannedDiscordUserIds = banned }, ct);
            return 0;
        });

    public async Task<ActivitySettingsResponse> GetSettingsAsync()
    {
        var el = await CallAsync(ct => client.GetActivitySettingsAsync(ct));
        return Deserialize<ActivitySettingsResponse>(el);
    }

    public async Task<ActivitySettingsResponse> SaveSettingsAsync(PersonalLimits personal, List<ShareLimitRow> shares)
    {
        var el = await CallAsync(ct => client.UpdateActivitySettingsAsync(new { personal, shares }, ct));
        return Deserialize<ActivitySettingsResponse>(el);
    }

    public Task CreateLinkAsync(Dictionary<string, object?> payload) => CallAsync(async ct =>
    {
        await client.CreateLinkAsync(payload, ct);
        return 0;
    });

    public Task DeleteLinkAsync(int linkId) => CallAsync(async ct =>
    {
        await client.DeleteLinkAsync(linkId.ToString(), ct);
        return 0;
    });

    public Task PauseLinkAsync(int linkId, bool pauseState) => CallAsync(async ct =>
    {
        await client.PauseAsync(new { linkId, pauseState }, ct);
        return 0;
    });

    public Task CreateShareAsync(int shockerId, bool full = false) => CallAsync(async ct =>
    {
        object body = full
            ? new Dictionary<string, object?>
            {
                ["ShockerId"] = shockerId,
                ["MaxIntensity"] = 100,
                ["MaxDuration"] = 15,
                ["CanShock"] = true,
                ["CanVibrate"] = true,
                ["CanBeep"] = true,
            }
            : new Dictionary<string, object?> { ["ShockerId"] = shockerId };
        await client.CreateShareAsync(body, ct);
        return 0;
    });

    public Task ClaimShareAsync(string code) => CallAsync(async ct =>
    {
        await client.ClaimShareAsync(new { code }, ct);
        return 0;
    });

    public async Task<List<AnnouncementItem>> GetAnnouncementsAsync()
    {
        try
        {
            var el = await CallAsync(ct => client.GetAnnouncementsAsync(ct));
            return el.Deserialize<AnnouncementsResponse>(JsonOpts)?.Announcements ?? [];
        }
        catch
        {
            return [];
        }
    }

    public async Task<JsonElement?> GetHealthAsync()
    {
        try
        {
            await EnsureBaseAddressAsync();
            // Cache-Control on the request is rejected by the Blazor WASM browser handler.
            // Bust caches with a query param instead (same idea as fetch cache: "no-store").
            using var req = new HttpRequestMessage(
                HttpMethod.Get,
                $"api/health?_={DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}");
            using var res = await http.SendAsync(req);
            var text = await res.Content.ReadAsStringAsync();
            if (string.IsNullOrWhiteSpace(text)) return null;
            // Discord / SPA fallback sometimes returns HTML on a bad path — treat as down.
            var trimmed = text.TrimStart();
            if (trimmed.StartsWith('<')) return null;
            using var doc = JsonDocument.Parse(text);
            var root = doc.RootElement.Clone();
            if (res.StatusCode != HttpStatusCode.OK && root.ValueKind == JsonValueKind.Object)
            {
                using var wrapped = JsonDocument.Parse(
                    "{\"ok\":false,\"version\":" +
                    JsonSerializer.Serialize(Json.Str(root, "version")) +
                    ",\"shuttingDown\":" + (Json.Bool(root, "shuttingDown") == true ? "true" : "false") + "}");
                return wrapped.RootElement.Clone();
            }
            return root;
        }
        catch
        {
            return null;
        }
    }
}
