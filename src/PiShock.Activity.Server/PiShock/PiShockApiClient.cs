using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using PiShock.Activity.Server.Shared;

namespace PiShock.Activity.Server.PiShock;

/// <summary>Result of a PiShock REST call. <see cref="Data"/> is null for 204 / empty body / 404 / 405.</summary>
public sealed record PiShockResponse(int Status, JsonElement? Data, string Raw);

/// <summary>Body for do.pishock.com <c>/Client/Operate</c>.</summary>
public sealed record ClientOperateRequest(
    int ShockerId,
    int Intensity,
    int Duration,
    int Op,
    bool Hold = false,
    bool Warning = false);

public sealed class PiShockApiClient
{
    private static readonly JsonSerializerOptions BodyJson = new()
    {
        PropertyNamingPolicy = null,
        DictionaryKeyPolicy = null,
    };

    private static readonly string[] ListWrapperKeys =
        ["items", "Items", "data", "Data", "shockers", "Shockers"];

    private readonly IHttpClientFactory _httpFactory;
    private readonly ILogger<PiShockApiClient> _logger;

    public PiShockApiClient(IHttpClientFactory httpFactory, ILogger<PiShockApiClient> logger)
    {
        _httpFactory = httpFactory;
        _logger = logger;
    }

    private async Task<PiShockResponse> RequestAsync(
        PiShockCreds creds,
        HttpMethod method,
        string url,
        object? body = null,
        CancellationToken ct = default)
    {
        var hasJsonBody = body is not null;
        using var req = new HttpRequestMessage(method, url);
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        req.Headers.TryAddWithoutValidation("X-PiShock-UserId", creds.UserId.ToString(System.Globalization.CultureInfo.InvariantCulture));
        req.Headers.TryAddWithoutValidation("X-PiShock-Token", creds.Token);

        // Never send Content-Type on GETs — api.pishock.com rejects empty JSON bodies with 400 SerializerErrors
        if (hasJsonBody)
        {
            var json = JsonSerializer.Serialize(body, BodyJson);
            req.Content = new StringContent(json, Encoding.UTF8);
            req.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        }

        var http = _httpFactory.CreateClient();
        using var res = await http.SendAsync(req, ct);
        var raw = await res.Content.ReadAsStringAsync(ct);
        var status = (int)res.StatusCode;

        if (res.StatusCode == HttpStatusCode.Unauthorized)
        {
            throw new PiShockApiError(401, string.IsNullOrEmpty(raw) ? "Unauthorized" : raw);
        }
        if (status is 404 or 405)
        {
            return new PiShockResponse(status, null, raw);
        }
        if (!res.IsSuccessStatusCode && status != 204)
        {
            throw new PiShockApiError(status, raw);
        }
        if (status == 204 || string.IsNullOrEmpty(raw))
        {
            return new PiShockResponse(status, null, raw);
        }

        try
        {
            using var doc = JsonDocument.Parse(raw);
            return new PiShockResponse(status, doc.RootElement.Clone(), raw);
        }
        catch (JsonException)
        {
            // Non-JSON payload: surface as a JSON string (mirrors `raw as unknown as T`)
            return new PiShockResponse(status, JsonSerializer.SerializeToElement(raw), raw);
        }
    }

    public Task<PiShockResponse> GetHubsAsync(PiShockCreds creds, CancellationToken ct = default) =>
        RequestAsync(creds, HttpMethod.Get, $"{Constants.PiShockApi}/Hub", null, ct);

    public Task<PiShockResponse> GetShockersAsync(PiShockCreds creds, CancellationToken ct = default) =>
        RequestAsync(creds, HttpMethod.Get, $"{Constants.PiShockApi}/Shockers", null, ct);

    public Task<PiShockResponse> GetSharedAsync(PiShockCreds creds, CancellationToken ct = default) =>
        RequestAsync(creds, HttpMethod.Get, $"{Constants.PiShockApi}/Share/GetShared", null, ct);

    public Task<PiShockResponse> GetLinksAsync(PiShockCreds creds, CancellationToken ct = default) =>
        RequestAsync(creds, HttpMethod.Get, $"{Constants.PiShockApi}/Links", null, ct);

    /// <param name="payload">Any JSON-serializable object (dictionary, anonymous type, JsonElement, ...).</param>
    public Task<PiShockResponse> CreateLinkAsync(PiShockCreds creds, object payload, CancellationToken ct = default) =>
        RequestAsync(creds, HttpMethod.Post, $"{Constants.PiShockApi}/Links", payload, ct);

    public Task<PiShockResponse> PauseLinkAsync(
        PiShockCreds creds,
        int linkId,
        bool? pauseState,
        CancellationToken ct = default) =>
        RequestAsync(
            creds,
            HttpMethod.Patch,
            $"{Constants.PiShockApi}/Links/Pause/{linkId}",
            new Dictionary<string, object?> { ["PauseState"] = pauseState },
            ct);

    public Task<PiShockResponse> DeleteLinkAsync(PiShockCreds creds, int linkId, CancellationToken ct = default) =>
        RequestAsync(creds, HttpMethod.Delete, $"{Constants.PiShockApi}/Links/{linkId}", null, ct);

    public Task<PiShockResponse> CreateShareAsync(PiShockCreds creds, object payload, CancellationToken ct = default) =>
        RequestAsync(creds, HttpMethod.Post, $"{Constants.PiShockApi}/Share", payload, ct);

    /// <summary>Claim / redeem share code(s) into the signed-in account (website Friends → Shared Code).</summary>
    public Task<PiShockResponse> ClaimShareCodesAsync(
        PiShockCreds creds,
        IEnumerable<string> codes,
        CancellationToken ct = default)
    {
        var shares = codes
            .Select(c => (c ?? "").Trim())
            .Where(c => c.Length > 0)
            .ToList();
        return RequestAsync(
            creds,
            HttpMethod.Put,
            $"{Constants.PiShockApi}/Share",
            new Dictionary<string, object?> { ["Shares"] = shares },
            ct);
    }

    public Task<PiShockResponse> PauseShareAsync(
        PiShockCreds creds,
        int shareId,
        bool? pauseState,
        CancellationToken ct = default) =>
        RequestAsync(
            creds,
            HttpMethod.Patch,
            $"{Constants.PiShockApi}/Share/Pause",
            new Dictionary<string, object?>
            {
                ["ShareId"] = shareId,
                ["PauseState"] = pauseState,
            },
            ct);

    public Task<PiShockResponse> DeleteShareAsync(PiShockCreds creds, int shareId, CancellationToken ct = default) =>
        RequestAsync(creds, HttpMethod.Delete, $"{Constants.PiShockApi}/Share/{shareId}", null, ct);

    /// <summary>PiShock device-log origin; keep short so Discord executor id fits.</summary>
    public static string AgentNameForExecutor(string? executorLabel = null)
    {
        var baseName = Constants.AgentName;
        var who = (executorLabel ?? "").Trim();
        if (who.Length == 0) return baseName;
        var combined = $"{baseName} · {who}";
        return combined.Length <= 48
            ? combined
            : $"{who[..Math.Min(24, who.Length)]} · Discord";
    }

    public Task<PiShockResponse> OperateByIdAsync(
        PiShockCreds creds,
        int shockerId,
        ShockerOp operation,
        int intensity,
        int durationMs,
        string? agentName = null,
        CancellationToken ct = default) =>
        RequestAsync(
            creds,
            HttpMethod.Post,
            $"{Constants.PiShockApi}/Shockers/OperateById/{shockerId}",
            new Dictionary<string, object?>
            {
                ["AgentName"] = agentName ?? Constants.AgentName,
                ["Operation"] = (int)operation,
                ["Intensity"] = intensity,
                ["Duration"] = durationMs,
                ["IntensityAsPercentage"] = true,
            },
            ct);

    public Task<PiShockResponse> OperateByShareAsync(
        PiShockCreds creds,
        string shareCode,
        ShockerOp operation,
        int intensity,
        int durationMs,
        string? agentName = null,
        CancellationToken ct = default) =>
        RequestAsync(
            creds,
            HttpMethod.Post,
            $"{Constants.PiShockApi}/Shockers/OperateByShare/{Uri.EscapeDataString(shareCode)}",
            new Dictionary<string, object?>
            {
                ["AgentName"] = agentName ?? Constants.AgentName,
                ["Operation"] = (int)operation,
                ["Intensity"] = intensity,
                ["Duration"] = durationMs,
                ["IntensityAsPercentage"] = true,
            },
            ct);

    /// <summary>Hold / warning / Client operate path used by the website control page.</summary>
    public Task<PiShockResponse> ClientOperateAsync(
        PiShockCreds creds,
        ClientOperateRequest body,
        CancellationToken ct = default) =>
        // Official website body (do.pishock.com). Currently 404 for many accounts; callers should fall back.
        RequestAsync(
            creds,
            HttpMethod.Post,
            $"{Constants.PiShockDo}/Client/Operate",
            new Dictionary<string, object?>
            {
                ["ShockerId"] = body.ShockerId,
                ["Intensity"] = body.Intensity,
                ["Duration"] = body.Duration,
                ["UserId"] = creds.UserId,
                ["Token"] = creds.Token,
                ["Op"] = body.Op,
                ["Shared"] = false,
                ["Hold"] = body.Hold,
                ["SessionHex"] = "",
                ["Warning"] = body.Warning
                    ? new Dictionary<string, object?> { ["Active"] = true, ["Min"] = 1, ["Max"] = 30 }
                    : null,
                ["Name"] = Constants.AgentName,
            },
            ct);

    public Task<PiShockResponse> LoadLogsAsync(
        PiShockCreds creds,
        int? clientId = null,
        CancellationToken ct = default)
    {
        var url = clientId is { } id and not 0
            ? $"{Constants.PiShockDo}/Client/LoadLogs?ClientId={id}"
            : $"{Constants.PiShockDo}/Client/LoadLogs";
        return RequestAsync(creds, HttpMethod.Get, url, null, ct);
    }

    private async Task<List<JsonElement>> SoftListAsync(
        string label,
        Func<Task<PiShockResponse>> call,
        CancellationToken ct,
        int attempts = 2)
    {
        Exception? lastErr = null;
        for (var i = 0; i < attempts; i++)
        {
            try
            {
                var res = await call();
                if (res.Status is 404 or 405) return [];
                if (res.Data is not { } data) return [];
                if (data.ValueKind == JsonValueKind.Array) return CloneItems(data);
                if (data.ValueKind == JsonValueKind.Null) return [];
                // Some endpoints wrap lists
                if (data.ValueKind == JsonValueKind.Object)
                {
                    foreach (var key in ListWrapperKeys)
                    {
                        if (data.TryGetProperty(key, out var inner) && inner.ValueKind == JsonValueKind.Array)
                        {
                            return CloneItems(inner);
                        }
                    }
                }
                return [];
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception err)
            {
                lastErr = err;
                // Retry transient 4xx/5xx once; still throw hard auth failures
                if (err is PiShockApiError { NeedsRelogin: true }) throw;
                if (i + 1 < attempts)
                {
                    await Task.Delay(250, ct);
                }
            }
        }

        // Prefer empty control UI over failing the whole activity after login
        _logger.LogWarning(lastErr, "[pishock] {Label} failed; returning []", label);
        return [];
    }

    private static List<JsonElement> CloneItems(JsonElement array)
    {
        var list = new List<JsonElement>(array.GetArrayLength());
        foreach (var item in array.EnumerateArray()) list.Add(item.Clone());
        return list;
    }

    public async Task<ControlSnapshot> FetchControlSnapshotAsync(PiShockCreds creds, CancellationToken ct = default)
    {
        var hubsTask = SoftListAsync("Hub", () => GetHubsAsync(creds, ct), ct);
        var shockersTask = SoftListAsync("Shockers", () => GetShockersAsync(creds, ct), ct);
        var sharedTask = SoftListAsync("Share/GetShared", () => GetSharedAsync(creds, ct), ct);
        var linksTask = SoftListAsync("Links", () => GetLinksAsync(creds, ct), ct);

        await Task.WhenAll(hubsTask, shockersTask, sharedTask, linksTask);

        return new ControlSnapshot
        {
            Hubs = hubsTask.Result,
            Shockers = shockersTask.Result,
            Shared = sharedTask.Result,
            Links = linksTask.Result,
        };
    }
}
