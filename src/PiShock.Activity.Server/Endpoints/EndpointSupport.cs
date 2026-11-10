using System.Text.Json;
using System.Text.Json.Serialization;
using PiShock.Activity.Server.Data;
using PiShock.Activity.Server.Discord;
using PiShock.Activity.Server.Operate;
using PiShock.Activity.Server.PiShock;
using PiShock.Activity.Server.Security;
using PiShock.Activity.Server.Shared;

namespace PiShock.Activity.Server.Endpoints;

/// <summary>
/// JSON responses that match the Fastify server: camelCase properties and <c>null</c> kept (Fastify only drops
/// <c>undefined</c>), error bodies shaped <c>{ error, code? }</c>.
/// </summary>
public static class ApiResults
{
    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    public static IResult Json(object? value, int statusCode = StatusCodes.Status200OK) =>
        Results.Json(value, JsonOptions, statusCode: statusCode);

    public static IResult Error(int statusCode, string message, string? code = null) =>
        code is null
            ? Json(new { error = message }, statusCode)
            : Json(new { error = message, code }, statusCode);

    /// <summary>Policy rejection → <c>{ error, code }</c> (or only <c>{ error }</c> when the route never sent a code).</summary>
    public static IResult PolicyError(OperatePolicy.OperatePolicyError err, bool includeCode = true) =>
        Error(err.Status, err.Message, includeCode ? err.Code : null);

    /// <summary>Personal limits as sent to the client (<c>{ activityMaxIntensity, activityMaxDurationMs }</c>).</summary>
    public static object Personal(PersonalActivityLimits limits) => new
    {
        activityMaxIntensity = limits.ActivityMaxIntensity,
        activityMaxDurationMs = limits.ActivityMaxDurationMs,
    };

    /// <summary>Tolerant JSON body reader: missing / empty / invalid body yields null (Fastify: <c>undefined</c>).</summary>
    public static async Task<JsonElement?> ReadJsonAsync(HttpRequest request, CancellationToken ct)
    {
        if (request.ContentLength == 0) return null;
        try
        {
            using var doc = await JsonDocument.ParseAsync(request.Body, cancellationToken: ct);
            return doc.RootElement.Clone();
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

/// <summary>Shared route guards (control.ts <c>requireSession</c> / <c>handlePiShockError</c>).</summary>
public static class ControlGuards
{
    /// <summary>403 without consent, 401 <c>PISHOCK_RELOGIN</c> without a linked PiShock session; null when allowed.</summary>
    public static IResult? RequireSession(HttpContext ctx)
    {
        var blocked = RequireConsent(ctx);
        if (blocked is not null) return blocked;
        if (ctx.PiShockCreds() is null)
        {
            return ApiResults.Error(401, "PiShock login required", "PISHOCK_RELOGIN");
        }
        return null;
    }

    public static IResult? RequireConsent(HttpContext ctx) =>
        ctx.HasConsent() ? null : ApiResults.Error(403, "Consent required", "CONSENT_REQUIRED");

    /// <summary>
    /// A PiShock 401 means the website session died: drop it and ask the client to log in again. Any other upstream
    /// error is relayed with its status as <c>{ error, body }</c>.
    /// </summary>
    public static async Task<IResult> PiShockErrorAsync(
        PiShockApiError err,
        string discordUserId,
        SessionStore sessions)
    {
        if (err.NeedsRelogin)
        {
            await sessions.ClearPiShockSessionAsync(discordUserId);
            return ApiResults.Error(401, "PiShock session expired", "PISHOCK_RELOGIN");
        }
        return ApiResults.Json(new { error = err.Message, body = err.Body }, err.Status);
    }
}

/// <summary>Operate/log helpers shared by the control and participant endpoints.</summary>
public static class OperateSupport
{
    /// <summary>Wires <see cref="OperatePolicy"/> to the real store and PiShock client.</summary>
    public static OperatePolicy.OperatePolicyDeps CreateDeps(SessionStore sessions, PiShockApiClient api) => new()
    {
        GetPersonalActivityLimits = async id =>
        {
            var limits = await sessions.GetPersonalActivityLimitsAsync(id);
            return (limits.ActivityMaxIntensity, limits.ActivityMaxDurationMs);
        },
        FetchControlSnapshot = creds => api.FetchControlSnapshotAsync(creds),
        FindActivityShareByCode = async code =>
            SessionStore.ToPolicyRow(await sessions.FindActivityShareByCodeAsync(code)),
        FindActivityShareByShocker = async (id, shockerId) =>
            SessionStore.ToPolicyRow(await sessions.FindActivityShareByShockerAsync(id, shockerId)),
        GetConsent = id => sessions.GetConsentAsync(id),
        IsExecutorBanned = (owner, executor) => sessions.IsExecutorBannedAsync(owner, executor),
        IsEmergencyStopped = (id, shockerId) => sessions.IsEmergencyStoppedAsync(id, shockerId),
    };

    public static ShockerOp ToShockerOp(string? operation) => operation switch
    {
        "shock" or "hold" => ShockerOp.Shock,
        "vibrate" or "warning" => ShockerOp.Vibrate,
        _ => ShockerOp.Beep,
    };

    /// <summary>Broker publish that ends the current hold / operation (wire mode "e").</summary>
    public static PublishOperateInput EndInput(
        string clientId,
        int shockerId,
        string? shareCode,
        string? agentName) => new()
    {
        ClientId = clientId,
        ShockerId = shockerId,
        End = true,
        Intensity = 0,
        DurationMs = 0,
        ShareCode = string.IsNullOrEmpty(shareCode) ? null : shareCode,
        AgentName = agentName,
    };

    /// <summary>Hold auto-end timer callback: publishes an "end" through the broker.</summary>
    public static Func<PiShockCreds, string, int, string?, string?, Task> HoldEndPublisher(BrokerService broker) =>
        async (creds, clientId, shockerId, shareCode, agentName) =>
        {
            try
            {
                await broker.PublishOperateAsync(creds, EndInput(clientId, shockerId, shareCode, agentName));
            }
            catch
            {
                // Timer callback: nobody to report to; the hold ends on the device by itself.
            }
        };

    /// <summary>Activity-feed row: always attributed to the device owner so the public log can dedupe.</summary>
    public static Task LogOperateEventAsync(
        SessionStore sessions,
        string executorDiscordUserId,
        string ownerDiscordUserId,
        string action,
        int? shockerId,
        string? shareCode,
        int intensity,
        int durationMs,
        bool success,
        string? detail,
        ActivityLocationContext? location) =>
        sessions.LogCommandAsync(new CommandLogInput
        {
            DiscordUserId = ownerDiscordUserId,
            ExecutorDiscordUserId = executorDiscordUserId,
            TargetDiscordUserId = ownerDiscordUserId,
            Action = action,
            ShockerId = shockerId,
            ShareCode = shareCode,
            Intensity = intensity,
            DurationMs = durationMs,
            Success = success,
            Detail = detail,
            Source = "discord",
            InstanceId = location?.InstanceId,
            GuildId = location?.GuildId,
            ChannelId = location?.ChannelId,
            LocationKind = location?.LocationKind,
            LocationName = location?.LocationName,
            LocationIconUrl = location?.LocationIconUrl,
        });

    public static Task<ActivityLocationContext> ResolveLocationAsync(
        AppEnv env,
        IHttpClientFactory httpFactory,
        string? instanceId,
        ActivityInstanceInfo? prefetched,
        ClientLocationHint? hint,
        CancellationToken ct) =>
        DiscordLocation.ResolveActivityLocationAsync(
            env,
            httpFactory.CreateClient(),
            string.IsNullOrEmpty(instanceId) ? null : instanceId,
            prefetched,
            hint,
            ct);
}
