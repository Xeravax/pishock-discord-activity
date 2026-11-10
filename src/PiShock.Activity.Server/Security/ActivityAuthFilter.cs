using PiShock.Activity.Server.Data;
using PiShock.Activity.Server.Discord;
using PiShock.Activity.Server.Endpoints;
using PiShock.Activity.Server.PiShock;

namespace PiShock.Activity.Server.Security;

/// <summary>Keys used on <see cref="HttpContext.Items"/> by <see cref="ActivityAuthFilter"/>.</summary>
public static class AuthContextKeys
{
    public const string DiscordUser = "DiscordUser";
    public const string PiShockCreds = "PiShockCreds";
    public const string HasConsent = "HasConsent";
}

/// <summary>
/// Port of src/server/auth-plugin.ts. Requires a Discord bearer token on every <c>/api/*</c> endpoint except the
/// public ones, then publishes the resolved Discord user, consent flag and PiShock credentials on
/// <see cref="HttpContext.Items"/> (read them with <see cref="AuthHttpContextExtensions"/>).
/// </summary>
public class ActivityAuthFilter(DiscordAuthService discord, SessionStore sessions) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        if (IsPublic(http.Request)) return await next(context);

        var token = ExtractBearer(http.Request);
        if (token is null)
        {
            return ApiResults.Error(401, "Missing Discord bearer token");
        }

        try
        {
            var user = await discord.ResolveBearerUserAsync(token, http.RequestAborted);
            http.Items[AuthContextKeys.DiscordUser] = user;
            http.Items[AuthContextKeys.HasConsent] = await sessions.GetConsentAsync(user.Id, http.RequestAborted);
            http.Items[AuthContextKeys.PiShockCreds] =
                await sessions.LoadPiShockCredsAsync(user.Id, http.RequestAborted);
        }
        catch (DiscordAuthError err)
        {
            return ApiResults.Error(err.Status, err.Message);
        }

        return await next(context);
    }

    /// <summary>Routes that never need a bearer token.</summary>
    private static bool IsPublic(HttpRequest request)
    {
        var path = request.Path.Value ?? "";
        if (path.Length > 1 && path.EndsWith('/')) path = path[..^1];

        if (!path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase)) return true;
        if (path.Equals("/api/health", StringComparison.OrdinalIgnoreCase)) return true;
        if (path.Equals("/api/version", StringComparison.OrdinalIgnoreCase)) return true;
        // Public marketing banner from the PiShock dashboard
        if (path.Equals("/api/announcements", StringComparison.OrdinalIgnoreCase)
            && HttpMethods.IsGet(request.Method)) return true;
        // WebSocket upgrade authenticates itself (header/query token or first-message auth frame)
        if (path.Equals("/api/ws", StringComparison.OrdinalIgnoreCase)) return true;
        // Discord code exchange has no bearer yet
        if (path.Equals("/api/auth/discord", StringComparison.OrdinalIgnoreCase)
            && HttpMethods.IsPost(request.Method)) return true;
        return false;
    }

    private static string? ExtractBearer(HttpRequest request)
    {
        var header = request.Headers.Authorization.FirstOrDefault();
        if (header is null || !header.StartsWith("Bearer ", StringComparison.Ordinal)) return null;
        var token = header["Bearer ".Length..].Trim();
        return token.Length == 0 ? null : token;
    }
}

public static class AuthHttpContextExtensions
{
    public static DiscordUserInfo DiscordUser(this HttpContext ctx) =>
        (DiscordUserInfo)ctx.Items[AuthContextKeys.DiscordUser]!;

    public static bool HasConsent(this HttpContext ctx) =>
        ctx.Items[AuthContextKeys.HasConsent] is true;

    public static PiShockCreds? PiShockCreds(this HttpContext ctx) =>
        ctx.Items[AuthContextKeys.PiShockCreds] as PiShockCreds;

    /// <summary>
    /// <c>/api</c> route group guarded by <see cref="ActivityAuthFilter"/>. Every endpoint file maps its routes
    /// on one of these so the filter (and its public-route allow-list) applies uniformly.
    /// </summary>
    public static RouteGroupBuilder MapActivityApi(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api");
        group.AddEndpointFilter<ActivityAuthFilter>();
        return group;
    }
}
