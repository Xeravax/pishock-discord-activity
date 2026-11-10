using System.Text.Json;
using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;
using PiShock.Activity.Web.Models;

namespace PiShock.Activity.Web.Services;

public enum AppHealthStatus
{
    Unknown,
    Ok,
    Down,
    Restarting,
    Outdated,
}

/// <summary>
/// Port of hooks/useAppHealth.ts. Polls /api/health via browser <c>fetch</c> (JS interop),
/// tracks restarts and build-version drift. HttpClient is intentionally not used here —
/// in Discord/WASM that client was not issuing the poll while the overlay stayed up.
/// </summary>
public sealed class AppHealthService(IJSRuntime js, NavigationManager nav)
{
    public static readonly TimeSpan OutdatedGrace = TimeSpan.FromMinutes(3);
    private static readonly TimeSpan PollOnline = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan PollOffline = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan PollOutdated = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan ReloadCooldown = TimeSpan.FromSeconds(20);
    private const string ReloadFlagKey = "pishock.forcedReloadAt";

    private bool _started;
    private bool _inFlight;
    private bool _reloadArmed;
    private CancellationTokenSource _wake = new();

    public event Action? Changed;

    public AppHealthStatus Status { get; private set; } = AppHealthStatus.Unknown;
    public string BootVersion { get; private set; } = "dev";
    public string? ServerVersion { get; private set; }
    public long? OutdatedSince { get; private set; }
    public long? ForceReloadAt { get; private set; }

    public bool Restarting => Status is AppHealthStatus.Restarting or AppHealthStatus.Down;
    public bool Outdated => Status == AppHealthStatus.Outdated;
    public string Label => ServerVersion ?? BootVersion;

    public string StatusLabel => Status switch
    {
        AppHealthStatus.Ok => "Online",
        AppHealthStatus.Outdated => "Update available",
        AppHealthStatus.Restarting => "Restarting",
        AppHealthStatus.Down => "Unreachable",
        _ => "Checking",
    };

    private static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    public void Start()
    {
        if (_started) return;
        _started = true;
        _ = LoopAsync();
    }

    private async Task LoopAsync()
    {
        while (true)
        {
            try
            {
                await TickAsync();
            }
            catch
            {
                // never let the poll loop die
            }

            var delay = Status switch
            {
                AppHealthStatus.Outdated => PollOutdated,
                AppHealthStatus.Ok => PollOnline,
                _ => PollOffline,
            };
            try
            {
                await Task.Delay(delay, _wake.Token);
            }
            catch (TaskCanceledException)
            {
                _wake = new CancellationTokenSource();
            }
        }
    }

    private void SetState(
        AppHealthStatus status,
        string? serverVersion,
        long? outdatedSince,
        long? forceReloadAt)
    {
        var cadenceChanged = status != Status;
        Status = status;
        ServerVersion = serverVersion ?? ServerVersion;
        OutdatedSince = outdatedSince;
        ForceReloadAt = forceReloadAt;
        Changed?.Invoke();
        if (cadenceChanged) _wake.Cancel();
    }

    private bool VersionsDiffer(string? serverVersion)
    {
        if (string.IsNullOrEmpty(serverVersion)) return false;
        if (BootVersion == "dev" && serverVersion == "dev") return false;
        return serverVersion != BootVersion;
    }

    private async Task<bool> RecentlyForcedReloadAsync()
    {
        try
        {
            var raw = await js.InvokeAsync<string?>("sessionStorage.getItem", ReloadFlagKey);
            return long.TryParse(raw, out var at) && NowMs() - at < ReloadCooldown.TotalMilliseconds;
        }
        catch
        {
            return false;
        }
    }

    public async Task ReloadAppAsync()
    {
        if (_reloadArmed) return;
        _reloadArmed = true;
        try
        {
            await js.InvokeVoidAsync("sessionStorage.setItem", ReloadFlagKey, NowMs().ToString());
        }
        catch
        {
            // ignore
        }
        nav.NavigateTo(nav.Uri, forceLoad: true);
    }

    public void MarkServerShuttingDown()
    {
        SetState(AppHealthStatus.Restarting, null, null, null);
        _ = TickAsync();
    }

    private async Task<JsonElement?> FetchHealthAsync()
    {
        try
        {
            var el = await js.InvokeAsync<JsonElement>("activitySocket.fetchHealth");
            if (el.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null) return null;
            return el.Clone();
        }
        catch
        {
            return null;
        }
    }

    private async Task TickAsync()
    {
        if (_inFlight) return;
        _inFlight = true;
        try
        {
            var info = await FetchHealthAsync();
            if (info is null)
            {
                SetState(Status == AppHealthStatus.Restarting ? AppHealthStatus.Restarting : AppHealthStatus.Down,
                    null, null, null);
                return;
            }

            var root = info.Value;
            var shuttingDown = Json.Bool(root, "shuttingDown") == true;
            var ok = Json.Bool(root, "ok") != false;
            var serverVersion = Json.Str(root, "version");

            if (shuttingDown || !ok)
            {
                SetState(AppHealthStatus.Restarting, serverVersion, null, null);
                return;
            }

            if (BootVersion == "dev" && !string.IsNullOrEmpty(serverVersion) && Status == AppHealthStatus.Unknown)
            {
                BootVersion = serverVersion;
            }

            var wasRestarting = Status is AppHealthStatus.Restarting or AppHealthStatus.Down;
            var mismatch = VersionsDiffer(serverVersion);

            if (wasRestarting && mismatch && !await RecentlyForcedReloadAsync())
            {
                SetState(AppHealthStatus.Outdated, serverVersion, NowMs(), NowMs());
                await ReloadAppAsync();
                return;
            }

            if (mismatch)
            {
                var since = OutdatedSince ?? NowMs();
                var forceAt = since + (long)OutdatedGrace.TotalMilliseconds;
                SetState(AppHealthStatus.Outdated, serverVersion, since, forceAt);
                if (NowMs() >= forceAt && !await RecentlyForcedReloadAsync())
                {
                    await ReloadAppAsync();
                }
                return;
            }

            SetState(AppHealthStatus.Ok, serverVersion, null, null);
        }
        finally
        {
            _inFlight = false;
        }
    }
}
