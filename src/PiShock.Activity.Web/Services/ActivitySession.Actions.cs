using System.Text.Json;
using Microsoft.JSInterop;
using PiShock.Activity.Web.Models;

namespace PiShock.Activity.Web.Services;

public sealed partial class ActivitySession
{
    private static string Describe(Exception ex) => ex.Message;

    /// <summary>Run an action with Busy + error handling (the repeated try/catch/finally in App.tsx).</summary>
    private async Task RunBusyAsync(Func<Task> action)
    {
        Busy = true;
        ActionError = null;
        Notify();
        try
        {
            await action();
        }
        catch (ApiException ex) when (ex.Code == "PISHOCK_RELOGIN")
        {
            HandleReloginNeeded();
            RequirePiShockLink("PiShock session expired — link again to control your own devices.");
        }
        catch (Exception ex)
        {
            ActionError = Describe(ex);
        }
        finally
        {
            Busy = false;
            Notify();
        }
    }

    // ======================================================================
    // Consent
    // ======================================================================

    public Task AcceptConsentAsync() => RunBusyAsync(async () =>
    {
        await _api.PostConsentAsync();
        var me = await RefreshMeAsync();
        if (me.Consent)
        {
            await Safe(RefreshLogsAsync);
            if (me.PishockLinked) await Safe(RefreshDevicesAsync);
            await Safe(() => RefreshParticipantsAsync(false));
            await StartRealtimeAsync();
        }
    });

    public Task RevokeConsentAsync() => RunBusyAsync(async () =>
    {
        await _api.RevokeConsentAsync();
        Overlay = Overlay.None;
        await RefreshMeAsync();
    });

    // ======================================================================
    // PiShock link flow
    // ======================================================================

    private void AbortLinkPoll() => _linkPollGen++;

    public void HandleReloginNeeded()
    {
        if (Me is not null)
        {
            Me.PishockLinked = false;
            Me.PishockUserId = null;
        }
        Devices = null;
        LoginUrl = null;
        FriendsMode = true;
        SelectedHubId = null;
    }

    public void RequirePiShockLink(string reason)
    {
        ActionError = reason;
        _ = OpenLinkFlowAsync();
    }

    public async Task OpenLinkFlowAsync()
    {
        if (Me?.User is null) return;
        LinkError = null;
        var prefs = await LoadSetupPrefsAsync(Me.User.Id);
        if (!prefs.Seen)
        {
            SetupPhase = true;
            Overlay = Overlay.None;
        }
        else
        {
            SetupPhase = false;
            Overlay = Overlay.Link;
        }
        Notify();
    }

    public async Task FinishSetupAsync(SetupChoices choices)
    {
        if (Me?.User is null) return;
        await SaveSetupPrefsAsync(Me.User.Id, choices);
        _wantsShareAfterLink = choices.WantsDiscordShare;
        SetupPhase = false;
        await StartPiShockLoginAsync();
    }

    public async Task StartPiShockLoginAsync()
    {
        if (Token is null) return;
        AbortLinkPoll();
        Linking = true;
        LinkError = null;
        Overlay = Overlay.None;
        SetupPhase = false;
        Notify();
        try
        {
            var started = await _api.StartPiShockLoginAsync();
            LoginUrl = started.LoginUrl;
            Notify();
            await _discord.OpenExternalAsync(started.LoginUrl);
            _ = PollLoginAsync();
        }
        catch (Exception ex)
        {
            LinkError = Describe(ex);
            Linking = false;
            Notify();
        }
    }

    public Task ReopenLoginAsync() =>
        LoginUrl is null ? Task.CompletedTask : _discord.OpenExternalAsync(LoginUrl).AsTask();

    private async Task PollLoginAsync()
    {
        var gen = ++_linkPollGen;
        var started = DateTime.UtcNow;
        while (_linkPollGen == gen && !_lifetime.IsCancellationRequested)
        {
            try
            {
                var status = await _api.GetLoginStatusAsync();
                if (_linkPollGen != gen) return;
                var s = Json.Str(status, "status");
                if (s == "confirm" && Json.Num(status, "pishockUserId") is { } uid)
                {
                    Linking = false;
                    LoginUrl = null;
                    Overlay = Overlay.None;
                    LinkError = null;
                    ActionError = null;
                    LinkConfirm = new PendingLinkConfirm((int)uid, HubNames(status));
                    Notify();
                    return;
                }

                if (s == "linked")
                {
                    // Already confirmed/linked earlier — just refresh.
                    var me = await RefreshMeAsync();
                    if (_linkPollGen != gen) return;
                    if (me.PishockLinked)
                    {
                        Linking = false;
                        LoginUrl = null;
                        Overlay = Overlay.None;
                        LinkConfirm = null;
                        ActionError = null;
                        await RefreshDevicesAsync();
                        await Safe(RefreshLogsAsync);
                        Notify();
                        return;
                    }
                }

                if (s == "error")
                {
                    LinkError = Json.Str(status, "error") ?? "Login failed";
                    Linking = false;
                    Notify();
                    return;
                }
            }
            catch (Exception ex)
            {
                if (_linkPollGen != gen) return;
                LinkError = Describe(ex);
                Linking = false;
                Notify();
                return;
            }

            if (DateTime.UtcNow - started > TimeSpan.FromMinutes(5))
            {
                if (_linkPollGen != gen) return;
                LinkError = "Login timed out";
                Linking = false;
                Notify();
                return;
            }

            try { await Task.Delay(2000, _lifetime.Token); } catch (TaskCanceledException) { return; }
        }
    }

    public async Task CancelLoginWaitAsync()
    {
        AbortLinkPoll();
        Linking = false;
        LoginUrl = null;
        LinkError = null;
        Notify();
        if (Token is null) return;
        await Safe(_api.CancelPiShockLoginAsync);
    }

    public async Task ConfirmLinkAsync()
    {
        if (Token is null || LinkConfirm is null) return;
        ConfirmBusy = true;
        LinkError = null;
        Notify();
        try
        {
            await _api.ConfirmPiShockLoginAsync();
            LinkConfirm = null;
            var me = await RefreshMeAsync();
            if (me.PishockLinked)
            {
                await RefreshDevicesAsync();
                await Safe(RefreshLogsAsync);
                // Port simplification: the React "choose shockers to share" setup screen is replaced by
                // opening the Available-in-Discord dialog when the user opted in during setup.
                if (_wantsShareAfterLink)
                {
                    _wantsShareAfterLink = false;
                    Overlay = Overlay.Availability;
                }
            }
        }
        catch (Exception ex)
        {
            LinkError = Describe(ex);
        }
        finally
        {
            ConfirmBusy = false;
            Notify();
        }
    }

    public async Task CancelLinkAsync()
    {
        AbortLinkPoll();
        if (Token is null)
        {
            LinkConfirm = null;
            Linking = false;
            LoginUrl = null;
            Notify();
            return;
        }

        ConfirmBusy = true;
        Notify();
        await Safe(_api.CancelPiShockLoginAsync);
        ConfirmBusy = false;
        LinkConfirm = null;
        Linking = false;
        LoginUrl = null;
        LinkError = null;
        Notify();
    }

    public async Task UnlinkPiShockAsync()
    {
        if (Token is null) return;
        Overlay = Overlay.None;
        Notify();
        try
        {
            await _api.UnlinkPiShockAsync();
            HandleReloginNeeded();
        }
        catch (Exception ex)
        {
            ActionError = Describe(ex);
        }
        Notify();
    }

    // ---- first-time setup prefs (localStorage, same keys as the React client) ----

    public async Task<(bool Seen, bool WantsDiscordShare)> LoadSetupPrefsAsync(string discordUserId)
    {
        try
        {
            var raw = await _js.InvokeAsync<string?>("localStorage.getItem", $"pishock-setup:{discordUserId}");
            if (string.IsNullOrEmpty(raw)) return (false, true);
            using var doc = JsonDocument.Parse(raw);
            var seen = Json.Bool(doc.RootElement, "seen") ?? false;
            var wants = Json.Bool(doc.RootElement, "wantsDiscordShare") != false;
            return (seen, wants);
        }
        catch
        {
            return (false, true);
        }
    }

    private async Task SaveSetupPrefsAsync(string discordUserId, SetupChoices choices)
    {
        try
        {
            var json = JsonSerializer.Serialize(new { seen = true, wantsDiscordShare = choices.WantsDiscordShare });
            await _js.InvokeVoidAsync("localStorage.setItem", $"pishock-setup:{discordUserId}", json);
        }
        catch
        {
            // private mode
        }
    }

    // ======================================================================
    // Operate / emergency stop
    // ======================================================================

    /// <summary>Port of App.tsx operate(): route to participant or own endpoint, attach instance + location.</summary>
    public async Task OperateAsync(OfficialOperateInput input)
    {
        if (Token is null) return;
        _operateInflight++;
        Busy = true;
        ActionError = null;
        Notify();
        try
        {
            var targetId = input.TargetDiscordUserId
                ?? (SelectedTargetId is not null && FriendsMode ? SelectedTargetId : null);
            var instanceId = await _discord.GetInstanceIdAsync();
            Discord.ActivityLocationHint? hint = null;
            try { hint = await _discord.ResolveLocationHintAsync(Token); } catch { /* optional */ }

            var body = input.ToBody();
            body["instanceId"] = instanceId;
            body["locationHint"] = hint;

            if (targetId is not null)
            {
                await _api.OperateAsync(body, targetId);
            }
            else if (Me?.PishockLinked != true)
            {
                RequirePiShockLink(
                    "Link PiShock to control your own shockers or website shares. Discord Shockers work without linking.");
                return;
            }
            else
            {
                await _api.OperateAsync(body);
            }

            await Safe(RefreshLogsAsync);
        }
        catch (ApiException ex) when (ex.Code == "PISHOCK_RELOGIN")
        {
            HandleReloginNeeded();
            RequirePiShockLink("PiShock session expired — link again to control your own devices.");
        }
        catch (ApiException ex) when (ex.Code == "EMERGENCY_STOP")
        {
            ActionError = "Emergency stop is engaged — owner must release STOP";
            _ = SafeNotify(() => RefreshParticipantStatusAsync(Participants, true));
        }
        catch (Exception ex)
        {
            ActionError = Describe(ex);
        }
        finally
        {
            _operateInflight = Math.Max(0, _operateInflight - 1);
            if (_operateInflight == 0) Busy = false;
            Notify();
        }
    }

    public async Task SetEmergencyStopAsync(EmergencyStopInput input)
    {
        if (Token is null) return;
        if (Me?.PishockLinked != true)
        {
            RequirePiShockLink("Link PiShock to use emergency stop on your devices.");
            return;
        }

        await RunBusyAsync(async () =>
        {
            var result = await _api.SetEmergencyStopAsync(input);
            if (Me is not null)
            {
                Me.EmergencyStopShockerIds = Json.Items(result, "emergencyStopShockerIds").Select(e => (int)e.GetDouble()).ToArray();
            }
            InvalidateStatusCache();
            await Safe(RefreshLogsAsync);
            if (Participants.Count > 0) await Safe(() => RefreshParticipantStatusAsync(Participants, true));
        });
    }

    // ======================================================================
    // Availability / Activity Limits / shares
    // ======================================================================

    public Task<ActivityShareResponse> LoadAvailabilityAsync() => _api.GetAvailabilityAsync();

    public async Task SaveAvailabilityAsync(List<ShareLimitRow> shares, List<string> banned)
    {
        await _api.SaveAvailabilityAsync(shares, banned);
        InvalidateStatusCache();
        if (Participants.Count > 0) await RefreshParticipantStatusAsync(Participants, true);
        Notify();
    }

    private void ApplyDiscordShareLimits(IEnumerable<ShareLimitRow> shares)
    {
        DiscordShareLimits = shares.ToDictionary(s => s.ShockerId, s => (s.Enabled, s.MaxIntensity, s.MaxDurationMs));
    }

    public async Task<ActivitySettingsResponse> LoadSettingsAsync()
    {
        var data = await _api.GetSettingsAsync();
        ApplyDiscordShareLimits(data.Shares);
        Notify();
        return data;
    }

    public async Task SaveSettingsAsync(PersonalLimits personal, List<ShareLimitRow> shares)
    {
        var result = await _api.SaveSettingsAsync(personal, shares);
        if (Me is not null) Me.Personal = result.Personal;
        ApplyDiscordShareLimits(result.Shares);
        InvalidateStatusCache();
        if (Participants.Count > 0) await RefreshParticipantStatusAsync(Participants, true);
        Notify();
    }

    public Task CreateLinkAsync(Dictionary<string, object?> payload) => RunBusyAsync(async () =>
    {
        await _api.CreateLinkAsync(payload);
        await RefreshDevicesAsync();
    });

    public Task PauseLinkAsync(int linkId, bool pauseState) => RunBusyAsync(async () =>
    {
        await _api.PauseLinkAsync(linkId, pauseState);
        await RefreshDevicesAsync();
    });

    public Task DeleteLinkAsync(int linkId) => RunBusyAsync(async () =>
    {
        await _api.DeleteLinkAsync(linkId);
        await RefreshDevicesAsync();
    });

    public Task CreateShareAsync(int shockerId, bool openSharesAfter = false, bool full = true) => RunBusyAsync(async () =>
    {
        await _api.CreateShareAsync(shockerId, full);
        await RefreshDevicesAsync();
        if (openSharesAfter) Overlay = Overlay.Shares;
    });

    public Task ClaimShareAsync(string code) => RunBusyAsync(async () =>
    {
        await _api.ClaimShareAsync(code);
        await RefreshDevicesAsync();
    });

    // ======================================================================
    // Navigation / selection
    // ======================================================================

    public void OpenLinkedOverlay(Overlay next)
    {
        if (Me?.PishockLinked != true && next is Overlay.Availability or Overlay.Shares or Overlay.Settings)
        {
            RequirePiShockLink(next switch
            {
                Overlay.Availability => "Link PiShock to make your shockers available in this Discord activity.",
                Overlay.Settings => "Link PiShock to configure Activity Limits for your devices.",
                _ => "Link PiShock to manage your website shares and links.",
            });
            return;
        }
        if (next != Overlay.Settings) SettingsFocusShockerId = null;
        Overlay = next;
        Notify();
    }

    public void OpenOfficialLogs()
    {
        LogsOpen = true;
        Notify();
        _ = SafeNotify(RefreshLogsAsync);
    }

    public void CloseOfficialLogs()
    {
        LogsOpen = false;
        if (Overlay == Overlay.Logs) Overlay = Overlay.None;
        Notify();
    }

    public void SelectParticipant(string? id, bool multi)
    {
        if (string.IsNullOrEmpty(id))
        {
            SelectedTargetIds = [];
        }
        else if (multi)
        {
            SelectedTargetIds = SelectedTargetIds.Contains(id)
                ? SelectedTargetIds.Where(x => x != id).ToList()
                : [.. SelectedTargetIds, id];
        }
        else
        {
            SelectedTargetIds = SelectedTargetIds.Count == 1 && SelectedTargetIds[0] == id ? [] : [id];
        }
        Notify();
    }

    public void OpenFriends()
    {
        FriendsMode = true;
        Notify();
        _ = SafeNotify(() => RefreshParticipantsAsync(true));
    }

    public Task RefreshFriendsAsync() => SafeNotify(() => RefreshParticipantsAsync(true));

    public void OpenOwnShockers()
    {
        if (Me?.PishockLinked != true) return;
        FriendsMode = false;
        SelectedTargetIds = [];
        Notify();
    }

    public void SelectHub(string hubId)
    {
        if (Me?.PishockLinked != true) return;
        FriendsMode = false;
        SelectedTargetIds = [];
        SelectedHubId = hubId;
        Notify();
    }

    public void OpenShockerSettings(ShockerView s)
    {
        if (Me?.PishockLinked != true || !s.Owned)
        {
            RequirePiShockLink("Link PiShock to edit Activity Limits and device settings for your shockers.");
            return;
        }
        SettingsFocusShockerId = s.Id;
        OpenLinkedOverlay(Overlay.Settings);
    }

    public void RequestPingHub()
    {
        if (Me?.PishockLinked != true)
        {
            RequirePiShockLink("Link PiShock to ping your hub.");
            return;
        }
        _ = PingHubAsync();
    }

    public void RequestPair(ShockerView s)
    {
        if (Me?.PishockLinked != true || !s.Owned)
        {
            RequirePiShockLink("Link PiShock to pair your own shockers.");
            return;
        }
        PairDialog = s;
        Notify();
    }

    public async Task RequestShareShockerAsync(ShockerView s)
    {
        if (Me?.PishockLinked != true)
        {
            RequirePiShockLink("Link PiShock to create share codes for your own shockers.");
            return;
        }
        if (!s.Owned) return;
        await CreateShareAsync(s.Id, openSharesAfter: true, full: false);
    }
}
