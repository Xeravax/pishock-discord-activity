using System.Text.Json;
using PiShock.Activity.Server.Data;
using PiShock.Activity.Server.PiShock;
using PiShock.Activity.Server.Security;

namespace PiShock.Activity.Server.Endpoints;

/// <summary>Port of src/server/routes/pishock-session.ts (relay login → confirm → stored session).</summary>
public static class PiShockSessionEndpoints
{
    public static IEndpointRouteBuilder MapPiShockSessionEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapActivityApi();

        api.MapPost("/pishock/login/start", StartLoginAsync)
            .WithName("StartPiShockLogin")
            .WithTags("PiShockSession");

        api.MapGet("/pishock/login/status", GetLoginStatusAsync)
            .WithName("GetPiShockLoginStatus")
            .WithTags("PiShockSession");

        api.MapPost("/pishock/login/confirm", ConfirmLoginAsync)
            .WithName("ConfirmPiShockLogin")
            .WithTags("PiShockSession");

        api.MapPost("/pishock/login/cancel", CancelLogin)
            .WithName("CancelPiShockLogin")
            .WithTags("PiShockSession");

        api.MapDelete("/pishock/session", DeleteSessionAsync)
            .WithName("DeletePiShockSession")
            .WithTags("PiShockSession");

        return app;
    }

    private static async Task<IResult> StartLoginAsync(
        HttpContext ctx,
        RelayService relay,
        IServiceScopeFactory scopes)
    {
        if (!ctx.HasConsent())
        {
            return ApiResults.Error(403, "Consent required");
        }

        var discordUserId = ctx.DiscordUser().Id;
        try
        {
            PendingConfirmStore.ClearPendingConfirm(discordUserId);
            var start = await relay.StartRelayLoginAsync(discordUserId);

            // Wait for relay credentials in the background, but do NOT save until the user confirms.
            // Runs after the request ends, so it needs its own DI scope for the PiShock client.
            _ = Task.Run(async () =>
            {
                try
                {
                    var creds = await relay.AwaitRelayLoginAsync(discordUserId);
                    await using var scope = scopes.CreateAsyncScope();
                    var api = scope.ServiceProvider.GetRequiredService<PiShockApiClient>();
                    var hubNames = await SoftHubNamesAsync(api, new PiShockCreds(creds.UserId, creds.Token));
                    PendingConfirmStore.SetPendingConfirm(discordUserId, creds.UserId, creds.Token, hubNames);
                }
                catch
                {
                    // Status endpoint / poll will surface failure
                }
            });

            return ApiResults.Json(new { loginUrl = start.LoginUrl, channel = start.Channel });
        }
        catch (Exception err)
        {
            return ApiResults.Error(502, string.IsNullOrEmpty(err.Message) ? "Failed to start PiShock login" : err.Message);
        }
    }

    private static async Task<IResult> GetLoginStatusAsync(
        HttpContext ctx,
        RelayService relay,
        PiShockApiClient api)
    {
        var user = ctx.DiscordUser();

        var confirm = PendingConfirmStore.GetPendingConfirm(user.Id);
        if (confirm is not null)
        {
            return ConfirmStatus(user.Id, user.Username, user.GlobalName, confirm.UserId, confirm.HubNames);
        }

        var pendingStart = relay.GetPendingLogin(user.Id);
        Task<RelayCredentials>? completion = pendingStart is null ? null : relay.AwaitRelayLoginAsync(user.Id);
        var settled = completion?.IsCompleted ?? false;

        var linkedCreds = ctx.PiShockCreds();
        if (linkedCreds is not null && (completion is null || settled))
        {
            return ApiResults.Json(new { status = "linked", pishockUserId = linkedCreds.UserId });
        }
        if (pendingStart is null || completion is null)
        {
            return ApiResults.Json(new { status = "idle" });
        }
        if (settled)
        {
            try
            {
                var creds = await completion;
                var hubNames = await SoftHubNamesAsync(api, new PiShockCreds(creds.UserId, creds.Token));
                PendingConfirmStore.SetPendingConfirm(user.Id, creds.UserId, creds.Token, hubNames);
                return ConfirmStatus(user.Id, user.Username, user.GlobalName, creds.UserId, hubNames);
            }
            catch (Exception err)
            {
                return ApiResults.Json(new
                {
                    status = "error",
                    error = string.IsNullOrEmpty(err.Message) ? "Login failed" : err.Message,
                });
            }
        }

        return ApiResults.Json(new { status = "waiting", loginUrl = pendingStart.LoginUrl });
    }

    private static async Task<IResult> ConfirmLoginAsync(HttpContext ctx, SessionStore sessions)
    {
        if (!ctx.HasConsent())
        {
            return ApiResults.Error(403, "Consent required");
        }

        var discordUserId = ctx.DiscordUser().Id;
        var pending = PendingConfirmStore.TakePendingConfirm(discordUserId);
        if (pending is null)
        {
            return ApiResults.Error(404, "No PiShock login waiting for confirmation", "NO_PENDING_CONFIRM");
        }

        await sessions.SavePiShockSessionAsync(discordUserId, pending.UserId, pending.Token, ctx.RequestAborted);
        return ApiResults.Json(new
        {
            ok = true,
            pishockUserId = pending.UserId,
            hubNames = pending.HubNames,
        });
    }

    private static IResult CancelLogin(HttpContext ctx)
    {
        PendingConfirmStore.ClearPendingConfirm(ctx.DiscordUser().Id);
        return ApiResults.Json(new { ok = true });
    }

    private static async Task<IResult> DeleteSessionAsync(HttpContext ctx, SessionStore sessions)
    {
        var discordUserId = ctx.DiscordUser().Id;
        PendingConfirmStore.ClearPendingConfirm(discordUserId);
        await sessions.ClearPiShockSessionAsync(discordUserId, ctx.RequestAborted);
        return ApiResults.Json(new { ok = true });
    }

    private static IResult ConfirmStatus(
        string discordUserId,
        string username,
        string? globalName,
        int pishockUserId,
        IReadOnlyList<string> hubNames) =>
        ApiResults.Json(new
        {
            status = "confirm",
            pishockUserId,
            hubNames,
            discordUser = new
            {
                id = discordUserId,
                username,
                global_name = globalName,
            },
        });

    /// <summary>Up to five hub names for the confirm screen; any failure just means "no names".</summary>
    private static async Task<IReadOnlyList<string>> SoftHubNamesAsync(PiShockApiClient api, PiShockCreds creds)
    {
        try
        {
            var result = await api.GetHubsAsync(creds);
            if (result.Data is not { ValueKind: JsonValueKind.Array } rows) return [];

            var names = new List<string>();
            foreach (var row in rows.EnumerateArray())
            {
                var name = HubName(row);
                if (name.Length > 0) names.Add(name);
                if (names.Count == 5) break;
            }
            return names;
        }
        catch
        {
            return [];
        }
    }

    private static string HubName(JsonElement row)
    {
        if (row.ValueKind != JsonValueKind.Object) return "";
        foreach (var key in new[] { "Name", "name" })
        {
            if (!row.TryGetProperty(key, out var value) || value.ValueKind is JsonValueKind.Null) continue;
            return (value.ValueKind == JsonValueKind.String ? value.GetString() : value.ToString())?.Trim() ?? "";
        }
        return "";
    }
}
