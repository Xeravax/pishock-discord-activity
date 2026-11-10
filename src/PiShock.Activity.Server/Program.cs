using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using PiShock.Activity.Server;
using PiShock.Activity.Server.Data;
using PiShock.Activity.Server.Endpoints;
using PiShock.Activity.Server.Realtime;
using PiShock.Activity.Server.Security;

// Load .env if present (local docker-compose / developer convenience)
DotEnv.LoadIfPresent();

var env = AppEnv.LoadFromEnvironment();
var builder = WebApplication.CreateBuilder(args);

builder.WebHost.UseUrls($"http://0.0.0.0:{env.Port}");
builder.Services.AddSingleton(env);
builder.Services.AddHttpClient();
builder.Services.AddOpenApi();
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(env.DatabaseUrl));
builder.Services.AddSingleton<RealtimeHub>();
builder.Services.AddSingleton<PiShock.Activity.Server.PiShock.BrokerService>();
builder.Services.AddSingleton<PiShock.Activity.Server.PiShock.RelayService>();
builder.Services.AddScoped<PiShock.Activity.Server.PiShock.PiShockApiClient>();
builder.Services.AddScoped<PiShock.Activity.Server.Discord.DiscordAuthService>();
builder.Services.AddScoped<PiShock.Activity.Server.Data.SessionStore>();
builder.Services.AddScoped<ActivityAuthFilter>();

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    options.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
});

// Allow local/test boot without requiring all secrets when ASPNETCORE_ENVIRONMENT=Development
// and SKIP_ENV_CHECK=1. Production always uses AppEnv.LoadFromEnvironment() above.
var app = builder.Build();
var shuttingDown = false;
var appVersion = AppVersion.Load();

try
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await db.Database.MigrateAsync();
}
catch (Exception ex)
{
    app.Logger.LogWarning(ex, "Database migrate skipped or failed at startup");
}

// Registered first so this OnStarting callback runs last and overwrites any
// Cache-Control set by static files or endpoint results.
app.Use(async (ctx, next) =>
{
    ctx.Response.OnStarting(() =>
    {
        var headers = ctx.Response.Headers;
        headers.CacheControl = "no-store, no-cache, must-revalidate, max-age=0";
        headers.Pragma = "no-cache";
        headers.Expires = "0";
        // Cloudflare and other CDNs honor these even when a cache rule would otherwise keep the URL.
        headers["CDN-Cache-Control"] = "no-store";
        headers["Cloudflare-CDN-Cache-Control"] = "no-store";
        headers["Surrogate-Control"] = "no-store";
        return Task.CompletedTask;
    });
    await next();
});

// Rewrite Discord's /.proxy/... prefix before endpoint routing selects a match.
app.Use(async (ctx, next) =>
{
    if (ctx.Request.Path.StartsWithSegments("/.proxy", out var remaining))
    {
        ctx.Request.Path = remaining.HasValue ? remaining : "/";
    }
    await next();
});
app.UseRouting();
app.UseWebSockets();

app.UseBlazorFrameworkFiles();
app.UseStaticFiles();

app.MapOpenApi();
app.MapGet("/api/health", () =>
{
    var payload = HealthPayload(appVersion, shuttingDown);
    return shuttingDown ? Results.Json(payload, statusCode: 503) : Results.Json(payload);
}).WithName("GetHealth").AllowAnonymous();

app.MapGet("/api/version", () =>
{
    var payload = HealthPayload(appVersion, shuttingDown);
    return shuttingDown ? Results.Json(payload, statusCode: 503) : Results.Json(payload);
}).WithName("GetVersion").AllowAnonymous();

app.MapAuthEndpoints();
app.MapPiShockSessionEndpoints();
app.MapControlEndpoints();
app.MapActivityShareEndpoints();
app.MapParticipantEndpoints();
app.MapAnnouncementEndpoints();
app.MapRealtime();
app.MapFallbackToFile("index.html");

app.Lifetime.ApplicationStopping.Register(() =>
{
    shuttingDown = true;
    var hub = app.Services.GetRequiredService<RealtimeHub>();
    hub.BroadcastAll(new { type = "server_shutting_down", at = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() });
    Thread.Sleep(250);
    app.Services.GetRequiredService<PiShock.Activity.Server.PiShock.BrokerService>().CloseAll();
});

app.Run();

static object HealthPayload(AppVersionInfo version, bool shuttingDown) => new
{
    ok = !shuttingDown,
    shuttingDown,
    version = version.Label,
    sha = version.Sha,
    shortSha = version.ShortSha,
    @ref = version.Ref,
    refType = version.RefType,
    builtAt = version.BuiltAt,
    now = DateTime.UtcNow.ToString("O"),
};

public partial class Program;
