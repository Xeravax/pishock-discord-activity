using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Channels;
using PiShock.Activity.Server.Discord;

namespace PiShock.Activity.Server.Realtime;

/// <summary>
/// Builders for the realtime wire events (port of the <c>RealtimeEvent</c> union in src/server/realtime.ts).
/// Every event is <c>{ type, ..., at }</c> with camelCase keys.
/// </summary>
public static class RealtimeEvents
{
    private static long Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    public static object HelloOk(string discordUserId) =>
        new { type = "hello_ok", discordUserId, at = Now() };

    public static object AuthRequired() => new { type = "auth_required", at = Now() };

    public static object Ping(long? at = null) => new { type = "ping", at = at ?? Now() };

    public static object ServerShuttingDown() => new { type = "server_shutting_down", at = Now() };

    public static object EmergencyStop(
        string ownerDiscordUserId,
        int shockerId,
        bool engaged,
        IReadOnlyList<int> emergencyStopShockerIds) => new
    {
        type = "emergency_stop",
        ownerDiscordUserId,
        shockerId,
        engaged,
        emergencyStopShockerIds,
        at = Now(),
    };

    public static object ActivityShareChanged(string ownerDiscordUserId) =>
        new { type = "activity_share_changed", ownerDiscordUserId, at = Now() };

    /// <summary><c>reason</c> is omitted from the payload when null (JS: undefined).</summary>
    public static object ParticipantsInvalidate(string? reason = null) =>
        reason is null
            ? new { type = "participants_invalidate", at = Now() }
            : new { type = "participants_invalidate", reason, at = Now() };

    /// <summary>Someone just operated on this user's shared shockers — for PIP last-hit UI.</summary>
    public static object IncomingCommand(
        string targetDiscordUserId,
        string executorDiscordUserId,
        string? executorUsername,
        string? executorGlobalName,
        string? executorAvatar,
        string action,
        int shockerId,
        int intensity,
        int durationMs,
        bool success) => new
    {
        type = "incoming_command",
        targetDiscordUserId,
        executorDiscordUserId,
        executorUsername,
        executorGlobalName,
        executorAvatar,
        action,
        shockerId,
        intensity,
        durationMs,
        success,
        at = Now(),
    };
}

/// <summary>
/// WebSocket fan-out for <c>/api/ws</c> (port of src/server/realtime.ts).
/// <list type="bullet">
/// <item>Auth: <c>Authorization: Bearer</c> header or <c>?access_token=</c>/<c>?token=</c> before the upgrade
/// (rejected with the Discord status), otherwise the server sends <c>auth_required</c> and waits 5 s for a first
/// <c>{ type: "auth", access_token }</c> message (close 4401 on timeout / empty / rejected token).</item>
/// <item>Client messages: <c>join { instanceId }</c> and <c>ping</c>; the server answers <c>hello_ok</c> / <c>ping</c>.</item>
/// <item>Server pings every 25 s; <see cref="CloseAll"/> closes with 1001 after flushing queued events.</item>
/// </list>
/// Each connection has its own ordered outbox, so slow clients never block broadcasts.
/// </summary>
public sealed class RealtimeHub : IDisposable
{
    private const int AuthTimeoutMs = 5_000;
    private const int PingIntervalMs = 25_000;
    private const int MaxMessageBytes = 64 * 1024;
    private const int OutboxCapacity = 512;
    private const int CloseGraceMs = 2_000;

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    private readonly ConcurrentDictionary<Guid, Client> _clients = new();
    private readonly Timer _pingTimer;

    public RealtimeHub()
    {
        _pingTimer = new Timer(
            _ => BroadcastAll(RealtimeEvents.Ping()),
            null,
            PingIntervalMs,
            PingIntervalMs);
    }

    public int ClientCount => _clients.Count;

    // ───────────────────────── broadcast ─────────────────────────

    /// <summary>
    /// Sends <paramref name="evt"/> to matching clients. A <paramref name="discordUserId"/> filter is exact; an
    /// <paramref name="instanceId"/> filter skips clients that joined a different instance (unless a user filter is set).
    /// </summary>
    public void Broadcast(object evt, string? discordUserId = null, string? instanceId = null)
    {
        var payload = JsonSerializer.Serialize(evt, JsonOptions);
        foreach (var client in _clients.Values)
        {
            if (!string.IsNullOrEmpty(discordUserId) && client.DiscordUserId != discordUserId) continue;
            if (!string.IsNullOrEmpty(instanceId)
                && client.InstanceId is { Length: > 0 } joined
                && joined != instanceId
                && string.IsNullOrEmpty(discordUserId))
            {
                continue;
            }
            client.Enqueue(payload);
        }
    }

    /// <summary>Fan-out to every connected activity client (small N; Discord activity scale).</summary>
    public void BroadcastAll(object evt)
    {
        var payload = JsonSerializer.Serialize(evt, JsonOptions);
        foreach (var client in _clients.Values) client.Enqueue(payload);
    }

    /// <summary>Flush queued events, then close every socket with 1001 "server shutting down".</summary>
    public void CloseAll()
    {
        foreach (var client in _clients.Values) client.RequestClose();
    }

    public void Dispose()
    {
        _pingTimer.Dispose();
        CloseAll();
    }

    // ───────────────────────── connection handling ─────────────────────────

    /// <summary>Handles one upgrade request on <c>/api/ws</c> for its whole lifetime.</summary>
    public async Task HandleAsync(HttpContext http)
    {
        if (!http.WebSockets.IsWebSocketRequest)
        {
            http.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }

        var ct = http.RequestAborted;
        var discord = http.RequestServices.GetRequiredService<DiscordAuthService>();
        var token = ExtractToken(http.Request);

        if (token is not null)
        {
            DiscordUserInfo user;
            try
            {
                user = await discord.ResolveBearerUserAsync(token, ct);
            }
            catch (Exception err)
            {
                http.Response.StatusCode = err is DiscordAuthError auth
                    ? auth.Status
                    : StatusCodes.Status401Unauthorized;
                return;
            }

            using var authedSocket = await http.WebSockets.AcceptWebSocketAsync();
            await RunAuthenticatedAsync(authedSocket, user.Id, ct);
            return;
        }

        // No header/query token — accept and require a first-message auth frame
        using var socket = await http.WebSockets.AcceptWebSocketAsync();
        var discordUserId = await AuthenticateFirstMessageAsync(socket, discord, ct);
        if (discordUserId is null) return;
        await RunAuthenticatedAsync(socket, discordUserId, ct);
    }

    private static async Task<string?> AuthenticateFirstMessageAsync(
        WebSocket socket,
        DiscordAuthService discord,
        CancellationToken requestAborted)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(requestAborted);
        timeout.CancelAfter(AuthTimeoutMs);

        try
        {
            await SendDirectAsync(socket, RealtimeEvents.AuthRequired(), timeout.Token);

            while (true)
            {
                var text = await ReceiveTextAsync(socket, timeout.Token);
                if (text is null) return null; // peer closed

                if (!TryParseObject(text, out var msg)) continue;
                if (GetString(msg, "type") != "auth") continue;

                var accessToken = (GetString(msg, "access_token") ?? GetString(msg, "token") ?? "").Trim();
                if (accessToken.Length == 0)
                {
                    await CloseQuietlyAsync(socket, (WebSocketCloseStatus)4401, "missing token");
                    return null;
                }

                try
                {
                    var user = await discord.ResolveBearerUserAsync(accessToken, timeout.Token);
                    return user.Id;
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch
                {
                    await CloseQuietlyAsync(socket, (WebSocketCloseStatus)4401, "unauthorized");
                    return null;
                }
            }
        }
        catch (OperationCanceledException)
        {
            if (!requestAborted.IsCancellationRequested)
            {
                await CloseQuietlyAsync(socket, (WebSocketCloseStatus)4401, "auth timeout");
            }
            return null;
        }
        catch (WebSocketException)
        {
            return null;
        }
        catch (MessageTooLargeException)
        {
            await CloseQuietlyAsync(socket, WebSocketCloseStatus.MessageTooBig, "message too big");
            return null;
        }
    }

    private async Task RunAuthenticatedAsync(WebSocket socket, string discordUserId, CancellationToken requestAborted)
    {
        var client = new Client(socket, discordUserId);
        _clients[client.Id] = client;
        client.Enqueue(JsonSerializer.Serialize(RealtimeEvents.HelloOk(discordUserId), JsonOptions));

        var pump = Task.Run(() => PumpAsync(client));
        using var receiveCts = CancellationTokenSource.CreateLinkedTokenSource(requestAborted, client.Lifetime.Token);
        try
        {
            while (socket.State == WebSocketState.Open)
            {
                var text = await ReceiveTextAsync(socket, receiveCts.Token);
                if (text is null) break; // close frame
                HandleClientMessage(client, text);
            }
        }
        catch (OperationCanceledException)
        {
            // request aborted or shutdown grace elapsed
        }
        catch (WebSocketException)
        {
            // peer vanished
        }
        catch (MessageTooLargeException)
        {
            await client.CloseOutputAsync(WebSocketCloseStatus.MessageTooBig, "message too big");
        }
        finally
        {
            _clients.TryRemove(client.Id, out _);
            client.Outbox.Writer.TryComplete();

            // Answer a peer-initiated close, then stop the pump (it may still be flushing / blocked on a dead peer).
            if (socket.State == WebSocketState.CloseReceived)
            {
                await client.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "");
            }
            await client.Lifetime.CancelAsync();
            try
            {
                await pump;
            }
            catch
            {
                // pump never throws; defensive
            }
            client.Dispose();
        }
    }

    private static void HandleClientMessage(Client client, string text)
    {
        if (!TryParseObject(text, out var msg)) return;

        var type = GetString(msg, "type");
        if (type == "join"
            && msg.TryGetProperty("instanceId", out var instance)
            && instance.ValueKind == JsonValueKind.String
            && instance.GetString() is { Length: > 0 } instanceId)
        {
            client.InstanceId = instanceId;
            client.Enqueue(JsonSerializer.Serialize(RealtimeEvents.HelloOk(client.DiscordUserId), JsonOptions));
        }
        if (type == "ping")
        {
            client.Enqueue(JsonSerializer.Serialize(RealtimeEvents.Ping(), JsonOptions));
        }
    }

    /// <summary>Sends queued events in order; after a requested shutdown close it flushes, then sends 1001.</summary>
    private static async Task PumpAsync(Client client)
    {
        try
        {
            await foreach (var message in client.Outbox.Reader.ReadAllAsync(client.Lifetime.Token))
            {
                if (client.Socket.State != WebSocketState.Open) break;
                await client.SendTextAsync(message, client.Lifetime.Token);
            }

            if (client.CloseRequested && client.Socket.State == WebSocketState.Open)
            {
                await client.CloseOutputAsync(WebSocketCloseStatus.EndpointUnavailable, "server shutting down");
            }
        }
        catch
        {
            // socket gone or lifetime cancelled
        }
    }

    // ───────────────────────── helpers ─────────────────────────

    /// <summary>Prefer the Authorization header; query-string tokens are a legacy fallback only.</summary>
    private static string? ExtractToken(HttpRequest request)
    {
        var header = request.Headers.Authorization.FirstOrDefault();
        if (header is not null && header.StartsWith("Bearer ", StringComparison.Ordinal))
        {
            var bearer = header["Bearer ".Length..].Trim();
            return bearer.Length == 0 ? null : bearer;
        }

        string? fromQuery = null;
        if (request.Query.TryGetValue("access_token", out var accessToken))
        {
            fromQuery = accessToken.FirstOrDefault();
        }
        else if (request.Query.TryGetValue("token", out var legacy))
        {
            fromQuery = legacy.FirstOrDefault();
        }
        return string.IsNullOrEmpty(fromQuery) ? null : fromQuery;
    }

    private static bool TryParseObject(string text, out JsonElement root)
    {
        root = default;
        try
        {
            using var doc = JsonDocument.Parse(text);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return false;
            root = doc.RootElement.Clone();
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static string? GetString(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var value)) return null;
        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Null or JsonValueKind.Undefined => null,
            _ => value.ToString(),
        };
    }

    private static Task SendDirectAsync(WebSocket socket, object evt, CancellationToken ct) =>
        socket.SendAsync(
            Encoding.UTF8.GetBytes(JsonSerializer.Serialize(evt, JsonOptions)),
            WebSocketMessageType.Text,
            endOfMessage: true,
            ct);

    /// <summary>Reads one complete message as UTF-8 text; null when the peer sent a close frame.</summary>
    private static async Task<string?> ReceiveTextAsync(WebSocket socket, CancellationToken ct)
    {
        var buffer = new byte[4096];
        using var message = new MemoryStream();
        while (true)
        {
            var result = await socket.ReceiveAsync(buffer, ct);
            if (result.MessageType == WebSocketMessageType.Close) return null;

            if (message.Length + result.Count > MaxMessageBytes) throw new MessageTooLargeException();
            message.Write(buffer, 0, result.Count);
            if (result.EndOfMessage) return Encoding.UTF8.GetString(message.GetBuffer(), 0, (int)message.Length);
        }
    }

    private static async Task CloseQuietlyAsync(WebSocket socket, WebSocketCloseStatus status, string reason)
    {
        try
        {
            if (socket.State is not (WebSocketState.Open or WebSocketState.CloseReceived)) return;
            using var cts = new CancellationTokenSource(CloseGraceMs);
            await socket.CloseOutputAsync(status, reason, cts.Token);
        }
        catch
        {
            // ignore
        }
    }

    private sealed class MessageTooLargeException : Exception;

    /// <summary>One authenticated socket: ordered outbox + a lock so only one frame is ever in flight.</summary>
    private sealed class Client(WebSocket socket, string discordUserId) : IDisposable
    {
        private readonly SemaphoreSlim _sendLock = new(1, 1);
        private volatile bool _closeRequested;

        public Guid Id { get; } = Guid.NewGuid();
        public WebSocket Socket { get; } = socket;
        public string DiscordUserId { get; } = discordUserId;
        public volatile string? InstanceId;

        public CancellationTokenSource Lifetime { get; } = new();

        public Channel<string> Outbox { get; } = Channel.CreateBounded<string>(
            new BoundedChannelOptions(OutboxCapacity)
            {
                SingleReader = true,
                FullMode = BoundedChannelFullMode.DropOldest,
            });

        public bool CloseRequested => _closeRequested;

        public void Enqueue(string json) => Outbox.Writer.TryWrite(json);

        /// <summary>Ends the outbox (pump flushes it, then sends 1001); force-cancels if the peer lingers.</summary>
        public void RequestClose()
        {
            _closeRequested = true;
            Outbox.Writer.TryComplete();
            _ = Task.Delay(CloseGraceMs).ContinueWith(
                _ =>
                {
                    try { Lifetime.Cancel(); } catch (ObjectDisposedException) { }
                },
                TaskScheduler.Default);
        }

        public async Task SendTextAsync(string json, CancellationToken ct)
        {
            await _sendLock.WaitAsync(ct);
            try
            {
                if (Socket.State != WebSocketState.Open) return;
                await Socket.SendAsync(
                    Encoding.UTF8.GetBytes(json),
                    WebSocketMessageType.Text,
                    endOfMessage: true,
                    ct);
            }
            finally
            {
                _sendLock.Release();
            }
        }

        public async Task CloseOutputAsync(WebSocketCloseStatus status, string reason)
        {
            try
            {
                using var cts = new CancellationTokenSource(CloseGraceMs);
                await _sendLock.WaitAsync(cts.Token);
                try
                {
                    if (Socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
                    {
                        await Socket.CloseOutputAsync(status, reason, cts.Token);
                    }
                }
                finally
                {
                    _sendLock.Release();
                }
            }
            catch
            {
                // ignore
            }
        }

        public void Dispose()
        {
            Lifetime.Dispose();
            _sendLock.Dispose();
        }
    }
}

public static class RealtimeEndpointExtensions
{
    /// <summary>Maps <c>GET /api/ws</c> (the Discord <c>/.proxy</c> prefix is stripped by middleware in Program).</summary>
    public static IEndpointRouteBuilder MapRealtime(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/ws", (HttpContext ctx, RealtimeHub hub) => hub.HandleAsync(ctx))
            .WithName("RealtimeSocket")
            .ExcludeFromDescription();
        return app;
    }
}
