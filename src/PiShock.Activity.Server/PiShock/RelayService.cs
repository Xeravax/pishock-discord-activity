using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using PiShock.Activity.Server.Shared;

namespace PiShock.Activity.Server.PiShock;

public sealed record RelayCredentials(int UserId, string Token);

public sealed record RelayLoginStart(string Channel, string LoginUrl);

/// <summary>
/// PiShock web-login relay: opens a relay.pishock.com socket on a fresh channel, hands the user a
/// login.pishock.com URL for that channel, and resolves once the website pushes the credentials.
/// </summary>
public sealed class RelayService
{
    private sealed class PendingLogin
    {
        public required string Channel { get; init; }
        public required string LoginUrl { get; init; }
        public required long CreatedAt { get; init; }
        public TaskCompletionSource<RelayCredentials> Completion { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int _settled;

        public bool Settled => Volatile.Read(ref _settled) != 0;

        public void Resolve(RelayCredentials value)
        {
            if (Interlocked.Exchange(ref _settled, 1) != 0) return;
            Completion.TrySetResult(value);
        }

        public void Reject(Exception err)
        {
            if (Interlocked.Exchange(ref _settled, 1) != 0) return;
            Completion.TrySetException(err);
        }
    }

    private readonly ConcurrentDictionary<string, PendingLogin> _pendingByDiscordUser = new();
    private readonly object _startLock = new();

    public RelayService() { }

    /// <summary>Channel + login URL of the (possibly already settled) login for this Discord user, or null.</summary>
    public RelayLoginStart? GetPendingLogin(string discordUserId) =>
        _pendingByDiscordUser.TryGetValue(discordUserId, out var p)
            ? new RelayLoginStart(p.Channel, p.LoginUrl)
            : null;

    public async Task<RelayLoginStart> StartRelayLoginAsync(string discordUserId)
    {
        PendingLogin pending;
        var connected = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        lock (_startLock)
        {
            if (_pendingByDiscordUser.TryGetValue(discordUserId, out var existing) && !existing.Settled)
            {
                return new RelayLoginStart(existing.Channel, existing.LoginUrl);
            }

            var channel = Guid.NewGuid().ToString();
            pending = new PendingLogin
            {
                Channel = channel,
                LoginUrl = $"{Constants.PiShockLogin}?proto=socket&channel={channel}",
                CreatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            };
            // Avoid UnobservedTaskException noise when nobody awaits a failed login.
            _ = pending.Completion.Task.ContinueWith(
                static t => _ = t.Exception,
                CancellationToken.None,
                TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously,
                TaskScheduler.Default);
            _pendingByDiscordUser[discordUserId] = pending;
        }

        _ = Task.Run(() => RunRelayAsync(pending, connected));

        await connected.Task.ConfigureAwait(false);
        return new RelayLoginStart(pending.Channel, pending.LoginUrl);
    }

    public Task<RelayCredentials> AwaitRelayLoginAsync(string discordUserId)
    {
        if (!_pendingByDiscordUser.TryGetValue(discordUserId, out var pending))
        {
            throw new InvalidOperationException("No PiShock login in progress");
        }
        return pending.Completion.Task;
    }

    private static bool IsRelayConnectedMessage(string text) =>
        string.Equals(text.Trim(), "connected.", StringComparison.OrdinalIgnoreCase);

    private static async Task RunRelayAsync(PendingLogin pending, TaskCompletionSource connected)
    {
        using var timeoutCts = new CancellationTokenSource(Constants.RelayLoginTimeout);
        using var ws = new ClientWebSocket();
        var timedOut = false;

        try
        {
            await ws.ConnectAsync(new Uri($"{Constants.PiShockRelay}/{pending.Channel}"), timeoutCts.Token)
                .ConfigureAwait(false);

            var buffer = new byte[8192];
            while (ws.State == WebSocketState.Open)
            {
                var text = await ReceiveTextAsync(ws, buffer, timeoutCts.Token).ConfigureAwait(false);
                if (text is null) break; // close frame

                if (IsRelayConnectedMessage(text))
                {
                    connected.TrySetResult();
                    continue;
                }

                try
                {
                    using var doc = JsonDocument.Parse(text);
                    var root = doc.RootElement;
                    if (root.ValueKind == JsonValueKind.Object
                        && root.TryGetProperty("UserId", out var uid)
                        && uid.ValueKind == JsonValueKind.Number
                        && uid.TryGetInt32(out var userId)
                        && root.TryGetProperty("Token", out var tok)
                        && tok.ValueKind == JsonValueKind.String)
                    {
                        pending.Resolve(new RelayCredentials(userId, tok.GetString()!));
                        await CloseQuietlyAsync(ws).ConfigureAwait(false);
                        break;
                    }
                }
                catch (JsonException)
                {
                    // ignore non-json
                }
            }
        }
        catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested)
        {
            timedOut = true;
        }
        catch (Exception err)
        {
            pending.Reject(err);
            connected.TrySetException(err);
        }
        finally
        {
            if (timedOut) pending.Reject(new Exception("PiShock login timed out"));
            if (!pending.Settled)
            {
                pending.Reject(new Exception("PiShock relay closed before credentials arrived"));
            }
            connected.TrySetException(new Exception("Relay closed before connected."));
            if (ws.State is WebSocketState.Open or WebSocketState.CloseReceived)
            {
                await CloseQuietlyAsync(ws).ConfigureAwait(false);
            }
        }
    }

    /// <summary>Reads one full text message; returns null when the peer sent a close frame.</summary>
    private static async Task<string?> ReceiveTextAsync(ClientWebSocket ws, byte[] buffer, CancellationToken ct)
    {
        using var ms = new MemoryStream();
        while (true)
        {
            var result = await ws.ReceiveAsync(buffer, ct).ConfigureAwait(false);
            if (result.MessageType == WebSocketMessageType.Close) return null;
            ms.Write(buffer, 0, result.Count);
            if (result.EndOfMessage) break;
        }
        return Encoding.UTF8.GetString(ms.GetBuffer(), 0, (int)ms.Length);
    }

    private static async Task CloseQuietlyAsync(ClientWebSocket ws)
    {
        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            await ws.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "done", cts.Token).ConfigureAwait(false);
        }
        catch
        {
            // ignore
        }
    }
}
