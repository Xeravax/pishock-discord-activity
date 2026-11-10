using System.Text.Json;
using Microsoft.JSInterop;

namespace PiShock.Activity.Web.Realtime;

/// <summary>JS interop facade over wwwroot/js/activitySocket.js (authenticated WebSocket with reconnect).</summary>
public sealed class ActivitySocket(IJSRuntime js) : IAsyncDisposable
{
    private DotNetObjectReference<ActivitySocket>? _self;
    public event Action<JsonElement>? OnEvent;

    public async Task ConnectAsync(string accessToken)
    {
        _self ??= DotNetObjectReference.Create(this);
        await js.InvokeVoidAsync("activitySocket.connect", accessToken, _self);
    }

    public async Task CloseAsync()
    {
        try { await js.InvokeVoidAsync("activitySocket.close"); } catch { /* ignore */ }
    }

    [JSInvokable]
    public void HandleEvent(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            OnEvent?.Invoke(doc.RootElement.Clone());
        }
        catch
        {
            // ignore malformed
        }
    }

    public async ValueTask DisposeAsync()
    {
        await CloseAsync();
        _self?.Dispose();
    }
}
