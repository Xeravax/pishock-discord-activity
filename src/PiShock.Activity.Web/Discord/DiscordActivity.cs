using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.JSInterop;

namespace PiShock.Activity.Web.Discord;

public sealed class DiscordAuthResult
{
    [JsonPropertyName("accessToken")]
    public string AccessToken { get; set; } = "";

    [JsonPropertyName("userId")]
    public string UserId { get; set; } = "";

    [JsonPropertyName("username")]
    public string Username { get; set; } = "";

    [JsonPropertyName("globalName")]
    public string? GlobalName { get; set; }

    [JsonPropertyName("avatar")]
    public string? Avatar { get; set; }
}

public sealed class ActivityLocationHint
{
    [JsonPropertyName("guildId")]
    public string? GuildId { get; set; }

    [JsonPropertyName("channelId")]
    public string? ChannelId { get; set; }

    [JsonPropertyName("locationKind")]
    public string? LocationKind { get; set; }

    [JsonPropertyName("locationName")]
    public string? LocationName { get; set; }

    [JsonPropertyName("locationIconUrl")]
    public string? LocationIconUrl { get; set; }
}

/// <summary>JS interop facade over wwwroot/js/discordSdk.js (Discord Embedded App SDK).</summary>
public sealed class DiscordActivity(IJSRuntime js)
{
    /// <param name="layoutCallback">Object exposing <c>[JSInvokable] OnLayoutChanged(bool pip)</c>.</param>
    public async Task<DiscordAuthResult> BootstrapAsync<T>(DotNetObjectReference<T>? layoutCallback = null)
        where T : class
    {
        return await js.InvokeAsync<DiscordAuthResult>("discordSdk.bootstrap", layoutCallback);
    }

    public ValueTask<DiscordAuthResult> BootstrapAsync() =>
        js.InvokeAsync<DiscordAuthResult>("discordSdk.bootstrap");

    public ValueTask<bool> IsEmbeddedAsync() => js.InvokeAsync<bool>("discordSdk.isEmbedded");

    public ValueTask OpenExternalAsync(string url) =>
        js.InvokeVoidAsync("discordSdk.openExternal", url);

    public ValueTask<string?> GetInstanceIdAsync() =>
        js.InvokeAsync<string?>("discordSdk.getInstanceId");

    public ValueTask<JsonElement> GetParticipantsAsync() =>
        js.InvokeAsync<JsonElement>("discordSdk.getParticipants");

    /// <param name="callback">Object exposing <c>[JSInvokable] OnParticipantsUpdate(string json)</c>.</param>
    public ValueTask SubscribeParticipantsAsync<T>(DotNetObjectReference<T> callback) where T : class =>
        js.InvokeVoidAsync("discordSdk.subscribeParticipants", callback);

    public ValueTask UnsubscribeParticipantsAsync() =>
        js.InvokeVoidAsync("discordSdk.unsubscribeParticipants");

    public ValueTask<ActivityLocationHint?> ResolveLocationHintAsync(string accessToken) =>
        js.InvokeAsync<ActivityLocationHint?>("discordSdk.resolveLocationHint", accessToken);

    public ValueTask<bool> IsCompactViewportAsync() => js.InvokeAsync<bool>("discordSdk.isCompactViewport");
}
