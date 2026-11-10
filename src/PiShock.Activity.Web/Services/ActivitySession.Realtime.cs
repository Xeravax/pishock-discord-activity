using System.Text.Json;
using PiShock.Activity.Web.Models;

namespace PiShock.Activity.Web.Services;

public sealed partial class ActivitySession
{
    /// <summary>Connect the WebSocket (after auth + consent) and subscribe to Discord participant updates.</summary>
    private async Task StartRealtimeAsync()
    {
        if (!Embedded || Token is null || Me?.Consent != true) return;

        if (!_participantsSubscribed)
        {
            _participantsSubscribed = true;
            try
            {
                _self ??= Microsoft.JSInterop.DotNetObjectReference.Create(this);
                await _discord.SubscribeParticipantsAsync(_self);
            }
            catch
            {
                // older SDK / unsupported
            }
        }

        if (!_realtimeStarted)
        {
            _realtimeStarted = true;
            await _socket.ConnectAsync(Token);
        }
    }

    /// <summary>Handle a decoded WS frame (port of App.tsx handleEvent).</summary>
    private void HandleRealtime(JsonElement ev)
    {
        var type = Json.Str(ev, "type");
        switch (type)
        {
            case "ping":
            case "hello_ok":
                return;

            case "server_shutting_down":
                _health.MarkServerShuttingDown();
                return;

            case "emergency_stop":
                ApplyEmergencyStop(ev);
                Notify();
                return;

            case "incoming_command":
                HandleIncomingCommand(ev);
                return;

            case "activity_share_changed":
            case "participants_invalidate":
                InvalidateStatusCache();
                if (Token is not null)
                {
                    _ = SafeNotify(() => RefreshParticipantStatusAsync(Participants, true));
                    if (type == "activity_share_changed" && Me?.User?.Id == Json.Str(ev, "ownerDiscordUserId"))
                    {
                        _ = SafeNotify(async () => { await RefreshMeAsync(); });
                    }
                }
                return;
        }
    }

    private async Task SafeNotify(Func<Task> action)
    {
        try { await action(); } catch { /* best-effort */ }
        Notify();
    }

    private void HandleIncomingCommand(JsonElement ev)
    {
        var selfId = Me?.User?.Id;
        if (string.IsNullOrEmpty(selfId) || Json.Str(ev, "targetDiscordUserId") != selfId) return;

        var executorId = Json.Str(ev, "executorDiscordUserId") ?? "";
        var fromRoster = Participants.FirstOrDefault(p => p.Id == executorId);
        var display = FirstNonEmpty(
            fromRoster?.DisplayName,
            Json.Str(ev, "executorGlobalName"),
            Json.Str(ev, "executorUsername")) ?? "Someone";

        LastIncoming = new IncomingShockHit
        {
            ExecutorDiscordUserId = executorId,
            DisplayName = display,
            AvatarUrl = FirstNonEmpty(fromRoster?.AvatarUrl)
                ?? ParticipantUtil.AvatarUrl(executorId, Json.Str(ev, "executorAvatar")),
            Action = Json.Str(ev, "action") ?? "",
            Intensity = Json.Num(ev, "intensity") is { } i ? (int)i : null,
            DurationMs = Json.Num(ev, "durationMs") is { } d ? (int)d : null,
            At = Json.Num(ev, "at") is { } at ? (long)at : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            Success = Json.Bool(ev, "success") ?? false,
            Kind = "personal",
            TargetDiscordUserId = selfId,
        };
        Notify();
        if (Token is not null) _ = SafeNotify(RefreshLogsAsync);
    }

    private void ApplyEmergencyStop(JsonElement ev)
    {
        var owner = Json.Str(ev, "ownerDiscordUserId") ?? "";
        var ids = Json.Items(ev, "emergencyStopShockerIds").Select(e => (int)e.GetDouble()).ToArray();

        if (Me is not null && Me.User?.Id == owner)
        {
            Me.EmergencyStopShockerIds = ids;
        }

        var stopped = ids.ToHashSet();
        void Apply(Dictionary<string, ParticipantStatus> map)
        {
            if (!map.TryGetValue(owner, out var row)) return;
            foreach (var s in row.Shockers) s.EmergencyStop = stopped.Contains(s.ShockerId);
            row.EmergencyStop = row.Shockers.Count > 0 && row.Shockers.All(s => s.EmergencyStop);
        }

        // Mutates in place so the TTL cache stays consistent (soft refresh must not overwrite the latch).
        Apply(ParticipantStatuses);
        if (!ReferenceEquals(ParticipantStatuses, _statusCacheMap)) Apply(_statusCacheMap);
    }
}
