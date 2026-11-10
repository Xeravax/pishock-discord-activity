using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;
using PiShock.Activity.Web.Discord;
using PiShock.Activity.Web.Models;
using PiShock.Activity.Web.Realtime;

namespace PiShock.Activity.Web.Services;

public enum Overlay
{
    None,
    Menu,
    Availability,
    Settings,
    Shares,
    Logs,
    Link,
}

public enum LegalView
{
    None,
    Terms,
    Privacy,
}

public sealed record PendingLinkConfirm(int PishockUserId, IReadOnlyList<string> HubNames);

public sealed record SetupChoices(bool WantsDiscordShare);

public sealed class DevicesData
{
    public List<System.Text.Json.JsonElement> Hubs { get; } = [];
    public List<System.Text.Json.JsonElement> Shockers { get; } = [];
    public List<System.Text.Json.JsonElement> Shared { get; } = [];
    public List<System.Text.Json.JsonElement> Links { get; } = [];
    public Dictionary<string, bool> Online { get; } = [];
}

/// <summary>
/// Port of the state + effects inside App.tsx. Components render from this object and call its methods;
/// <see cref="Changed"/> tells the root component (Home) to re-render.
/// Split across partial files: boot/state (this file), data refresh + derived views, realtime, actions.
/// </summary>
public sealed partial class ActivitySession : IAsyncDisposable
{
    private readonly ActivityApiService _api;
    private readonly DiscordActivity _discord;
    private readonly ActivitySocket _socket;
    private readonly AppHealthService _health;
    private readonly IJSRuntime _js;
    private DotNetObjectReference<ActivitySession>? _self;
    private readonly CancellationTokenSource _lifetime = new();

    public ActivitySession(
        ActivityApiService api,
        DiscordActivity discord,
        ActivitySocket socket,
        AppHealthService health,
        IJSRuntime js)
    {
        _api = api;
        _discord = discord;
        _socket = socket;
        _health = health;
        _js = js;
        _socket.OnEvent += HandleRealtime;
    }

    public event Action? Changed;

    private void Notify() => Changed?.Invoke();

    // ---- boot ----------------------------------------------------------
    public bool BootStarted { get; private set; }
    public bool BootReady { get; private set; }
    public string? BootError { get; private set; }
    public int BootProgress { get; private set; } = 4;
    public string BootLabel { get; private set; } = "Starting…";
    public bool Embedded { get; private set; }

    // ---- identity ------------------------------------------------------
    public string? Token { get; private set; }
    public MeResponse? Me { get; private set; }
    public bool Pip { get; private set; }

    // ---- ui state ------------------------------------------------------
    public bool Busy { get; private set; }
    public string? ActionError { get; set; }
    public Overlay Overlay { get; set; } = Overlay.None;
    public LegalView LegalView { get; set; } = LegalView.None;
    public bool LogsOpen { get; set; }
    public int? SettingsFocusShockerId { get; set; }
    public ShockerView? PairDialog { get; set; }
    public IncomingShockHit? LastIncoming { get; private set; }

    // ---- link flow -----------------------------------------------------
    public string? LoginUrl { get; private set; }
    public bool Linking { get; private set; }
    public string? LinkError { get; private set; }
    public PendingLinkConfirm? LinkConfirm { get; private set; }
    public bool ConfirmBusy { get; private set; }
    public bool SetupPhase { get; private set; }
    private int _linkPollGen;
    private bool _wantsShareAfterLink;

    // ---- data ----------------------------------------------------------
    public DevicesData? Devices { get; private set; }
    public Dictionary<string, bool> Online { get; private set; } = [];
    public List<OfficialLogEntry> PublicLogs { get; private set; } = [];
    public List<ActivityLogRow> Logs { get; private set; } = [];
    public Dictionary<int, (bool Enabled, int MaxIntensity, int MaxDurationMs)> DiscordShareLimits { get; private set; } = [];

    // ---- friends / participants ---------------------------------------
    public bool FriendsMode { get; set; } = true;
    public List<DiscordParticipant> Participants { get; private set; } = [];
    public Dictionary<string, ParticipantStatus> ParticipantStatuses { get; private set; } = [];
    public List<string> SelectedTargetIds { get; private set; } = [];
    public string? SelectedTargetId => SelectedTargetIds.Count > 0 ? SelectedTargetIds[0] : null;
    public string? SelectedHubId { get; set; }
    public bool Pinging { get; private set; }

    private int _operateInflight;
    private bool _realtimeStarted;
    private bool _participantsSubscribed;

    // ======================================================================
    // Boot flow (App.tsx boot effect)
    // ======================================================================

    private void Report(int progress, string label)
    {
        BootProgress = progress;
        BootLabel = label;
        Notify();
    }

    public async Task BootAsync()
    {
        if (BootStarted) return;
        BootStarted = true;
        try
        {
            Report(4, "Starting…");
            Embedded = await _api.IsEmbeddedAsync();
            Report(8, Embedded ? "Connecting to Discord…" : "Local preview…");

            _self ??= DotNetObjectReference.Create(this);
            var auth = await _discord.BootstrapAsync(_self);
            Token = auth.AccessToken;
            _api.SetAccessToken(Token);

            if (!Embedded)
            {
                // Local browser: consent/link screens still render; API calls need a real Discord token.
                Me = new MeResponse
                {
                    Consent = false,
                    PishockLinked = false,
                    User = new MeUser
                    {
                        Id = string.IsNullOrEmpty(auth.UserId) ? "dev-user" : auth.UserId,
                        Username = string.IsNullOrEmpty(auth.Username) ? "DevUser" : auth.Username,
                        GlobalName = auth.GlobalName ?? "Local Dev",
                        Avatar = auth.Avatar,
                    },
                };
                Report(100, "Ready");
                BootReady = true;
                Notify();
                return;
            }

            Report(86, "Loading your profile…");
            var me = await RefreshMeAsync();

            if (me.Consent)
            {
                // Resume pending link confirmation if login finished before confirm.
                try
                {
                    Report(90, "Checking link status…");
                    var status = await _api.GetLoginStatusAsync();
                    if (Json.Str(status, "status") == "confirm" && Json.Num(status, "pishockUserId") is { } uid)
                    {
                        LinkConfirm = new PendingLinkConfirm((int)uid, HubNames(status));
                        Report(100, "Ready");
                        BootReady = true;
                        await StartRealtimeAsync();
                        Notify();
                        return;
                    }
                }
                catch
                {
                    // ignore — continue into control
                }

                Report(92, "Loading activity…");
                await Safe(RefreshLogsAsync);
                if (me.PishockLinked)
                {
                    Report(95, "Loading devices…");
                    await RefreshDevicesAsync();
                }
                else
                {
                    // Discord Friends work without a PiShock login — default into that mode.
                    FriendsMode = true;
                }

                try
                {
                    Report(97, "Loading Discord Shockers…");
                    await RefreshParticipantsAsync(false);
                }
                catch
                {
                    // participant APIs need bot token; control still works
                }

                await StartRealtimeAsync();
            }

            Report(100, "Ready");
            BootReady = true;
            Notify();
        }
        catch (Exception ex)
        {
            BootError = ex.Message;
            BootReady = true;
            Notify();
        }
    }

    private static IReadOnlyList<string> HubNames(System.Text.Json.JsonElement status) =>
        Json.Items(status, "hubNames").Select(e => e.ValueKind == System.Text.Json.JsonValueKind.String ? e.GetString() ?? "" : e.ToString()).ToList();

    private static async Task Safe(Func<Task> action)
    {
        try { await action(); } catch { /* best-effort */ }
    }

    // ======================================================================
    // JS callbacks
    // ======================================================================

    [JSInvokable]
    public async Task OnLayoutChanged(bool pip)
    {
        if (Pip == pip) return;
        Pip = pip;
        try
        {
            await _js.InvokeVoidAsync("document.documentElement.classList.toggle", "pip-mode", pip);
            await _js.InvokeVoidAsync("document.body.classList.toggle", "pip-mode", pip);
        }
        catch
        {
            // cosmetic
        }

        if (pip) _ = PipLogLoopAsync();
        Notify();
    }

    [JSInvokable]
    public async Task OnParticipantsUpdate(string json)
    {
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(json);
            Participants = ParticipantUtil.NormalizeList(doc.RootElement);
            Notify();
            await Safe(() => RefreshParticipantStatusAsync(Participants, false));
            Notify();
        }
        catch
        {
            // ignore malformed
        }
    }

    /// <summary>While PIP is open, refresh logs so hits still show if the WS was missed.</summary>
    private async Task PipLogLoopAsync()
    {
        while (Pip && Token is not null && Me?.Consent == true && !_lifetime.IsCancellationRequested)
        {
            await Safe(RefreshLogsAsync);
            Notify();
            try { await Task.Delay(4000, _lifetime.Token); } catch (TaskCanceledException) { return; }
        }
    }

    public async ValueTask DisposeAsync()
    {
        _lifetime.Cancel();
        _socket.OnEvent -= HandleRealtime;
        await Safe(() => _discord.UnsubscribeParticipantsAsync().AsTask());
        await _socket.DisposeAsync();
        _self?.Dispose();
    }
}
