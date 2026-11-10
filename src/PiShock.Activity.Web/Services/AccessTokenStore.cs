namespace PiShock.Activity.Web.Services;

/// <summary>Scoped Discord bearer used by <see cref="PiShock.Activity.ApiClient.DiscordBearerTokenProvider"/>.</summary>
public sealed class AccessTokenStore
{
    public string? Token { get; set; }
}
