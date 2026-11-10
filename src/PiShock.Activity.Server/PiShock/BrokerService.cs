using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using PiShock.Activity.Server.Shared;

namespace PiShock.Activity.Server.PiShock;

/// <summary>
/// Event pushed to broker subscribers. <see cref="Type"/> is "online", "log" or "status";
/// only the fields relevant to that type are populated.
/// </summary>
public sealed record BrokerEvent(string Type, long At)
{
    public string? ClientId { get; init; }
    public bool? Online { get; init; }
    public JsonElement? Payload { get; init; }
    public string? Message { get; init; }

    public static BrokerEvent OnlineEvent(string clientId, bool online, long at) =>
        new("online", at) { ClientId = clientId, Online = online };

    public static BrokerEvent LogEvent(string clientId, JsonElement payload, long at) =>
        new("log", at) { ClientId = clientId, Payload = payload };

    public static BrokerEvent StatusEvent(string message, long at) =>
        new("status", at) { Message = message };
}

public sealed record BrokerProbeResult(
    Dictionary<string, bool> Online,
    Dictionary<string, long> LastSeenAt);

/// <summary>Input for <see cref="BrokerService.PublishOperateAsync"/>.</summary>
public sealed class PublishOperateInput
{
    public required string ClientId { get; init; }
    public required int ShockerId { get; init; }
    public ShockerOp Operation { get; init; } = ShockerOp.Vibrate;
    public int Intensity { get; init; }
    public int DurationMs { get; init; }
    public bool Hold { get; init; }
    public bool Warning { get; init; }
    public string? ShareCode { get; init; }

    /// <summary>Emergency stop (wire mode "e"; intensity/duration forced to 0). Equivalent to TS <c>operation: 'e'</c>.</summary>
    public bool End { get; init; }

    public string? AgentName { get; init; }
}

/// <summary>
/// Per-Discord-user PiShock broker (wss://broker.pishock.com/v2) sessions: ping/log subscriptions with
/// online inference, plus one-shot PUBLISH for hold / warning / emergency stop.
/// </summary>
public sealed class BrokerService
{
    private const int IdleTeardownMs = 90_000;
    private const int ReconnectDelayMs = 3_000;
    private const int PublishTimeoutMs = 8_000;

    private static readonly Regex PrefixedNumericId =
        new(@"^c\d+$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly JsonElement EmptyObject = JsonDocument.Parse("{}").RootElement.Clone();

    private readonly ILogger<BrokerService> _logger;
    private readonly object _lock = new();
    private readonly Dictionary<string, BrokerSession> _sessions = new();

    public BrokerService(ILogger<BrokerService> logger)
    {
        _logger = logger;
    }

    // ───────────────────────── types ─────────────────────────

    private sealed class Subscription : IDisposable
    {
        private readonly Action _onDispose;
        private int _disposed;

        public Subscription(Action<BrokerEvent> callback, Action onDispose)
        {
            Callback = callback;
            _onDispose = onDispose;
        }

        public Action<BrokerEvent> Callback { get; }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
            _onDispose();
        }
    }

    private sealed class BrokerConnection
    {
        private readonly SemaphoreSlim _sendLock = new(1, 1);
        private readonly CancellationTokenSource _cts = new();

        public BrokerConnection()
        {
            Token = _cts.Token;
        }

        public ClientWebSocket Ws { get; } = new();
        public CancellationToken Token { get; }
        public bool IsOpen => Ws.State == WebSocketState.Open;

        public async Task SendAsync(string data)
        {
            if (!IsOpen) return;
            try
            {
                await _sendLock.WaitAsync(Token).ConfigureAwait(false);
                try
                {
                    if (!IsOpen) return;
                    var bytes = Encoding.UTF8.GetBytes(data);
                    await Ws.SendAsync(bytes, WebSocketMessageType.Text, true, Token).ConfigureAwait(false);
                }
                finally
                {
                    _sendLock.Release();
                }
            }
            catch
            {
                // ignore: close handler drives reconnect
            }
        }

        public void Abort()
        {
            try { _cts.Cancel(); } catch { /* ignore */ }
            try { Ws.Abort(); } catch { /* ignore */ }
        }

        public void Dispose()
        {
            try { _cts.Dispose(); } catch { /* ignore */ }
            try { Ws.Dispose(); } catch { /* ignore */ }
        }
    }

    private sealed class BrokerSession
    {
        public required PiShockCreds Creds { get; set; }
        public BrokerConnection? Conn { get; set; }
        public List<string> ClientIds { get; } = [];
        public List<Subscription> Subscribers { get; } = [];
        public Dictionary<string, bool> Online { get; } = new();
        public Dictionary<string, long> LastSeenAt { get; } = new();
        public Timer? ReconnectTimer { get; set; }
        public Timer? IdleTimer { get; set; }
        public bool Closed { get; set; }
    }

    // ───────────────────────── public API ─────────────────────────

    public IDisposable SubscribeBroker(
        string discordUserId,
        PiShockCreds creds,
        IEnumerable<string> clientIds,
        Action<BrokerEvent> subscriber)
    {
        List<string> added;
        BrokerConnection? openConn;
        List<BrokerEvent> replay;
        Subscription subscription = null!;

        lock (_lock)
        {
            if (!_sessions.TryGetValue(discordUserId, out var session))
            {
                session = new BrokerSession { Creds = creds };
                _sessions[discordUserId] = session;
            }
            else
            {
                session.Creds = creds;
            }
            ClearIdleTimerLocked(session);

            var captured = session;
            subscription = new Subscription(subscriber, () => RemoveSubscriber(discordUserId, subscription));
            captured.Subscribers.Add(subscription);

            added = AddClientIds(captured, clientIds);

            EnsureConnectedLocked(discordUserId, captured);
            openConn = captured.Conn is { IsOpen: true } c ? c : null;

            var now = NowMs();
            replay = captured.Online
                .Select(kv => BrokerEvent.OnlineEvent(kv.Key, kv.Value, now))
                .ToList();
        }

        if (added.Count > 0 && openConn is not null)
        {
            SubscribeTargets(openConn, added);
        }

        foreach (var evt in replay) subscriber(evt);

        return subscription;
    }

    /// <summary>
    /// Short-lived online probe for Discord Activity proxy (SSE gets 524).
    /// Keeps the broker socket warm and returns the current online map.
    /// </summary>
    public async Task<BrokerProbeResult> ProbeOnlineStatusAsync(
        string discordUserId,
        PiShockCreds creds,
        IEnumerable<string> clientIds,
        int waitMs = 2500,
        CancellationToken ct = default)
    {
        var ids = clientIds
            .Select(NormalizeClientId)
            .Where(id => id is not null)
            .Select(id => id!)
            .ToList();

        var ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var unsub = SubscribeBroker(discordUserId, creds, ids, evt =>
        {
            if (evt.Type == "online") ready.TrySetResult();
        });

        try
        {
            BrokerConnection? conn = null;
            List<string> targets = ids;
            lock (_lock)
            {
                if (_sessions.TryGetValue(discordUserId, out var session))
                {
                    if (session.Conn is { IsOpen: true } c) conn = c;
                    if (ids.Count == 0) targets = [.. session.ClientIds];
                }
            }

            if (conn is not null)
            {
                // Re-subscribe so hubs emit a fresh ping frame if they are alive
                SubscribeTargets(conn, targets);
                _ = conn.SendAsync(PingMessage);
            }

            var wait = Math.Max(0, Math.Min(8_000, waitMs));
            using var delayCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            await Task.WhenAny(ready.Task, Task.Delay(wait, delayCts.Token)).ConfigureAwait(false);
            delayCts.Cancel();
        }
        finally
        {
            unsub.Dispose();
        }

        var online = GetOnlineMap(discordUserId);
        var lastSeenAt = new Dictionary<string, long>();
        lock (_lock)
        {
            if (_sessions.TryGetValue(discordUserId, out var current))
            {
                foreach (var kv in current.LastSeenAt) lastSeenAt[kv.Key] = kv.Value;
            }
        }
        return new BrokerProbeResult(online, lastSeenAt);
    }

    public Dictionary<string, bool> GetOnlineMap(string discordUserId)
    {
        lock (_lock)
        {
            return _sessions.TryGetValue(discordUserId, out var session)
                ? new Dictionary<string, bool>(session.Online)
                : new Dictionary<string, bool>();
        }
    }

    /// <summary>
    /// Publish via broker (hold / warning / emergency stop).
    /// Matches pishock.com control page: owned devices use ty "ow", shares use "sc".
    /// Body i/d are numbers; emergency stop is m:"e", i:0, d:0.
    /// </summary>
    public Task<bool> PublishOperateAsync(
        PiShockCreds creds,
        PublishOperateInput input,
        CancellationToken ct = default)
    {
        var isEnd = input.End;
        var mode = isEnd
            ? "e"
            : input.Operation == ShockerOp.Shock
                ? "s"
                : input.Operation == ShockerOp.Vibrate
                    ? "v"
                    : "b";

        var hasShare = !string.IsNullOrEmpty(input.ShareCode);
        var target = hasShare
            ? $"c{input.ClientId}-sops-{input.ShareCode}"
            : $"c{input.ClientId}-ops";

        // Match pishock.com OperateV3 body shape exactly (numbers; owned ty "ow")
        var log = new JsonObject
        {
            ["u"] = creds.UserId,
            ["ty"] = hasShare ? "sc" : "ow",
        };
        if (input.Warning) log["w"] = true;
        if (!isEnd && input.Hold) log["h"] = true;
        log["o"] = !string.IsNullOrEmpty(input.AgentName)
            ? input.AgentName
            : isEnd
                ? "Emergency Stop"
                : Constants.AgentName;

        var body = new JsonObject
        {
            ["id"] = input.ShockerId,
            ["m"] = mode,
            ["i"] = isEnd ? 0 : input.Intensity,
            ["d"] = isEnd ? 0 : input.DurationMs,
            ["r"] = true,
            ["l"] = log,
        };

        var root = new JsonObject
        {
            ["Operation"] = "PUBLISH",
            ["PublishCommands"] = new JsonArray(new JsonObject
            {
                ["Target"] = target,
                ["Body"] = body,
            }),
        };

        return PublishPayloadAsync(creds, root.ToJsonString(), ct);
    }

    /// <summary>Close every PiShock broker socket so the process can exit on SIGTERM.</summary>
    public void CloseAll()
    {
        lock (_lock)
        {
            foreach (var id in _sessions.Keys.ToList()) TeardownLocked(id);
        }
    }

    /// <summary>Alias of <see cref="CloseAll"/> (TS: closeAllBrokerSessions).</summary>
    public void CloseAllBrokerSessions() => CloseAll();

    // ───────────────────────── internals ─────────────────────────

    private const string PingMessage = "{\"Operation\":\"PING\"}";

    private static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    private static string BrokerUrl(PiShockCreds creds) =>
        $"{Constants.PiShockBroker}?UserId={Uri.EscapeDataString(creds.UserId.ToString(System.Globalization.CultureInfo.InvariantCulture))}&Token={Uri.EscapeDataString(creds.Token)}";

    private void RemoveSubscriber(string discordUserId, Subscription subscription)
    {
        lock (_lock)
        {
            if (!_sessions.TryGetValue(discordUserId, out var current)) return;
            current.Subscribers.Remove(subscription);
            if (current.Subscribers.Count == 0) ScheduleIdleTeardownLocked(discordUserId, current);
        }
    }

    private static List<string> AddClientIds(BrokerSession session, IEnumerable<string> clientIds)
    {
        var added = new List<string>();
        foreach (var raw in clientIds)
        {
            var id = NormalizeClientId(raw);
            if (id is null) continue;
            if (!session.ClientIds.Contains(id))
            {
                session.ClientIds.Add(id);
                added.Add(id);
            }
        }
        return added;
    }

    private static void ClearIdleTimerLocked(BrokerSession session)
    {
        session.IdleTimer?.Dispose();
        session.IdleTimer = null;
    }

    private void ScheduleIdleTeardownLocked(string discordUserId, BrokerSession session)
    {
        ClearIdleTimerLocked(session);
        session.IdleTimer = new Timer(_ =>
        {
            lock (_lock)
            {
                if (_sessions.TryGetValue(discordUserId, out var current) && current.Subscribers.Count == 0)
                {
                    TeardownLocked(discordUserId);
                }
            }
        }, null, IdleTeardownMs, Timeout.Infinite);
    }

    private static string? NormalizeClientId(string? raw)
    {
        if (raw is null) return null;
        var id = raw.Trim();
        if (id.Length == 0) return null;
        // Publish channels use c{id}-ops; ping channels are usually {id}-ping.
        // Keep a bare numeric/string id as the canonical map key.
        if (PrefixedNumericId.IsMatch(id)) id = id[1..];
        return id;
    }

    private static string[] PingTargetsFor(string clientId)
    {
        var bare = NormalizeClientId(clientId) ?? clientId;
        return [$"{bare}-ping", $"{bare}-log", $"c{bare}-ping", $"c{bare}-log"];
    }

    private static void SubscribeTargets(BrokerConnection conn, IEnumerable<string> clientIds)
    {
        if (!conn.IsOpen) return;
        var targets = clientIds.SelectMany(PingTargetsFor).ToArray();
        if (targets.Length == 0) return;
        var msg = new JsonObject
        {
            ["Operation"] = "SUBSCRIBE",
            ["Targets"] = new JsonArray(targets.Select(t => (JsonNode?)JsonValue.Create(t)).ToArray()),
        };
        _ = conn.SendAsync(msg.ToJsonString());
    }

    private void EnsureConnected(string discordUserId)
    {
        lock (_lock)
        {
            if (_sessions.TryGetValue(discordUserId, out var session))
            {
                EnsureConnectedLocked(discordUserId, session);
            }
        }
    }

    private void EnsureConnectedLocked(string discordUserId, BrokerSession session)
    {
        if (session.Closed || session.Conn is not null) return;

        var conn = new BrokerConnection();
        session.Conn = conn;
        var creds = session.Creds;
        _ = Task.Run(() => RunConnectionAsync(discordUserId, session, conn, creds));
    }

    private async Task RunConnectionAsync(
        string discordUserId,
        BrokerSession session,
        BrokerConnection conn,
        PiShockCreds creds)
    {
        try
        {
            await conn.Ws.ConnectAsync(new Uri(BrokerUrl(creds)), conn.Token).ConfigureAwait(false);

            Broadcast(session, BrokerEvent.StatusEvent("broker connected", NowMs()));
            _ = conn.SendAsync(PingMessage);
            string[] ids;
            lock (_lock) ids = [.. session.ClientIds];
            SubscribeTargets(conn, ids);

            var buffer = new byte[16 * 1024];
            while (conn.IsOpen)
            {
                var text = await ReceiveTextAsync(conn.Ws, buffer, conn.Token).ConfigureAwait(false);
                if (text is null) break;
                HandleText(session, text);
            }
        }
        catch
        {
            // close handling below drives reconnect
        }
        finally
        {
            OnClosed(discordUserId, session, conn);
        }
    }

    private void OnClosed(string discordUserId, BrokerSession session, BrokerConnection conn)
    {
        lock (_lock)
        {
            if (ReferenceEquals(session.Conn, conn)) session.Conn = null;
        }
        conn.Dispose();

        Broadcast(session, BrokerEvent.StatusEvent("broker disconnected", NowMs()));

        lock (_lock)
        {
            if (session.Closed || session.Subscribers.Count == 0) return;
            if (!_sessions.TryGetValue(discordUserId, out var current) || !ReferenceEquals(current, session)) return;
            session.ReconnectTimer?.Dispose();
            session.ReconnectTimer = new Timer(
                _ => EnsureConnected(discordUserId),
                null,
                ReconnectDelayMs,
                Timeout.Infinite);
        }
    }

    private void TeardownLocked(string discordUserId)
    {
        if (!_sessions.Remove(discordUserId, out var session)) return;
        session.Closed = true;
        session.ReconnectTimer?.Dispose();
        session.ReconnectTimer = null;
        ClearIdleTimerLocked(session);
        session.Conn?.Abort();
    }

    private void Broadcast(BrokerSession session, BrokerEvent evt)
    {
        Subscription[] subs;
        lock (_lock) subs = [.. session.Subscribers];
        foreach (var sub in subs)
        {
            try
            {
                sub.Callback(evt);
            }
            catch
            {
                // ignore subscriber errors
            }
        }
    }

    private void BroadcastAll(BrokerSession session, List<BrokerEvent> events)
    {
        foreach (var evt in events) Broadcast(session, evt);
    }

    /// <summary>Reads one full message; returns null when the peer sent a close frame.</summary>
    private static async Task<string?> ReceiveTextAsync(ClientWebSocket ws, byte[] buffer, CancellationToken ct)
    {
        using var ms = new MemoryStream();
        while (true)
        {
            var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct).ConfigureAwait(false);
            if (result.MessageType == WebSocketMessageType.Close) return null;
            ms.Write(buffer, 0, result.Count);
            if (result.EndOfMessage) break;
        }
        return Encoding.UTF8.GetString(ms.GetBuffer(), 0, (int)ms.Length);
    }

    // ───────────────────────── message handling ─────────────────────────

    private void HandleText(BrokerSession session, string text)
    {
        List<BrokerEvent> events;
        try
        {
            using var doc = JsonDocument.Parse(text);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return;
            events = HandleBrokerMessage(session, doc.RootElement);
        }
        catch (JsonException)
        {
            return; // ignore
        }
        BroadcastAll(session, events);
    }

    private List<BrokerEvent> HandleBrokerMessage(BrokerSession session, JsonElement parsed)
    {
        var events = new List<BrokerEvent>();

        var message = GetString(parsed, "Message") ?? "";
        if (message.Contains("subscribed", StringComparison.OrdinalIgnoreCase))
        {
            // "{id}-ping subscribed to." proves the channel exists; wait for device ping for online.
            return events;
        }

        var topic = FirstNonEmptyString(parsed, "Topic", "topic", "Target", "channel");

        JsonElement payload;
        var rawBody = FirstNonNull(parsed, "Body", "Payload", "data");
        string rawBodyString = "";
        if (rawBody is { ValueKind: JsonValueKind.String } rawStr)
        {
            rawBodyString = rawStr.GetString() ?? "";
            try
            {
                using var bodyDoc = JsonDocument.Parse(rawBodyString);
                payload = bodyDoc.RootElement.ValueKind == JsonValueKind.Object
                    ? bodyDoc.RootElement.Clone()
                    : EmptyObject;
            }
            catch (JsonException)
            {
                payload = JsonSerializer.SerializeToElement(new Dictionary<string, string> { ["raw"] = rawBodyString });
            }
        }
        else if (rawBody is { ValueKind: JsonValueKind.Object } rawObj)
        {
            payload = rawObj;
        }
        else if (IsFalsy(rawBody))
        {
            payload = parsed;
        }
        else
        {
            payload = EmptyObject;
        }

        var haystack = $"{topic} {message} {rawBodyString}".ToLowerInvariant();

        lock (_lock)
        {
            foreach (var clientId in session.ClientIds)
            {
                var bare = NormalizeClientId(clientId) ?? clientId;
                var pingHit =
                    topic == $"{bare}-ping"
                    || topic == $"c{bare}-ping"
                    || topic.EndsWith($"{bare}-ping", StringComparison.Ordinal)
                    || haystack.Contains($"{bare}-ping", StringComparison.Ordinal)
                    || LooksLikePing(payload, bare);
                if (pingHit)
                {
                    var online = InferOnline(payload);
                    var now = NowMs();
                    session.Online[bare] = online;
                    session.LastSeenAt[bare] = now;
                    events.Add(BrokerEvent.OnlineEvent(bare, online, now));
                    return events;
                }

                if (topic == $"{bare}-log"
                    || topic == $"c{bare}-log"
                    || topic.EndsWith($"{bare}-log", StringComparison.Ordinal)
                    || haystack.Contains($"{bare}-log", StringComparison.Ordinal))
                {
                    // Any log traffic implies the hub is reachable
                    var now = NowMs();
                    session.Online[bare] = true;
                    session.LastSeenAt[bare] = now;
                    events.Add(BrokerEvent.OnlineEvent(bare, true, now));
                    events.Add(BrokerEvent.LogEvent(bare, parsed.Clone(), now));
                    return events;
                }
            }

            // Fallback: nested arrays from older broker frames
            if (parsed.TryGetProperty("Payload", out var arr) && arr.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in arr.EnumerateArray())
                {
                    if (item.ValueKind != JsonValueKind.String) continue;
                    var s = item.GetString() ?? "";
                    foreach (var clientId in session.ClientIds)
                    {
                        var bare = NormalizeClientId(clientId) ?? clientId;
                        if (s.Contains($"{bare}-ping", StringComparison.Ordinal))
                        {
                            var now = NowMs();
                            session.Online[bare] = true;
                            session.LastSeenAt[bare] = now;
                            events.Add(BrokerEvent.OnlineEvent(bare, true, now));
                        }
                    }
                }
            }
        }

        return events;
    }

    private static bool LooksLikePing(JsonElement payload, string clientId)
    {
        var id = FirstNonNull(payload, "clientId", "c", "ClientId", "hubId", "HubId");
        if (id is null)
        {
            return Has(payload, "online") || Has(payload, "p") || Has(payload, "Connected");
        }
        return NormalizeClientId(JsToString(id.Value)) == clientId;
    }

    private static bool InferOnline(JsonElement payload)
    {
        if (payload.TryGetProperty("online", out var online)) return Truthy(online);
        if (payload.TryGetProperty("p", out var p)) return Truthy(p);
        if (payload.TryGetProperty("Connected", out var connected)) return Truthy(connected);
        if (payload.TryGetProperty("Offline", out var offline)) return !Truthy(offline);
        // Receiving a ping frame from the device channel means it is online
        return true;
    }

    // ───────────────────────── JSON helpers (JS semantics) ─────────────────────────

    private static bool Has(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out _);

    private static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var v)
        && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    private static string FirstNonEmptyString(JsonElement obj, params string[] names)
    {
        foreach (var n in names)
        {
            var s = GetString(obj, n);
            if (!string.IsNullOrEmpty(s)) return s;
        }
        return "";
    }

    /// <summary>JS <c>a ?? b ?? c</c> over object properties (null / missing are skipped).</summary>
    private static JsonElement? FirstNonNull(JsonElement obj, params string[] names)
    {
        if (obj.ValueKind != JsonValueKind.Object) return null;
        foreach (var n in names)
        {
            if (obj.TryGetProperty(n, out var v) && v.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined))
            {
                return v;
            }
        }
        return null;
    }

    private static bool IsFalsy(JsonElement? v) =>
        v is null || !Truthy(v.Value);

    private static bool Truthy(JsonElement v) => v.ValueKind switch
    {
        JsonValueKind.True => true,
        JsonValueKind.Number => !(v.TryGetDouble(out var d) && d == 0),
        JsonValueKind.String => (v.GetString() ?? "").Length > 0,
        JsonValueKind.Object or JsonValueKind.Array => true,
        _ => false,
    };

    private static string JsToString(JsonElement v) => v.ValueKind switch
    {
        JsonValueKind.String => v.GetString() ?? "",
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        JsonValueKind.Object => "[object Object]",
        _ => v.GetRawText(),
    };

    // ───────────────────────── publish ─────────────────────────

    private static bool IsPublishSuccess(string text)
    {
        var lower = text.ToLowerInvariant();
        if (lower.Contains("publish successful") || lower.Contains("publish success")) return true;
        try
        {
            using var doc = JsonDocument.Parse(text);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return false;

            if (root.TryGetProperty("IsError", out var isError)
                && isError.ValueKind == JsonValueKind.False
                && GetString(root, "Message") is { } msg)
            {
                var m = msg.ToLowerInvariant();
                if (m.Contains("publish successful") || m.Contains("publish success")) return true;
            }

            if (GetString(root, "Command") == "PUBLISH"
                && root.TryGetProperty("Payload", out var payload)
                && payload.ValueKind == JsonValueKind.Array)
            {
                foreach (var p in payload.EnumerateArray())
                {
                    if (JsToString(p).ToLowerInvariant().Contains("publish success")) return true;
                }
            }
        }
        catch (JsonException)
        {
            // not JSON
        }
        return false;
    }

    private static bool IsPublishError(string text)
    {
        try
        {
            using var doc = JsonDocument.Parse(text);
            return doc.RootElement.ValueKind == JsonValueKind.Object
                && doc.RootElement.TryGetProperty("IsError", out var e)
                && e.ValueKind == JsonValueKind.True;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private async Task<bool> PublishPayloadAsync(PiShockCreds creds, string payload, CancellationToken ct)
    {
        using var ws = new ClientWebSocket();
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(PublishTimeoutMs);

        try
        {
            await ws.ConnectAsync(new Uri(BrokerUrl(creds)), cts.Token).ConfigureAwait(false);
            await ws.SendAsync(Encoding.UTF8.GetBytes(payload), WebSocketMessageType.Text, true, cts.Token)
                .ConfigureAwait(false);

            var buffer = new byte[16 * 1024];
            while (ws.State == WebSocketState.Open)
            {
                var text = await ReceiveTextAsync(ws, buffer, cts.Token).ConfigureAwait(false);
                if (text is null) return false;

                if (IsPublishSuccess(text)) return true;
                if (IsPublishError(text))
                {
                    _logger.LogWarning("[broker] publish error {Body}", text.Length > 300 ? text[..300] : text);
                    return false;
                }
            }
            return false;
        }
        catch (OperationCanceledException)
        {
            return false;
        }
        catch (Exception err)
        {
            _logger.LogWarning("[broker] publish socket error {Message}", err.Message);
            return false;
        }
        finally
        {
            if (ws.State == WebSocketState.Open)
            {
                try
                {
                    using var closeCts = new CancellationTokenSource(TimeSpan.FromSeconds(1));
                    await ws.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "done", closeCts.Token)
                        .ConfigureAwait(false);
                }
                catch
                {
                    // ignore
                }
            }
        }
    }
}
