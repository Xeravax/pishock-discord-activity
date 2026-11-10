using PiShock.Activity.Server.Data;
using PiShock.Activity.Server.Discord;
using PiShock.Activity.Server.Security;

namespace PiShock.Activity.Server.Endpoints;

/// <summary>Port of src/server/routes/auth.ts.</summary>
public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapActivityApi();

        api.MapPost("/auth/discord", ExchangeDiscordCodeAsync)
            .WithName("ExchangeDiscordCode")
            .WithTags("Auth")
            .AllowAnonymous();

        api.MapGet("/me", GetMeAsync)
            .WithName("GetMe")
            .WithTags("Auth");

        api.MapPost("/consent", AcceptConsentAsync)
            .WithName("AcceptConsent")
            .WithTags("Auth");

        api.MapDelete("/consent", RevokeConsentAsync)
            .WithName("RevokeConsent")
            .WithTags("Auth");

        return app;
    }

    private static async Task<IResult> ExchangeDiscordCodeAsync(
        DiscordCodeRequest? body,
        DiscordAuthService discord,
        HttpContext ctx)
    {
        if (string.IsNullOrEmpty(body?.Code))
        {
            return ApiResults.Error(400, "Missing code");
        }

        try
        {
            var result = await discord.ExchangeDiscordCodeAsync(body.Code, ctx.RequestAborted);
            return ApiResults.Json(new
            {
                access_token = result.AccessToken,
                token_type = result.TokenType,
                expires_in = result.ExpiresIn,
                user = new
                {
                    id = result.User.Id,
                    username = result.User.Username,
                    global_name = result.User.GlobalName,
                    avatar = result.User.Avatar,
                },
            });
        }
        catch (DiscordAuthError err)
        {
            return ApiResults.Error(err.Status, err.Message);
        }
    }

    private static async Task<IResult> GetMeAsync(HttpContext ctx, SessionStore sessions)
    {
        var user = ctx.DiscordUser();
        var creds = ctx.PiShockCreds();

        // Same scoped DbContext: queries must run one after another.
        var personal = await sessions.GetPersonalActivityLimitsAsync(user.Id, ctx.RequestAborted);
        var emergencyStopShockerIds = await sessions.GetEmergencyStopShockerIdsAsync(user.Id, ctx.RequestAborted);

        return ApiResults.Json(new
        {
            user = new
            {
                id = user.Id,
                username = user.Username,
                global_name = user.GlobalName,
                avatar = user.Avatar,
            },
            consent = ctx.HasConsent(),
            consentVersion = Consent.SafetyAckVersion,
            safetyItems = Consent.SafetyAckItems,
            pishockLinked = creds is not null,
            pishockUserId = creds?.UserId,
            personal = ApiResults.Personal(personal),
            emergencyStopShockerIds,
        });
    }

    private static async Task<IResult> AcceptConsentAsync(HttpContext ctx, SessionStore sessions)
    {
        var body = await ApiResults.ReadJsonAsync(ctx.Request, ctx.RequestAborted);
        var check = Consent.ValidateAcknowledgements(body);
        if (!check.Ok)
        {
            return ApiResults.Error(400, check.Error ?? "Invalid consent", "CONSENT_INVALID");
        }

        await sessions.SetConsentAsync(ctx.DiscordUser().Id, ctx.RequestAborted);
        return ApiResults.Json(new { ok = true, consent = true, version = Consent.SafetyAckVersion });
    }

    private static async Task<IResult> RevokeConsentAsync(HttpContext ctx, SessionStore sessions)
    {
        await sessions.ClearConsentAsync(ctx.DiscordUser().Id, ctx.RequestAborted);
        return ApiResults.Json(new { ok = true, consent = false });
    }
}

public sealed class DiscordCodeRequest
{
    public string? Code { get; set; }
}
