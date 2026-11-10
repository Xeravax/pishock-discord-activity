using System.Text.Json;
using PiShock.Activity.Server.Data;
using PiShock.Activity.Server.Discord;
using PiShock.Activity.Server.Operate;
using PiShock.Activity.Server.PiShock;
using PiShock.Activity.Server.Realtime;
using PiShock.Activity.Server.Security;
using OperatePolicyError = PiShock.Activity.Server.Operate.OperatePolicy.OperatePolicyError;

namespace PiShock.Activity.Server.Endpoints;

/// <summary>
/// Endpoint filter for <c>/api/participants/*</c> (port of the preHandler hook in routes/participants.ts):
/// the request must carry a valid Discord activity-proxy signature whose user matches the bearer user.
/// Runs after <see cref="ActivityAuthFilter"/>, so the Discord user is already resolved.
/// </summary>
public sealed class ProxyAuthFilter(AppEnv env) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        try
        {
            var payload = DiscordProxyAuth.ValidateDiscordProxyHeaders(env, http.Request.Headers);
            DiscordProxyAuth.AssertProxyPayloadMatchesUser(payload, http.DiscordUser().Id);
        }
        catch (ProxyAuthError err)
        {
            return ApiResults.Error(err.Status, err.Message, "PROXY_AUTH");
        }
        return await next(context);
    }
}

/// <summary>Port of src/server/routes/participants.ts.</summary>
public static class ParticipantEndpoints
{
    public static IEndpointRouteBuilder MapParticipantEndpoints(this IEndpointRouteBuilder app)
    {
        // Parent group's ActivityAuthFilter runs first, then the proxy-signature filter.
        var participants = app.MapActivityApi().MapGroup("/participants");
        participants.AddEndpointFilter<ProxyAuthFilter>();

        participants.MapPost("/status", GetStatusAsync)
            .WithName("GetParticipantStatus")
            .WithTags("Participants");

        participants.MapPost("/{targetDiscordUserId}/operate", OperateAsync)
            .WithName("OperateParticipant")
            .WithTags("Participants");

        return app;
    }

    // ───────────────────────── status ─────────────────────────

    private static async Task<IResult> GetStatusAsync(
        HttpContext ctx,
        ParticipantStatusRequest? body,
        AppEnv env,
        IHttpClientFactory httpFactory,
        SessionStore sessions)
    {
        var blocked = ControlGuards.RequireConsent(ctx);
        if (blocked is not null) return blocked;

        body ??= new ParticipantStatusRequest();
        var me = ctx.DiscordUser();
        var ct = ctx.RequestAborted;
        var instanceId = string.IsNullOrEmpty(body.InstanceId) ? "" : body.InstanceId;

        try
        {
            await DiscordInstance.VerifyActivityInstanceAsync(
                env,
                instanceId,
                httpFactory.CreateClient(),
                requireUserId: me.Id,
                allowMissingBot: true);
        }
        catch (InstanceAuthError err)
        {
            return ApiResults.Error(err.Status, err.Message, "INSTANCE_AUTH");
        }

        var ids = (body.DiscordUserIds ?? [])
            .Where(id => !string.IsNullOrEmpty(id))
            .Distinct()
            .Take(50)
            .ToList();

        // Same scoped DbContext: queries must run one after another.
        var participants = new List<object>();
        foreach (var id in ids)
        {
            var user = await sessions.FindUserAsync(id, ct);
            var shares = await sessions.ListEnabledActivitySharesAsync(id, ct);
            var bannedYou = await sessions.IsExecutorBannedAsync(id, me.Id, ct);
            var hasSession = await sessions.LoadPiShockCredsAsync(id, ct) is not null;
            var hasConsent = await sessions.GetConsentAsync(id, ct);
            var eStops = (await sessions.GetEmergencyStopShockerIdsAsync(id, ct)).ToHashSet();

            var active = shares.Where(s => s.Enabled && !s.Paused).ToList();
            var operable = active.Where(s => !eStops.Contains(s.ShockerId)).ToList();
            var allEStopped = active.Count > 0 && operable.Count == 0;

            var visibleShockers = new List<object>();
            if (!bannedYou)
            {
                foreach (var s in active)
                {
                    var stopped = eStops.Contains(s.ShockerId);
                    visibleShockers.Add(new
                    {
                        shockerId = s.ShockerId,
                        shockerName = s.ShockerName,
                        hubClientId = s.HubClientId,
                        deviceMaxIntensity = s.DeviceMaxIntensity,
                        deviceMaxDurationMs = s.DeviceMaxDurationMs,
                        maxIntensity = s.MaxIntensity,
                        maxDurationMs = s.MaxDurationMs,
                        canShock = !stopped && s.CanShock,
                        canVibrate = !stopped && s.CanVibrate,
                        canBeep = !stopped && s.CanBeep,
                        canHold = !stopped && s.CanHold,
                        paused = s.Paused,
                        emergencyStop = stopped,
                    });
                }
            }

            participants.Add(new
            {
                discordUserId = id,
                username = user?.Username,
                globalName = user?.GlobalName,
                avatar = user?.Avatar,
                linked = hasSession,
                consent = hasConsent,
                available = hasSession && hasConsent && operable.Count > 0 && !bannedYou,
                paused = shares.Count > 0 && shares.All(s => s.Paused || !s.Enabled),
                emergencyStop = !bannedYou && allEStopped,
                bannedYou,
                shockers = visibleShockers,
            });
        }

        return ApiResults.Json(new { participants });
    }

    // ───────────────────────── operate ─────────────────────────

    private static async Task<IResult> OperateAsync(
        HttpContext ctx,
        string targetDiscordUserId,
        ParticipantOperateRequest? body,
        AppEnv env,
        IHttpClientFactory httpFactory,
        PiShockApiClient api,
        SessionStore sessions,
        BrokerService broker,
        RealtimeHub hub)
    {
        var blocked = ControlGuards.RequireConsent(ctx);
        if (blocked is not null) return blocked;

        var me = ctx.DiscordUser();
        var ct = ctx.RequestAborted;

        try
        {
            OperatePolicy.AssertOperateRateLimit(me.Id);
        }
        catch (OperatePolicyError err)
        {
            return ApiResults.PolicyError(err);
        }

        body ??= new ParticipantOperateRequest();
        var instanceId = string.IsNullOrEmpty(body.InstanceId) ? "" : body.InstanceId;

        ActivityInstanceInfo? instanceInfo;
        try
        {
            instanceInfo = await DiscordInstance.VerifyActivityInstanceAsync(
                env,
                instanceId,
                httpFactory.CreateClient(),
                requireUserId: me.Id,
                requireUserIds: [targetDiscordUserId],
                allowMissingBot: true);
        }
        catch (InstanceAuthError err)
        {
            return ApiResults.Error(err.Status, err.Message, "INSTANCE_AUTH");
        }

        var location = await OperateSupport.ResolveLocationAsync(
            env,
            httpFactory,
            instanceId,
            instanceInfo,
            body.LocationHint,
            ct);

        if (await sessions.IsExecutorBannedAsync(targetDiscordUserId, me.Id, ct))
        {
            return ApiResults.Error(403, "This user has blocked you from controlling their device", "BANNED");
        }

        if (!await sessions.GetConsentAsync(targetDiscordUserId, ct))
        {
            return ApiResults.Error(403, "Target has not consented", "TARGET_CONSENT");
        }

        var targetCreds = await sessions.LoadPiShockCredsAsync(targetDiscordUserId, ct);
        if (targetCreds is null)
        {
            return ApiResults.Error(404, "Target has no linked PiShock session", "TARGET_UNLINKED");
        }

        var shares = (await sessions.ListEnabledActivitySharesAsync(targetDiscordUserId, ct))
            .Where(s => s.Enabled && !s.Paused)
            .ToList();
        if (shares.Count == 0)
        {
            return ApiResults.Error(404, "Target is not available in this activity", "TARGET_UNAVAILABLE");
        }

        var shockerId = body.ShockerId ?? shares[0].ShockerId;
        var share = shares.FirstOrDefault(s => s.ShockerId == shockerId);
        if (share is null)
        {
            return ApiResults.Error(404, "Shocker is not shared in this activity");
        }

        var operation = body.Operation;
        if (string.IsNullOrEmpty(operation))
        {
            return ApiResults.Error(400, "Missing operation");
        }
        if (operation == "stop")
        {
            return ApiResults.Error(403, "Emergency stop is only available to the device owner");
        }

        // Only the stored hub — never body.clientId
        var clientId = share.HubClientId;
        var shareCode = string.IsNullOrEmpty(share.ShareCode) ? null : share.ShareCode;
        var agent = PiShockApiClient.AgentNameForExecutor(ExecutorLabel(me));
        var executorCreds = ctx.PiShockCreds();
        var useSharePath = shareCode is not null && executorCreds is not null;
        var path = useSharePath ? "executor_share" : "target_session";
        var publishCreds = useSharePath ? executorCreds! : targetCreds;

        Task AuditAsync(string auditAction, int auditIntensity, int auditDurationMs, bool success, string detail) =>
            AuditParticipantCommandAsync(
                sessions,
                hub,
                new ParticipantAudit
                {
                    ExecutorDiscordUserId = me.Id,
                    ExecutorUsername = me.Username,
                    ExecutorGlobalName = me.GlobalName,
                    ExecutorAvatar = me.Avatar,
                    TargetDiscordUserId = targetDiscordUserId,
                    Action = auditAction,
                    ShockerId = shockerId,
                    ShareCode = shareCode,
                    Intensity = auditIntensity,
                    DurationMs = auditDurationMs,
                    Success = success,
                    Detail = detail,
                    Location = location,
                },
                ct);

        if (operation == "end")
        {
            if (clientId is null)
            {
                return ApiResults.Error(400, "end requires a stored hub client id on the share");
            }

            OperatePolicy.ClearHoldAutoEnd(targetDiscordUserId, shockerId);
            var ended = await broker.PublishOperateAsync(
                publishCreds,
                OperateSupport.EndInput(clientId, shockerId, useSharePath ? shareCode : null, agent),
                ct);
            await AuditAsync(
                "participant_end",
                0,
                0,
                ended,
                DetailJson(new { via = "broker", path, agent, instanceId }));
            if (!ended)
            {
                return ApiResults.Error(502, "Failed to end hold via broker");
            }
            return ApiResults.Json(new { ok = true, via = "broker", ended = true });
        }

        if (await sessions.IsEmergencyStoppedAsync(targetDiscordUserId, shockerId, ct))
        {
            return ApiResults.Error(423, "Owner has emergency stop engaged", "EMERGENCY_STOP");
        }

        var hold = body.Hold == true || operation == "hold";
        var warning = body.Warning == true || operation == "warning";
        try
        {
            OperatePolicy.AssertModeAllowed(
                operation,
                hold,
                new OperatePolicy.OperateModeFlags
                {
                    CanShock = share.CanShock,
                    CanVibrate = share.CanVibrate,
                    CanBeep = share.CanBeep,
                    CanHold = share.CanHold,
                });
        }
        catch (OperatePolicyError err)
        {
            return ApiResults.PolicyError(err);
        }

        var maxIntensity = Math.Min(share.MaxIntensity, share.DeviceMaxIntensity);
        var maxDurationMs = Math.Min(share.MaxDurationMs, share.DeviceMaxDurationMs);
        if ((body.Intensity ?? 1) > maxIntensity)
        {
            return ApiResults.Error(412, "Intensity exceeds allowed maximum");
        }
        if ((body.DurationMs ?? 300) > maxDurationMs)
        {
            return ApiResults.Error(416, "Duration exceeds allowed maximum");
        }

        var intensity = OperatePolicy.ClampIntensity(body.Intensity, maxIntensity);
        var durationMs = OperatePolicy.ClampDurationMs(body.DurationMs, maxDurationMs);
        var op = OperateSupport.ToShockerOp(operation);
        var action = $"participant_{operation}";

        try
        {
            if ((hold || warning) && clientId is not null)
            {
                var published = await broker.PublishOperateAsync(
                    publishCreds,
                    new PublishOperateInput
                    {
                        ClientId = clientId,
                        ShockerId = shockerId,
                        Operation = op,
                        Intensity = Math.Max(1, intensity),
                        DurationMs = durationMs,
                        Hold = hold,
                        Warning = warning,
                        End = false,
                        ShareCode = useSharePath ? shareCode : null,
                        AgentName = agent,
                    },
                    ct);
                if (published)
                {
                    if (hold)
                    {
                        OperatePolicy.ScheduleHoldAutoEnd(
                            publishCreds,
                            targetDiscordUserId,
                            shockerId,
                            clientId,
                            durationMs,
                            useSharePath ? shareCode : null,
                            agent,
                            OperateSupport.HoldEndPublisher(broker));
                    }
                    await AuditAsync(
                        action,
                        intensity,
                        durationMs,
                        true,
                        DetailJson(new
                        {
                            via = "broker",
                            path,
                            agent,
                            executor = me.Id,
                            target = targetDiscordUserId,
                            instanceId,
                        }));
                    return ApiResults.Json(new { ok = true, via = "broker", path });
                }
            }

            if (useSharePath)
            {
                await api.OperateByShareAsync(
                    executorCreds!,
                    shareCode!,
                    op,
                    Math.Max(1, intensity),
                    durationMs,
                    agent,
                    ct);
                await AuditAsync(
                    action,
                    intensity,
                    durationMs,
                    true,
                    DetailJson(new
                    {
                        via = "operateByShare",
                        path = "executor_share",
                        agent,
                        executor = me.Id,
                        target = targetDiscordUserId,
                        instanceId,
                    }));
                return ApiResults.Json(new { ok = true, via = "operateByShare", path = "executor_share" });
            }

            await api.OperateByIdAsync(
                targetCreds,
                shockerId,
                op,
                Math.Max(1, intensity),
                durationMs,
                agent,
                ct);
            await AuditAsync(
                action,
                intensity,
                durationMs,
                true,
                DetailJson(new
                {
                    via = "operateById",
                    path = "target_session",
                    agent,
                    executor = me.Id,
                    target = targetDiscordUserId,
                    instanceId,
                    note = "Executor has no PiShock session; used target credentials with attributed AgentName",
                }));
            return ApiResults.Json(new { ok = true, via = "operateById", path = "target_session" });
        }
        catch (Exception err)
        {
            await AuditAsync(
                action,
                intensity,
                durationMs,
                false,
                DetailJson(new
                {
                    error = err.Message,
                    agent,
                    executor = me.Id,
                    target = targetDiscordUserId,
                    instanceId,
                }));
            if (err is PiShockApiError apiErr)
            {
                return ApiResults.Json(new { error = apiErr.Message, body = apiErr.Body }, apiErr.Status);
            }
            throw;
        }
    }

    // ───────────────────────── audit ─────────────────────────

    private static readonly JsonSerializerOptions DetailJsonOptions = new()
    {
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    /// <summary>JSON for the log <c>detail</c> column (keeps non-ASCII like "·" readable, as JSON.stringify does).</summary>
    private static string DetailJson(object value) => JsonSerializer.Serialize(value, DetailJsonOptions);

    private static string ExecutorLabel(DiscordUserInfo user)
    {
        var name = !string.IsNullOrEmpty(user.GlobalName)
            ? user.GlobalName
            : !string.IsNullOrEmpty(user.Username)
                ? user.Username
                : "unknown";
        return $"{name} ({user.Id})";
    }

    private sealed class ParticipantAudit
    {
        public required string ExecutorDiscordUserId { get; init; }
        public required string TargetDiscordUserId { get; init; }
        public string? ExecutorUsername { get; init; }
        public string? ExecutorGlobalName { get; init; }
        public string? ExecutorAvatar { get; init; }
        public required string Action { get; init; }
        public required int ShockerId { get; init; }
        public string? ShareCode { get; init; }
        public required int Intensity { get; init; }
        public required int DurationMs { get; init; }
        public required bool Success { get; init; }
        public required string Detail { get; init; }
        public ActivityLocationContext? Location { get; init; }
    }

    private static async Task AuditParticipantCommandAsync(
        SessionStore sessions,
        RealtimeHub hub,
        ParticipantAudit input,
        CancellationToken ct)
    {
        var loc = input.Location;

        CommandLogInput Row(string discordUserId, string? shareCode) => new()
        {
            DiscordUserId = discordUserId,
            ExecutorDiscordUserId = input.ExecutorDiscordUserId,
            TargetDiscordUserId = input.TargetDiscordUserId,
            Action = input.Action,
            ShockerId = input.ShockerId,
            ShareCode = shareCode,
            Intensity = input.Intensity,
            DurationMs = input.DurationMs,
            Success = input.Success,
            Detail = input.Detail,
            Source = "discord",
            InstanceId = loc?.InstanceId,
            GuildId = loc?.GuildId,
            ChannelId = loc?.ChannelId,
            LocationKind = loc?.LocationKind,
            LocationName = loc?.LocationName,
            LocationIconUrl = loc?.LocationIconUrl,
        };

        // Executor log never receives the share code; owner/target row may store it server-side.
        // (Sequential: both rows go through the same scoped DbContext.)
        await sessions.LogCommandAsync(Row(input.ExecutorDiscordUserId, null), ct);
        await sessions.LogCommandAsync(Row(input.TargetDiscordUserId, input.ShareCode), ct);

        var action = input.Action.ToLowerInvariant();
        if (input.Success && action != "participant_end" && action != "end" && action != "stop")
        {
            hub.Broadcast(
                RealtimeEvents.IncomingCommand(
                    input.TargetDiscordUserId,
                    input.ExecutorDiscordUserId,
                    input.ExecutorUsername,
                    input.ExecutorGlobalName,
                    input.ExecutorAvatar,
                    input.Action,
                    input.ShockerId,
                    input.Intensity,
                    input.DurationMs,
                    input.Success),
                discordUserId: input.TargetDiscordUserId);
        }
    }
}

// ───────────────────────── request bodies ─────────────────────────

public sealed class ParticipantStatusRequest
{
    public List<string>? DiscordUserIds { get; set; }
    public string? InstanceId { get; set; }
}

public sealed class ParticipantOperateRequest
{
    public string? InstanceId { get; set; }
    public ClientLocationHint? LocationHint { get; set; }
    public int? ShockerId { get; set; }

    /// <summary>shock | vibrate | beep | hold | warning | stop | end</summary>
    public string? Operation { get; set; }

    public double? Intensity { get; set; }
    public double? DurationMs { get; set; }
    public bool? Hold { get; set; }
    public bool? Warning { get; set; }
    // Client-supplied clientId is intentionally not bound: the stored hub on the share is used.
}
