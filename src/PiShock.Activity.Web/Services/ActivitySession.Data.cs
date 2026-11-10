using System.Text.Json;
using PiShock.Activity.Web.Models;

namespace PiShock.Activity.Web.Services;

public sealed partial class ActivitySession
{
    private static readonly TimeSpan ParticipantStatusTtl = TimeSpan.FromMinutes(3);

    private string _statusCacheKey = "";
    private DateTime _statusCacheAt = DateTime.MinValue;
    private Dictionary<string, ParticipantStatus> _statusCacheMap = [];
    private bool _onlinePollRunning;

    // ======================================================================
    // Refreshers
    // ======================================================================

    public async Task<MeResponse> RefreshMeAsync()
    {
        var me = await _api.GetMeAsync();
        Me = me;
        Notify();
        return me;
    }

    public async Task RefreshDevicesAsync()
    {
        var root = await _api.GetDevicesAsync();
        var data = new DevicesData();
        data.Hubs.AddRange(Json.Items(root, "hubs"));
        data.Shockers.AddRange(Json.Items(root, "shockers"));
        data.Shared.AddRange(Json.FlattenList(root, "shared"));
        data.Links.AddRange(Json.Items(root, "links"));
        if (Json.TryGet(root, out var online, "online") && online.ValueKind == JsonValueKind.Object)
        {
            foreach (var p in online.EnumerateObject())
            {
                var key = NormalizeClientKey(p.Name);
                if (key is not null) data.Online[key] = p.Value.ValueKind == JsonValueKind.True;
            }
        }

        Devices = data;
        foreach (var (k, v) in data.Online) Online[k] = v;
        Notify();
        EnsureOnlinePoll();
    }

    public async Task RefreshLogsAsync()
    {
        if (Token is null) return;
        var root = await _api.GetLogsAsync(200);
        JsonElement rows = default;
        if (Json.TryGet(root, out var pub, "public")) rows = pub;
        PublicLogs = LogNormalizer.NormalizePublic(rows);
        Logs = LogNormalizer.NormalizeRows(rows);
        HydrateLastIncoming();
        Notify();
    }

    public async Task RefreshParticipantsAsync(bool forceStatus)
    {
        var raw = await _discord.GetParticipantsAsync();
        Participants = ParticipantUtil.NormalizeList(raw);
        Notify();
        try
        {
            await RefreshParticipantStatusAsync(Participants, forceStatus);
        }
        catch (Exception ex)
        {
            ActionError = ex.Message;
        }
        Notify();
    }

    public async Task RefreshParticipantStatusAsync(List<DiscordParticipant> roster, bool force)
    {
        var instanceId = await _discord.GetInstanceIdAsync();
        if (string.IsNullOrEmpty(instanceId) || roster.Count == 0)
        {
            ParticipantStatuses = [];
            return;
        }

        var idsKey = string.Join(',', roster.Select(p => p.Id).OrderBy(x => x, StringComparer.Ordinal));
        var now = DateTime.UtcNow;
        if (!force && _statusCacheKey == idsKey && now - _statusCacheAt < ParticipantStatusTtl)
        {
            ParticipantStatuses = _statusCacheMap;
            return;
        }

        var rows = await _api.GetParticipantStatusAsync(instanceId, roster.Select(p => p.Id));
        var map = rows.ToDictionary(r => r.DiscordUserId, r => r);
        _statusCacheKey = idsKey;
        _statusCacheAt = now;
        _statusCacheMap = map;
        ParticipantStatuses = map;
        Notify();
    }

    private void InvalidateStatusCache()
    {
        _statusCacheKey = "";
        _statusCacheAt = DateTime.MinValue;
        _statusCacheMap = [];
    }

    // ======================================================================
    // Hub online status polling (App.tsx effect)
    // ======================================================================

    private void EnsureOnlinePoll()
    {
        if (_onlinePollRunning || Token is null || Me?.PishockLinked != true) return;
        _onlinePollRunning = true;
        _ = OnlinePollLoopAsync();
    }

    private async Task OnlinePollLoopAsync()
    {
        try
        {
            var waitMs = 2800;
            while (!_lifetime.IsCancellationRequested && Token is not null && Me?.PishockLinked == true && Devices is not null)
            {
                var ids = CollectClientIds(Devices);
                if (ids.Count > 0)
                {
                    try { await RefreshOnlineStatusAsync(ids, waitMs); } catch { /* transient */ }
                }
                waitMs = 1200;
                await Task.Delay(8000, _lifetime.Token);
            }
        }
        catch (TaskCanceledException)
        {
            // disposed
        }
        finally
        {
            _onlinePollRunning = false;
        }
    }

    private async Task RefreshOnlineStatusAsync(List<string> clientIds, int waitMs)
    {
        if (clientIds.Count == 0) return;
        var root = await _api.GetBrokerStatusAsync(clientIds, waitMs);
        var next = new Dictionary<string, bool>();
        if (Json.TryGet(root, out var online, "online") && online.ValueKind == JsonValueKind.Object)
        {
            foreach (var p in online.EnumerateObject())
            {
                var key = NormalizeClientKey(p.Name);
                if (key is not null) next[key] = p.Value.ValueKind == JsonValueKind.True;
            }
        }

        var merged = new Dictionary<string, bool>(Online);
        foreach (var (k, v) in next) merged[k] = v;
        // After a full probe, unknown hubs leave "Checking…" and become Offline
        if (waitMs >= 2500)
        {
            foreach (var id in clientIds)
            {
                var key = NormalizeClientKey(id);
                if (key is not null && !next.ContainsKey(key)) merged[key] = false;
            }
        }
        Online = merged;
        Notify();
    }

    public async Task PingHubAsync()
    {
        if (Token is null || Me?.PishockLinked != true || FriendsMode) return;
        Pinging = true;
        ActionError = null;
        Notify();
        try
        {
            var ids = Devices is null ? [] : CollectClientIds(Devices);
            var focus = SelectedHubId is null ? ids : new[] { SelectedHubId }.Concat(ids).Distinct().ToList();
            await RefreshOnlineStatusAsync(focus, 3500);
        }
        catch (Exception ex)
        {
            ActionError = ex.Message;
        }
        finally
        {
            Pinging = false;
            Notify();
        }
    }

    // ======================================================================
    // Normalization helpers (App.tsx module-level functions)
    // ======================================================================

    public static string? NormalizeClientKey(string? raw)
    {
        if (raw is null) return null;
        var id = raw.Trim();
        if (id.Length == 0) return null;
        if (id.Length > 1 && (id[0] == 'c' || id[0] == 'C') && id.Skip(1).All(char.IsDigit)) id = id[1..];
        return id;
    }

    private static string? HubClientId(JsonElement row) =>
        NormalizeClientKey(Json.Str(row, "ClientId", "clientId", "HubId", "hubId", "Id", "id"));

    private static string? ShockerClientId(JsonElement row) =>
        NormalizeClientKey(Json.Str(row, "ClientId", "clientId", "HubId", "hubId"));

    /// <summary>Official API MaxDuration is seconds; operate path expects ms.</summary>
    private static int MaxDurationMs(JsonElement row)
    {
        var raw = Json.Num(row, "MaxDuration", "maxDuration") ?? 15;
        if (double.IsNaN(raw) || raw <= 0) return 15_000;
        return raw <= 60 ? (int)Math.Round(raw * 1000) : (int)Math.Round(raw);
    }

    private static List<string> CollectClientIds(DevicesData devices)
    {
        var ids = new HashSet<string>();
        foreach (var h in devices.Hubs) if (HubClientId(h) is { } id) ids.Add(id);
        foreach (var s in devices.Shockers) if (ShockerClientId(s) is { } id) ids.Add(id);
        foreach (var s in devices.Shared) if (ShockerClientId(s) is { } id) ids.Add(id);
        return ids.ToList();
    }

    // ======================================================================
    // Derived views
    // ======================================================================

    public PersonalLimits PersonalLimits => Me?.Personal ?? new PersonalLimits();

    public HashSet<int> EmergencyStopIds => new(Me?.EmergencyStopShockerIds ?? []);

    private List<ShockerView> NormalizeShockers()
    {
        var devices = Devices;
        if (devices is null) return [];
        var personal = PersonalLimits;
        var stopped = EmergencyStopIds;

        var hubNameByClient = new Dictionary<string, string>();
        foreach (var hub in devices.Hubs)
        {
            var id = HubClientId(hub);
            if (id is not null) hubNameByClient[id] = Json.Str(hub, "Name", "name") ?? "Hub";
        }
        var fallbackHubId = hubNameByClient.Keys.FirstOrDefault();

        var owned = devices.Shockers.Select(s =>
        {
            var id = (int)(Json.Num(s, "ShockerId", "shockerId", "Id", "id") ?? 0);
            var clientKey = ShockerClientId(s) ?? fallbackHubId ?? "";
            var deviceMaxIntensity = Math.Max(1, Math.Min(100, (int)(Json.Num(s, "MaxIntensity", "maxIntensity") ?? 100)));
            var deviceMaxDuration = MaxDurationMs(s);
            var activityMaxIntensity = Math.Min(deviceMaxIntensity, personal.ActivityMaxIntensity);
            var activityMaxDuration = Math.Min(deviceMaxDuration, personal.ActivityMaxDurationMs);
            var view = new ShockerView
            {
                Id = id,
                Name = Json.Str(s, "Name", "name") ?? $"Shocker {id}",
                HubName = clientKey.Length > 0 && hubNameByClient.TryGetValue(clientKey, out var hn) ? hn : null,
                ClientId = clientKey.Length > 0 ? clientKey : null,
                Owned = true,
                Paused = Json.Bool(s, "Paused", "paused") ?? false,
                CanShock = true,
                CanVibrate = true,
                CanBeep = true,
                CanHold = true,
                CanPause = Json.Bool(s, "CanPause", "canPause") ?? false,
                DeviceMaxIntensity = deviceMaxIntensity,
                DeviceMaxDuration = deviceMaxDuration,
                ActivityMaxIntensity = activityMaxIntensity,
                ActivityMaxDuration = activityMaxDuration,
                MaxIntensity = activityMaxIntensity,
                MaxDuration = activityMaxDuration,
                EmergencyStop = stopped.Contains(id),
                IsV3 = Json.Bool(s, "IsV3", "isV3") ?? true,
                Online = clientKey.Length > 0 ? Online.TryGetValue(clientKey, out var on) && on : null,
            };
            if (DiscordShareLimits.TryGetValue(id, out var share))
            {
                view.DiscordShareEnabled = share.Enabled;
                view.DiscordShareMaxIntensity = share.MaxIntensity;
                view.DiscordShareMaxDuration = share.MaxDurationMs;
            }
            return view;
        }).ToList();

        var shared = devices.Shared.Select(s =>
        {
            var id = (int)(Json.Num(s, "Id", "id", "ShockerId", "shockerId") ?? 0);
            var clientKey = ShockerClientId(s) ?? "";
            var deviceMaxIntensity = Math.Max(1, Math.Min(100, (int)(Json.Num(s, "MaxIntensity", "maxIntensity") ?? 100)));
            var deviceMaxDuration = MaxDurationMs(s);
            return new ShockerView
            {
                Id = id,
                Name = Json.Str(s, "Name", "name") ?? $"Shared {id}",
                HubName = Json.Str(s, "OwnedBy", "ownedBy") ?? "",
                ClientId = clientKey.Length > 0 ? clientKey : null,
                Owned = false,
                Paused = Json.Bool(s, "Paused", "paused", "SharePaused", "sharePaused") ?? false,
                ShareCode = Json.Str(s, "ShareCode", "shareCode"),
                ShareId = Json.Num(s, "ShareId", "shareId") is { } sid ? (int)sid : null,
                CanShock = Json.Bool(s, "CanShock", "canShock") ?? true,
                CanVibrate = Json.Bool(s, "CanVibrate", "canVibrate") ?? true,
                CanBeep = Json.Bool(s, "CanBeep", "canBeep") ?? true,
                CanHold = Json.Bool(s, "CanHold", "canHold") ?? true,
                CanPause = Json.Bool(s, "CanPause", "canPause") ?? false,
                DeviceMaxIntensity = deviceMaxIntensity,
                DeviceMaxDuration = deviceMaxDuration,
                ActivityMaxIntensity = deviceMaxIntensity,
                ActivityMaxDuration = deviceMaxDuration,
                MaxIntensity = deviceMaxIntensity,
                MaxDuration = deviceMaxDuration,
                IsV3 = Json.Bool(s, "IsV3", "isV3") ?? true,
                Online = clientKey.Length > 0 ? Online.TryGetValue(clientKey, out var on) && on : null,
            };
        }).ToList();

        owned.AddRange(shared);
        return owned;
    }

    public List<ShockerView> OwnedAndShared => NormalizeShockers();

    public List<ShockerView> OwnedShockers => OwnedAndShared.Where(s => s.Owned).ToList();

    public List<HubInfo> HubOptions
    {
        get
        {
            var all = OwnedAndShared;
            var hubs = Devices?.Hubs ?? [];
            if (hubs.Count == 0)
            {
                var fallbackOnline = all.Any(s => s.Online == true);
                return
                [
                    new HubInfo
                    {
                        Id = all.Count > 0 && all[0].ClientId is { } cid ? NormalizeClientKey(cid) ?? "0" : "0",
                        Name = "PiShock",
                        Online = fallbackOnline,
                        LastSeen = fallbackOnline ? "Seen a few seconds ago" : "Checking…",
                    },
                ];
            }

            return hubs.Select(h =>
            {
                var id = HubClientId(h) ?? "0";
                var name = Json.Str(h, "Name", "name") ?? "Hub";
                bool? known = Online.TryGetValue(id, out var k) ? k : null;
                var fromShockers = all.Any(s => NormalizeClientKey(s.ClientId) == id && s.Online == true);
                var isOnline = known == true || fromShockers;
                return new HubInfo
                {
                    Id = id,
                    Name = name,
                    Online = isOnline,
                    LastSeen = isOnline ? "Seen a few seconds ago" : known == false ? "Offline" : "Checking…",
                };
            }).ToList();
        }
    }

    public List<ShockerView> FriendShockers
    {
        get
        {
            var rows = new List<ShockerView>();
            foreach (var targetId in SelectedTargetIds)
            {
                if (!ParticipantStatuses.TryGetValue(targetId, out var status) || status.BannedYou) continue;
                var participant = Participants.FirstOrDefault(p => p.Id == targetId);
                if (status.Shockers.Count == 0) continue;
                foreach (var s in status.Shockers)
                {
                    var deviceMaxIntensity = Math.Min(100, s.DeviceMaxIntensity);
                    var deviceMaxDuration = Math.Min(15_000, s.DeviceMaxDurationMs);
                    var activityMaxIntensity = Math.Min(deviceMaxIntensity, s.MaxIntensity);
                    var activityMaxDuration = Math.Min(deviceMaxDuration, s.MaxDurationMs);
                    var stopped = s.EmergencyStop;
                    rows.Add(new ShockerView
                    {
                        Id = s.ShockerId,
                        Name = s.ShockerName,
                        HubName = participant?.DisplayName ?? status.GlobalName ?? status.Username ?? "Friend",
                        ClientId = s.HubClientId,
                        Owned = false,
                        TargetDiscordUserId = targetId,
                        Paused = s.Paused,
                        CanShock = !stopped && s.CanShock,
                        CanVibrate = !stopped && s.CanVibrate,
                        CanBeep = !stopped && s.CanBeep,
                        CanHold = !stopped && s.CanHold,
                        CanPause = false,
                        DeviceMaxIntensity = deviceMaxIntensity,
                        DeviceMaxDuration = deviceMaxDuration,
                        ActivityMaxIntensity = activityMaxIntensity,
                        ActivityMaxDuration = activityMaxDuration,
                        MaxIntensity = activityMaxIntensity,
                        MaxDuration = activityMaxDuration,
                        EmergencyStop = stopped,
                        IsV3 = true,
                        Online = true,
                    });
                }
            }
            return rows;
        }
    }

    public List<ShockerView> OwnShockers
    {
        get
        {
            var all = OwnedAndShared;
            if (SelectedHubId is null) return all;
            var filtered = all.Where(s => s.ClientId is null || NormalizeClientKey(s.ClientId) == SelectedHubId).ToList();
            return filtered.Count > 0 ? filtered : all;
        }
    }

    public List<ShockerView> Shockers => FriendsMode ? FriendShockers : OwnShockers;

    public bool FriendBlocked =>
        FriendsMode && SelectedTargetIds.Count > 0 &&
        SelectedTargetIds.All(id => ParticipantStatuses.TryGetValue(id, out var s) && s.BannedYou);

    public bool FriendEStop
    {
        get
        {
            if (!FriendsMode || SelectedTargetIds.Count == 0 || FriendBlocked) return false;
            var status = SelectedTargetId is not null && ParticipantStatuses.TryGetValue(SelectedTargetId, out var s) ? s : null;
            return status?.EmergencyStop == true || FriendShockers.Any(x => x.EmergencyStop);
        }
    }

    public HubInfo PrimaryHub
    {
        get
        {
            if (FriendsMode)
            {
                var target = Participants.FirstOrDefault(p => p.Id == SelectedTargetId);
                var friendShockers = FriendShockers;
                return new HubInfo
                {
                    Id = SelectedTargetId ?? "friends",
                    Name = target?.DisplayName ?? "Discord Shockers",
                    Online = friendShockers.Count > 0 && !FriendBlocked,
                    LastSeen = FriendBlocked ? "You are blocked"
                        : FriendEStop ? "Emergency stop armed"
                        : friendShockers.Count > 0 ? "Activity share"
                        : SelectedTargetId is not null ? "No shockers shared"
                        : "Select a participant",
                };
            }

            if (Me?.PishockLinked != true)
            {
                return new HubInfo
                {
                    Id = "link",
                    Name = "Link PiShock",
                    Online = false,
                    LastSeen = "Needed for your devices · Discord Shockers work without linking",
                };
            }

            var options = HubOptions;
            var selected = options.FirstOrDefault(h => h.Id == SelectedHubId) ?? options.FirstOrDefault();
            if (selected is not null) return selected;
            var own = OwnShockers;
            var anyOnline = own.Any(s => s.Online == true);
            return new HubInfo
            {
                Id = "0",
                Name = "PiShock",
                Online = anyOnline,
                LastSeen = anyOnline ? "Seen a few seconds ago" : "Checking…",
            };
        }
    }

    /// <summary>PIP surface: linked users see hits on themselves; unlinked users see the latest log shock + target.</summary>
    public IncomingShockHit? PipHit
    {
        get
        {
            if (Me?.PishockLinked == true) return LastIncoming;
            var entry = PublicLogs.FirstOrDefault(e => e.Action == "shock")
                ?? PublicLogs.FirstOrDefault(e => e.Action is "vibrate" or "beep");
            if (entry is null) return null;
            return new IncomingShockHit
            {
                ExecutorDiscordUserId = entry.From.Id,
                DisplayName = entry.From.DisplayName,
                AvatarUrl = entry.From.AvatarUrl,
                Action = entry.Action,
                Intensity = entry.Intensity,
                DurationMs = entry.DurationSec is { } sec ? Math.Max(16, (int)Math.Round(sec * 1000)) : null,
                At = entry.At,
                Success = true,
                Kind = "activity",
                TargetDiscordUserId = entry.To.Id,
                TargetDisplayName = entry.To.DisplayName,
                TargetAvatarUrl = entry.To.AvatarUrl,
            };
        }
    }

    /// <summary>Hydrate / refresh PIP "last hit on you" from activity logs.</summary>
    private void HydrateLastIncoming()
    {
        var selfId = Me?.User?.Id;
        if (string.IsNullOrEmpty(selfId)) return;

        var row = Logs.FirstOrDefault(entry =>
        {
            if (entry.TargetId != selfId) return false;
            var action = entry.Action.ToLowerInvariant();
            return !(action is "end" or "stop" or "participant_end" || action.EndsWith("_end"));
        });
        if (row is null) return;
        if (LastIncoming is not null && LastIncoming.At >= row.At) return;
        var executorId = row.ExecutorId ?? "";
        if (executorId.Length == 0) return;

        var fromRoster = Participants.FirstOrDefault(p => p.Id == executorId);
        ParticipantStatuses.TryGetValue(executorId, out var status);
        var fromPublic = PublicLogs.FirstOrDefault(e => e.Id == row.Id);
        LastIncoming = new IncomingShockHit
        {
            ExecutorDiscordUserId = executorId,
            DisplayName = FirstNonEmpty(
                fromPublic?.From.DisplayName, row.ExecutorDisplayName, fromRoster?.DisplayName,
                status?.GlobalName, status?.Username) ?? "Someone",
            AvatarUrl = FirstNonEmpty(fromPublic?.From.AvatarUrl, fromRoster?.AvatarUrl)
                ?? ParticipantUtil.AvatarUrl(executorId, row.ExecutorAvatar ?? status?.Avatar),
            Action = row.Action,
            Intensity = row.Intensity,
            DurationMs = row.DurationMs,
            At = row.At > 0 ? row.At : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            Success = row.Success,
            Kind = "personal",
            TargetDiscordUserId = selfId,
            TargetDisplayName = Me!.DisplayName,
            TargetAvatarUrl = ParticipantUtil.AvatarUrl(selfId, Me.User!.Avatar),
        };
    }

    private static string? FirstNonEmpty(params string?[] values) => values.FirstOrDefault(v => !string.IsNullOrEmpty(v));
}
