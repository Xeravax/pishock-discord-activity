using System.Text.Json;
using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;
using PiShock.Activity.Web.Discord;
using PiShock.Activity.Web.Models;

namespace PiShock.Activity.Web.Components;

/// <summary>Logic for the official PiShock remote (port of OfficialController.tsx).</summary>
public partial class OfficialController : IDisposable
{
    [Inject] private IJSRuntime Js { get; set; } = default!;
    [Inject] private DiscordActivity Discord { get; set; } = default!;

    [Parameter, EditorRequired] public HubInfo Hub { get; set; } = new();
    [Parameter] public List<ShockerView> Shockers { get; set; } = [];
    [Parameter] public bool Busy { get; set; }
    [Parameter] public bool Pip { get; set; }
    [Parameter] public List<HubInfo> Hubs { get; set; } = [];
    [Parameter] public bool FriendsOpen { get; set; }
    [Parameter] public RenderFragment<FriendsPanelContext>? FriendsPanel { get; set; }
    [Parameter] public RenderFragment? SafetyBanner { get; set; }

    /// <summary>Shown above controls (e.g. blocked / e-stop notices).</summary>
    [Parameter] public RenderFragment? AccessBanner { get; set; }
    [Parameter] public string EmptyMessage { get; set; } = "No shockers";
    [Parameter] public bool ShowLinkAccount { get; set; }
    [Parameter] public bool ShowOwnMode { get; set; } = true;
    [Parameter] public EventCallback<OfficialOperateInput> OnOperate { get; set; }
    [Parameter] public EventCallback<EmergencyStopInput> OnEmergencyStop { get; set; }
    [Parameter] public EventCallback<string> OnSelectHub { get; set; }
    [Parameter] public EventCallback OnOpenFriends { get; set; }
    [Parameter] public EventCallback OnOpenOwnShockers { get; set; }
    [Parameter] public EventCallback OnOpenMenu { get; set; }
    [Parameter] public EventCallback OnOpenLinkAccount { get; set; }
    [Parameter] public EventCallback<ShockerView> OnOpenShockerSettings { get; set; }
    [Parameter] public EventCallback<ShockerView> OnShareShocker { get; set; }
    [Parameter] public EventCallback<ShockerView> OnPair { get; set; }
    [Parameter] public EventCallback OnPingHub { get; set; }
    [Parameter] public bool Pinging { get; set; }
    [Parameter] public string? SelectedHubId { get; set; }

    private sealed record HoldTarget(int ShockerId, string? ClientId, string? ShareCode, string? TargetDiscordUserId);

    private sealed record FireOpts(bool Hold = false, bool SkipWarning = false, HoldTarget? Target = null);

    private static readonly Random Rng = new();

    // ---- state ----
    private bool _ready;
    private bool _disposed;
    private int _activeId;
    private bool _hubMenuOpen;
    private bool _hubsOpen;
    private bool _multiShock;
    private bool _individualIntensity;
    private Dictionary<string, int> _perShock = [];
    private List<int> _selectedIds = [];
    private bool _modeDockOpen = true;
    private bool _compactDock;
    private bool _viewportCompact;
    private bool? _lastCompact;
    private int _shockIntensity;
    private int _shockDurationMs = 300;
    private bool _shockRandom;
    private int _shockMin;
    private int _shockMax = 100;
    private int _vibIntensity = 69;
    private int _vibDurationMs = 1000;
    private string? _durationMenu;
    private WarningLevel _warningLevel = WarningLevel.None;
    private bool _tapMode;
    private string? _holdingOp;
    private HoldTarget? _holdTarget;
    private CancellationTokenSource? _warnCts;
    private string? _lastVisibleKey;
    private string? _lastSavedPrefs;

    // ---- derived ----
    private static int Clamp(int n, int min, int max) => Math.Max(min, Math.Min(max, n));

    private ShockerView? Active =>
        Shockers.FirstOrDefault(s => s.Id == _activeId) ?? Shockers.FirstOrDefault();

    private List<ShockerView> SelectedShockers
    {
        get
        {
            var active = Active;
            if (!_multiShock) return active is null ? [] : [active];
            var picked = _selectedIds
                .Select(id => Shockers.FirstOrDefault(s => s.Id == id))
                .Where(s => s is not null)
                .Select(s => s!)
                .ToList();
            if (picked.Count > 0) return picked;
            return active is null ? [] : [active];
        }
    }

    private int DeviceMaxInt
    {
        get
        {
            var pool = SelectedShockers;
            return pool.Count > 0 ? pool.Max(s => s.DeviceMaxIntensity ?? s.MaxIntensity) : 100;
        }
    }

    private int DeviceMaxDur
    {
        get
        {
            var pool = SelectedShockers;
            return pool.Count > 0 ? pool.Max(s => s.DeviceMaxDuration ?? s.MaxDuration) : 15_000;
        }
    }

    private int ActivityMaxInt
    {
        get
        {
            var pool = SelectedShockers;
            return pool.Count > 0 ? pool.Max(s => s.UsableIntensity) : 100;
        }
    }

    private int ActivityMaxDur
    {
        get
        {
            var pool = SelectedShockers;
            return pool.Count > 0 ? pool.Max(s => s.UsableDuration) : 15_000;
        }
    }

    private int MaxInt => Math.Min(DeviceMaxInt, ActivityMaxInt);
    private int MaxDur => Math.Min(DeviceMaxDur, ActivityMaxDur);
    private bool IndividualMode => _individualIntensity && _multiShock;

    /// <summary>While editing per-person, the shock slider is capped to the focused person.</summary>
    private int ShockEditCap => IndividualMode && Active is { } a ? a.UsableIntensity : MaxInt;

    private bool EStop => SelectedShockers.Any(s => s.EmergencyStop);
    private bool ControlsLocked => EStop;
    private bool RandomActive => _shockRandom && !IndividualMode;

    private List<LimitMarker> MultiLimitMarkers
    {
        get
        {
            var pool = SelectedShockers;
            if (!_multiShock || pool.Count < 2) return [];
            var seen = new HashSet<string>();
            var markers = new List<LimitMarker>();
            foreach (var s in pool)
            {
                var key = s.MultiColorKey;
                if (!seen.Add(key)) continue;
                var limit = s.UsableIntensity;
                markers.Add(new LimitMarker(
                    key,
                    s.MultiColor,
                    limit,
                    _individualIntensity ? Clamp(_perShock.GetValueOrDefault(key, _shockIntensity), 0, limit) : null,
                    s.UsableDuration,
                    !string.IsNullOrEmpty(s.HubName) && !s.Owned ? $"{s.HubName}: {s.Name}" : s.Name));
            }
            return markers.OrderBy(m => m.Intensity).ToList();
        }
    }

    // ---- lifecycle ----
    protected override async Task OnInitializedAsync()
    {
        ControlPrefs prefs;
        try
        {
            var raw = await Js.InvokeAsync<string?>("localStorage.getItem", ControlPrefs.StorageKey);
            prefs = ControlPrefs.Parse(raw);
        }
        catch
        {
            prefs = new ControlPrefs();
        }

        try
        {
            _viewportCompact = await Discord.IsCompactViewportAsync();
        }
        catch
        {
            _viewportCompact = false;
        }

        _shockIntensity = prefs.ShockIntensity;
        _shockDurationMs = prefs.ShockDurationMs;
        _shockRandom = prefs.ShockRandom;
        _shockMin = prefs.ShockMin;
        _shockMax = prefs.ShockMax;
        _vibIntensity = prefs.VibIntensity;
        _vibDurationMs = prefs.VibDurationMs;
        _warningLevel = WarningPresets.FromKey(prefs.WarningLevelKey);
        _tapMode = prefs.TapMode;
        _multiShock = prefs.MultiShock;
        _individualIntensity = prefs.IndividualIntensity;
        _perShock = new Dictionary<string, int>(prefs.PerShockIntensity);
        _activeId = prefs.ActiveId ?? Shockers.FirstOrDefault()?.Id ?? 0;
        var first = prefs.ActiveId ?? Shockers.FirstOrDefault()?.Id;
        _selectedIds = first is { } f ? [f] : [];
        _ready = true;
        SyncWithShockers(force: true);
    }

    protected override void OnParametersSet()
    {
        if (!_ready) return;
        SyncWithShockers(force: false);
    }

    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (!_ready) return;
        var json = JsonSerializer.Serialize(BuildPrefs());
        if (json == _lastSavedPrefs) return;
        _lastSavedPrefs = json;
        try
        {
            await Js.InvokeVoidAsync("localStorage.setItem", ControlPrefs.StorageKey, json);
        }
        catch
        {
            // private mode / quota
        }
    }

    private ControlPrefs BuildPrefs() => new()
    {
        ShockIntensity = _shockIntensity,
        ShockDurationMs = _shockDurationMs,
        ShockRandom = _shockRandom,
        ShockMin = _shockMin,
        ShockMax = _shockMax,
        VibIntensity = _vibIntensity,
        VibDurationMs = _vibDurationMs,
        WarningLevelKey = WarningPresets.ToKey(_warningLevel),
        TapMode = _tapMode,
        MultiShock = _multiShock,
        IndividualIntensity = _individualIntensity,
        PerShockIntensity = _perShock,
        ActiveId = Active?.Id ?? _activeId,
    };

    /// <summary>Replays the React effects that react to a changed shocker list / limits.</summary>
    private void SyncWithShockers(bool force)
    {
        // active must stay visible
        if (!Shockers.Any(s => s.Id == _activeId))
        {
            var next = Shockers.FirstOrDefault()?.Id ?? 0;
            _activeId = next;
            _selectedIds = next != 0 ? [next] : [];
        }

        // keep selection in sync with the visible roster (only when the roster changes)
        var visibleKey = string.Join(',', Shockers.Select(s => s.Id));
        if (force || visibleKey != _lastVisibleKey)
        {
            _lastVisibleKey = visibleKey;
            var visible = Shockers.Select(s => s.Id).ToList();
            var valid = _selectedIds.Where(visible.Contains).ToList();
            if (!_multiShock)
            {
                _selectedIds = valid.Count > 0 ? valid.Take(1).ToList()
                    : Shockers.Count > 0 ? [Shockers[0].Id] : [];
            }
            else
            {
                var merged = new List<int>(valid);
                foreach (var id in visible)
                {
                    if (!merged.Contains(id)) merged.Add(id);
                }
                _selectedIds = merged.Count > 0 ? merged : Shockers.Count > 0 ? [Shockers[0].Id] : [];
            }
        }

        // compact dock follows viewport / PIP
        var compact = _viewportCompact || Pip;
        if (_lastCompact != compact)
        {
            _lastCompact = compact;
            _compactDock = compact;
            _modeDockOpen = !compact;
        }

        ClampToLimits();
        SeedIfIndividual();

        // E-stop: clear local warning / hold state (owner STOP already cuts the broker op)
        if (EStop)
        {
            _warningLevel = WarningLevel.None;
            CancelWarning();
            _holdingOp = null;
            _holdTarget = null;
        }

        // Press-and-hold needs broker hold permission; multishock and TAP don't mix
        if (_tapMode && Active is { CanHold: false })
        {
            if (_holdingOp is not null) _ = EndHoldAsync();
            _tapMode = false;
        }
        if (_multiShock && _tapMode)
        {
            if (_holdingOp is not null) _ = EndHoldAsync();
            _tapMode = false;
        }
    }

    private void ClampToLimits()
    {
        var cap = ShockEditCap;
        _shockIntensity = Clamp(_shockIntensity, 0, cap);
        _vibIntensity = Clamp(_vibIntensity, 0, MaxInt);
        _shockMin = Clamp(_shockMin, 0, cap);
        _shockMax = Clamp(_shockMax, 0, cap);
        _shockDurationMs = Clamp(_shockDurationMs, 16, MaxDur);
        _vibDurationMs = Clamp(_vibDurationMs, 16, MaxDur);
    }

    private void SeedIfIndividual()
    {
        if (!IndividualMode) return;
        foreach (var s in SelectedShockers)
        {
            var key = s.MultiColorKey;
            var cap = s.UsableIntensity;
            _perShock[key] = _perShock.TryGetValue(key, out var v) ? Clamp(v, 0, cap) : Clamp(_shockIntensity, 0, cap);
        }
    }

    public void Dispose()
    {
        _disposed = true;
        CancelWarning();
    }

    // ---- multishock ----
    private void ToggleMultiShock()
    {
        _multiShock = !_multiShock;
        if (_multiShock)
        {
            if (_holdingOp is not null) _ = EndHoldAsync();
            _tapMode = false;
            _selectedIds = Active is { } a ? [a.Id] : [];
        }
        else
        {
            _individualIntensity = false;
        }
    }

    private void ToggleIndividualIntensity()
    {
        if (!_multiShock) return;
        _individualIntensity = !_individualIntensity;
        if (!_individualIntensity) return;

        _shockRandom = false;
        foreach (var s in SelectedShockers)
        {
            var key = s.MultiColorKey;
            var cap = s.UsableIntensity;
            _perShock[key] = _perShock.TryGetValue(key, out var v) ? Clamp(v, 0, cap) : Clamp(_shockIntensity, 0, cap);
        }
        if (Active is { } active)
        {
            _shockIntensity = Clamp(_perShock.GetValueOrDefault(active.MultiColorKey, _shockIntensity), 0, active.UsableIntensity);
        }
    }

    private void FocusShockerIntensity(ShockerView s)
    {
        if (!IndividualMode) return;
        var key = s.MultiColorKey;
        var cap = s.UsableIntensity;
        var seeded = Clamp(_perShock.GetValueOrDefault(key, _shockIntensity), 0, cap);
        _shockIntensity = seeded;
        _perShock[key] = seeded;
    }

    private void ChipClick(ShockerView s)
    {
        if (!_multiShock)
        {
            _activeId = s.Id;
            _selectedIds = [s.Id];
            ClampToLimits();
            return;
        }
        if (_individualIntensity && _selectedIds.Contains(s.Id))
        {
            _activeId = s.Id;
            FocusShockerIntensity(s);
            return;
        }
        if (_selectedIds.Contains(s.Id))
        {
            var next = _selectedIds.Where(id => id != s.Id).ToList();
            if (next.Count == 0) return;
            _selectedIds = next;
            if (_activeId == s.Id)
            {
                _activeId = next[0];
                var fallback = Shockers.FirstOrDefault(x => x.Id == next[0]);
                if (fallback is not null) FocusShockerIntensity(fallback);
            }
        }
        else
        {
            _activeId = s.Id;
            FocusShockerIntensity(s);
            _selectedIds = [.. _selectedIds, s.Id];
        }
        ClampToLimits();
        SeedIfIndividual();
    }

    // ---- intensity ----
    private void SetActiveShockIntensity(int n)
    {
        var next = Clamp(n, 0, ShockEditCap);
        _shockIntensity = next;
        if (IndividualMode && Active is { } a) _perShock[a.MultiColorKey] = next;
    }

    private void SetShockMin(int n) => _shockMin = n;
    private void SetShockMax(int n) => _shockMax = n;
    private void SetVibIntensity(int n) => _vibIntensity = n;

    private static int RollIntensity(int min, int max)
    {
        var lo = Math.Min(min, max);
        var hi = Math.Max(min, max);
        return hi <= lo ? lo : lo + Rng.Next(hi - lo + 1);
    }

    private static string IntensityLabel(bool random, int value, int min, int max) =>
        random ? $"{Math.Min(min, max)}-{Math.Max(min, max)}" : value.ToString();

    private void NudgeShock(int delta)
    {
        var cap = ShockEditCap;
        var lo = Clamp(Math.Min(_shockMin, _shockMax), 0, cap);
        var hi = Clamp(Math.Max(_shockMin, _shockMax), 0, cap);
        if (!RandomActive)
        {
            SetActiveShockIntensity(Clamp(_shockIntensity + delta, 0, cap));
            return;
        }
        if (delta > 0) _shockMax = Clamp(hi + delta, lo, cap);
        else _shockMin = Clamp(lo + delta, 0, hi);
    }

    private void NudgeVibrate(int delta) => _vibIntensity = Clamp(_vibIntensity + delta, 0, MaxInt);

    private void ToggleShockRandom()
    {
        if (IndividualMode) return;
        var cap = ShockEditCap;
        if (!_shockRandom)
        {
            // Spread thumbs full range so they aren't stacked
            _shockMin = 0;
            _shockMax = cap;
        }
        else
        {
            SetActiveShockIntensity(Clamp((int)Math.Round((_shockMin + _shockMax) / 2.0), 0, cap));
        }
        _shockRandom = !_shockRandom;
    }

    private int ResolveShockIntensity() =>
        RandomActive
            ? Math.Max(1, RollIntensity(_shockMin, Math.Min(_shockMax, ShockEditCap)))
            : Math.Max(1, _shockIntensity == 0 ? 1 : _shockIntensity);

    private int ResolveShockIntensityFor(ShockerView s)
    {
        var cap = s.UsableIntensity;
        if (IndividualMode)
        {
            var stored = _perShock.GetValueOrDefault(s.MultiColorKey, _shockIntensity);
            var v = Clamp(stored, 0, cap);
            return Math.Max(1, v == 0 ? 1 : v);
        }
        if (_shockRandom) return Math.Max(1, RollIntensity(_shockMin, Math.Min(_shockMax, cap)));
        var c = Clamp(_shockIntensity, 0, cap);
        return Math.Max(1, c == 0 ? 1 : c);
    }

    // ---- firing ----
    private List<ShockerView> ResolveFireTargets(FireOpts? opts)
    {
        var active = Active;
        if (opts?.Target is { } t)
        {
            var existing = Shockers.FirstOrDefault(s => s.Id == t.ShockerId);
            var basis = existing ?? active;
            if (basis is null) return [];
            var copy = basis.Clone();
            copy.Id = t.ShockerId;
            copy.ClientId = t.ClientId ?? copy.ClientId;
            copy.ShareCode = t.ShareCode ?? copy.ShareCode;
            copy.TargetDiscordUserId = t.TargetDiscordUserId ?? copy.TargetDiscordUserId;
            return [copy];
        }
        // Hold stays single-target; multishock uses one-shot fan-out
        if (opts?.Hold == true || !_multiShock) return active is null ? [] : [active];
        return SelectedShockers;
    }

    private Task Dispatch(ShockerView shocker, string op, int intensity, int durationMs, WarningSpec? warning, bool hold)
    {
        // Per-person / per-shocker caps — never raise someone past their own limit
        var sMaxInt = shocker.UsableIntensity;
        var sMaxDur = shocker.UsableDuration;
        return OnOperate.InvokeAsync(new OfficialOperateInput
        {
            ShockerId = shocker.Id,
            ShareCode = shocker.ShareCode,
            ClientId = shocker.ClientId ?? Hub.Id,
            TargetDiscordUserId = shocker.TargetDiscordUserId,
            CanShock = shocker.CanShock,
            CanVibrate = shocker.CanVibrate,
            CanBeep = shocker.CanBeep,
            CanHold = shocker.CanHold,
            MaxIntensity = sMaxInt,
            MaxDuration = sMaxDur,
            Hold = hold,
            Warning = warning,
            Operation = op,
            Intensity = Clamp(intensity, 0, sMaxInt),
            DurationMs = Clamp(durationMs, 16, sMaxDur),
        });
    }

    private async Task Fire(string operation, int intensity, int durationMs, FireOpts? opts = null)
    {
        if (operation == "stop") return;
        if (ControlsLocked && operation != "end") return;
        var targets = ResolveFireTargets(opts);
        if (targets.Count == 0) return;
        var hold = opts?.Hold ?? false;
        var tasks = new List<Task>();

        // Vibrate-before-shock for SMALL / MID / LONG (fan-out to all targets)
        if (operation == "shock" && opts?.SkipWarning != true && !hold && _warningLevel != WarningLevel.None)
        {
            var preset = WarningPresets.Get(_warningLevel);
            var warnWaitMs = preset.DurationMs;
            foreach (var shocker in targets)
            {
                if (shocker.EmergencyStop || shocker.Paused || !shocker.CanVibrate) continue;
                var warnIntensity = Clamp(preset.Intensity, 1, shocker.UsableIntensity);
                var warnDuration = Clamp(preset.DurationMs, 16, shocker.UsableDuration);
                warnWaitMs = Math.Max(warnWaitMs, warnDuration);
                tasks.Add(Dispatch(shocker, "vibrate", warnIntensity, warnDuration, new WarningSpec
                {
                    Active = true,
                    Intensity = warnIntensity,
                    DurationMs = warnDuration,
                    Min = warnIntensity,
                    Max = warnIntensity,
                }, false));
            }

            ScheduleAfterWarning(warnWaitMs + WarningPresets.ShockGapMs, async () =>
            {
                if (ControlsLocked) return;
                var shockTasks = new List<Task>();
                foreach (var shocker in targets)
                {
                    if (shocker.EmergencyStop || shocker.Paused || !shocker.CanShock) continue;
                    var per = IndividualMode ? ResolveShockIntensityFor(shocker) : intensity;
                    shockTasks.Add(Dispatch(shocker, "shock", per, durationMs, null, false));
                }
                await Task.WhenAll(shockTasks);
            });
            await Task.WhenAll(tasks);
            return;
        }

        foreach (var shocker in targets)
        {
            if (operation != "end" && (shocker.EmergencyStop || shocker.Paused)) continue;
            if (operation == "shock" && !shocker.CanShock) continue;
            if (operation == "vibrate" && !shocker.CanVibrate) continue;
            if (operation == "beep" && !shocker.CanBeep) continue;
            var per = operation == "shock" && IndividualMode ? ResolveShockIntensityFor(shocker) : intensity;
            tasks.Add(Dispatch(shocker, operation, per, durationMs, null, hold));
        }
        await Task.WhenAll(tasks);
    }

    private void CancelWarning()
    {
        var cts = _warnCts;
        _warnCts = null;
        if (cts is null) return;
        try
        {
            cts.Cancel();
            cts.Dispose();
        }
        catch
        {
            // already disposed
        }
    }

    private void ScheduleAfterWarning(int delayMs, Func<Task> work)
    {
        CancelWarning();
        var cts = new CancellationTokenSource();
        _warnCts = cts;

        async Task Run()
        {
            try
            {
                await Task.Delay(delayMs, cts.Token);
            }
            catch (OperationCanceledException)
            {
                return;
            }
            if (ReferenceEquals(_warnCts, cts)) _warnCts = null;
            if (_disposed) return;
            try
            {
                await InvokeAsync(async () =>
                {
                    await work();
                    StateHasChanged();
                });
            }
            catch
            {
                // component disposed / operate failed (surfaced by the session)
            }
        }

        _ = Run();
    }

    // ---- hold ("Use Mode": press & hold) ----
    private async Task BeginHold(string operation, int intensity)
    {
        var active = Active;
        if (_multiShock || active is null || ControlsLocked || _holdingOp is not null) return;
        if (operation == "shock" && (!active.CanShock || active.Paused)) return;
        if (operation == "vibrate" && (!active.CanVibrate || active.Paused)) return;
        if (operation == "beep" && (!active.CanBeep || active.Paused)) return;

        _holdTarget = new HoldTarget(active.Id, active.ClientId ?? Hub.Id, active.ShareCode, active.TargetDiscordUserId);
        _holdingOp = operation;
        var maxDur = MaxDur;
        var maxInt = MaxInt;

        Task StartHold()
        {
            if (_holdingOp != operation) return Task.CompletedTask;
            // Hold for activity max; release sends broker end
            return Fire(operation, Math.Max(1, intensity), maxDur, new FireOpts(Hold: true, SkipWarning: true));
        }

        // Warn vibrate, then start continuous shock hold
        if (operation == "shock" && _warningLevel != WarningLevel.None && active.CanVibrate)
        {
            var preset = WarningPresets.Get(_warningLevel);
            await Fire(
                "vibrate",
                Clamp(preset.Intensity, 1, maxInt),
                Clamp(preset.DurationMs, 16, maxDur),
                new FireOpts(SkipWarning: true, Target: _holdTarget));
            if (_holdingOp == operation)
            {
                ScheduleAfterWarning(preset.DurationMs + WarningPresets.ShockGapMs, StartHold);
            }
            return;
        }

        await StartHold();
    }

    private async Task EndHoldAsync()
    {
        if (_holdingOp is null) return;
        var target = _holdTarget;
        _holdingOp = null;
        _holdTarget = null;
        CancelWarning();
        await Fire("end", 0, 16, new FireOpts(Target: target));
    }

    // ---- button handlers ----
    private Task ShockClick() => Fire("shock", ResolveShockIntensity(), _shockDurationMs);
    private Task VibrateClick() => Fire("vibrate", Math.Max(1, _vibIntensity == 0 ? 1 : _vibIntensity), _vibDurationMs);
    private Task BeepClick() => Fire("beep", 1, 300);
    private Task ShockHoldStart() => BeginHold("shock", ResolveShockIntensity());
    private Task VibrateHoldStart() => BeginHold("vibrate", Math.Max(1, _vibIntensity == 0 ? 1 : _vibIntensity));
    private Task BeepHoldStart() => BeginHold("beep", 1);

    private void ToggleTapMode()
    {
        if (_multiShock) return;
        if (_holdingOp is not null) _ = EndHoldAsync();
        _tapMode = !_tapMode;
    }

    private void CycleWarning() => _warningLevel = WarningPresets.Next(_warningLevel);

    private Task EmergencyStopClick()
    {
        var active = Active;
        if (active is null || !OnEmergencyStop.HasDelegate) return Task.CompletedTask;
        _warningLevel = WarningLevel.None;
        CancelWarning();
        return OnEmergencyStop.InvokeAsync(new EmergencyStopInput
        {
            ShockerId = active.Id,
            ClientId = active.ClientId ?? Hub.Id,
            Engaged = !EStop,
        });
    }

    private Task OpenSettingsClick() =>
        Active is { } a ? OnOpenShockerSettings.InvokeAsync(a) : Task.CompletedTask;

    private void ToggleDurationMenu(string which) => _durationMenu = _durationMenu == which ? null : which;

    private void SelectShockDuration(int ms)
    {
        _shockDurationMs = ms;
        _durationMenu = null;
    }

    private void SelectVibDuration(int ms)
    {
        _vibDurationMs = ms;
        _durationMenu = null;
    }

    /// <summary>Document-level "click away" replacement: menus stop propagation on mousedown.</summary>
    private void CloseMenus()
    {
        _durationMenu = null;
        _hubMenuOpen = false;
    }

    private Task OwnModeClick()
    {
        if (FriendsOpen) return OnOpenOwnShockers.InvokeAsync();
        _hubsOpen = !_hubsOpen;
        return Task.CompletedTask;
    }

    private async Task PingHubFromMenu()
    {
        _hubMenuOpen = false;
        await OnPingHub.InvokeAsync();
    }

    private string ChipStyle(ShockerView s, bool selected, bool focused)
    {
        if (!_multiShock) return "";
        var color = s.MultiColor;
        if (selected)
        {
            var outline = _individualIntensity && focused ? " outline: 2px solid #fff; outline-offset: 1px;" : "";
            return $"background: {color}; border-color: {color}; color: #121212;{outline}";
        }
        return $"background: transparent; border: 1px solid {color}; color: {color}; opacity: 0.55;";
    }

    private static string ChipLabel(ShockerView s, bool multi, int? setInt, int limit)
    {
        var prefix = multi && !string.IsNullOrEmpty(s.HubName) && !s.Owned ? $"{s.HubName}: " : "";
        var tail = multi ? (setInt is not null ? $" · {setInt}/{limit}%" : $" · {limit}%") : "";
        return $"{prefix}{s.Name}{tail}{(s.EmergencyStop ? " · E-STOP" : "")}";
    }
}
