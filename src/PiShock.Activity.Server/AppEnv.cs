using System.Text.RegularExpressions;

namespace PiShock.Activity.Server;

public sealed class AppEnv
{
    public required string DatabaseUrl { get; init; }
    public required string DiscordClientId { get; init; }
    public required string DiscordClientSecret { get; init; }
    public required string TokenKey { get; init; }
    public required string PublicUrl { get; init; }
    public int Port { get; init; } = 3000;
    public string? DiscordBotToken { get; init; }
    public string? DiscordPublicKey { get; init; }
    public bool RequireDiscordProxyAuth { get; init; }
    public bool AllowMissingBotInstanceCheck { get; init; }

    public static AppEnv LoadFromEnvironment()
    {
        var portRaw = Environment.GetEnvironmentVariable("PORT") ?? "3000";
        var port = int.TryParse(portRaw, out var p) ? p : 3000;
        var nodeEnv = Environment.GetEnvironmentVariable("NODE_ENV")
            ?? Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
        var requireProxyRaw = Environment.GetEnvironmentVariable("REQUIRE_DISCORD_PROXY_AUTH");
        var requireProxy =
            requireProxyRaw == "1"
            || (string.Equals(nodeEnv, "Production", StringComparison.OrdinalIgnoreCase)
                && requireProxyRaw != "0")
            || (string.Equals(nodeEnv, "production", StringComparison.OrdinalIgnoreCase)
                && requireProxyRaw != "0");

        return new AppEnv
        {
            DatabaseUrl = NormalizeDatabaseUrl(Required("DATABASE_URL")),
            DiscordClientId = Required("DISCORD_CLIENT_ID"),
            DiscordClientSecret = Required("DISCORD_CLIENT_SECRET"),
            TokenKey = Required("TOKEN_KEY"),
            PublicUrl = Required("PUBLIC_URL"),
            Port = port,
            DiscordBotToken = TrimOrNull(Environment.GetEnvironmentVariable("DISCORD_BOT_TOKEN")),
            DiscordPublicKey = TrimOrNull(Environment.GetEnvironmentVariable("DISCORD_PUBLIC_KEY")),
            RequireDiscordProxyAuth = requireProxy,
            AllowMissingBotInstanceCheck =
                Environment.GetEnvironmentVariable("ALLOW_MISSING_BOT_INSTANCE_CHECK") == "1"
                && !string.Equals(nodeEnv, "Production", StringComparison.OrdinalIgnoreCase)
                && !string.Equals(nodeEnv, "production", StringComparison.OrdinalIgnoreCase),
        };
    }

    private static string Required(string name)
    {
        var value = Environment.GetEnvironmentVariable(name)?.Trim();
        if (string.IsNullOrEmpty(value))
        {
            throw new InvalidOperationException(
                $"Missing required environment variable: {name}. Set it in .env / compose; the process will not start without it.");
        }
        return value;
    }

    /// <summary>
    /// Accept Prisma-style <c>postgresql://…?schema=public</c> URLs and keyword strings.
    /// Npgsql is given a keyword connection string; Prisma's <c>schema</c> query key is dropped
    /// (Postgres <c>public</c> is the default search path).
    /// </summary>
    internal static string NormalizeDatabaseUrl(string url)
    {
        if (string.IsNullOrWhiteSpace(url)) return url;
        var trimmed = url.Trim();
        if (!trimmed.Contains("://", StringComparison.Ordinal)) return trimmed;

        if (!Uri.TryCreate(trimmed, UriKind.Absolute, out var uri))
        {
            // Fallback: strip Prisma schema= query key only.
            trimmed = Regex.Replace(trimmed, @"([?&])schema=[^&]*", "$1", RegexOptions.IgnoreCase);
            trimmed = trimmed.Replace("?&", "?", StringComparison.Ordinal).TrimEnd('?', '&');
            return trimmed;
        }

        var user = Uri.UnescapeDataString(uri.UserInfo);
        string? username = null;
        string? password = null;
        var colon = user.IndexOf(':');
        if (colon >= 0)
        {
            username = user[..colon];
            password = user[(colon + 1)..];
        }
        else if (user.Length > 0)
        {
            username = user;
        }

        var db = uri.AbsolutePath.Trim('/');
        var port = uri.IsDefaultPort ? 5432 : uri.Port;
        var parts = new List<string>
        {
            $"Host={uri.Host}",
            $"Port={port}",
            $"Database={db}",
        };
        if (!string.IsNullOrEmpty(username)) parts.Add($"Username={username}");
        if (password is not null) parts.Add($"Password={password}");
        return string.Join(';', parts);
    }

    private static string? TrimOrNull(string? value)
    {
        var trimmed = value?.Trim();
        return string.IsNullOrEmpty(trimmed) ? null : trimmed;
    }
}
