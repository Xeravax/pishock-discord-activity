using System.Text.Json;

namespace PiShock.Activity.Server;

public sealed class AppVersionInfo
{
    public string Label { get; init; } = "dev";
    public string Version { get; init; } = "dev";
    public string Sha { get; init; } = "unknown";
    public string ShortSha { get; init; } = "unknown";
    public string Ref { get; init; } = "local";
    public string RefType { get; init; } = "branch";
    public string BuiltAt { get; init; } = DateTime.UnixEpoch.ToString("O");
}

public static class AppVersion
{
    public static AppVersionInfo Load()
    {
        var fromEnv = Environment.GetEnvironmentVariable("APP_VERSION")?.Trim();
        if (!string.IsNullOrEmpty(fromEnv))
        {
            var sha = Environment.GetEnvironmentVariable("GIT_SHA") ?? "unknown";
            return new AppVersionInfo
            {
                Label = fromEnv,
                Version = fromEnv,
                Sha = sha,
                ShortSha = sha.Length >= 7 ? sha[..7] : sha,
                Ref = Environment.GetEnvironmentVariable("GIT_REF_NAME") ?? "local",
                RefType = Environment.GetEnvironmentVariable("GIT_REF_TYPE") ?? "branch",
                BuiltAt = Environment.GetEnvironmentVariable("APP_BUILT_AT") ?? DateTime.UtcNow.ToString("O"),
            };
        }

        var candidates = new[]
        {
            Path.Combine(Directory.GetCurrentDirectory(), "version.json"),
            Path.Combine(AppContext.BaseDirectory, "version.json"),
            Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "version.json"),
        };
        foreach (var candidate in candidates)
        {
            var info = TryRead(candidate);
            if (info is not null) return info;
        }

        return new AppVersionInfo { BuiltAt = DateTime.UtcNow.ToString("O") };
    }

    private static AppVersionInfo? TryRead(string filePath)
    {
        try
        {
            if (!File.Exists(filePath)) return null;
            using var doc = JsonDocument.Parse(File.ReadAllText(filePath));
            var root = doc.RootElement;
            if (!root.TryGetProperty("label", out var labelEl)) return null;
            var label = labelEl.GetString() ?? "";
            if (string.IsNullOrEmpty(label)) return null;
            var sha = root.TryGetProperty("sha", out var shaEl) ? shaEl.GetString() ?? "unknown" : "unknown";
            return new AppVersionInfo
            {
                Label = label,
                Version = root.TryGetProperty("version", out var v) ? v.GetString() ?? label : label,
                Sha = sha,
                ShortSha = root.TryGetProperty("shortSha", out var ss)
                    ? ss.GetString() ?? sha[..Math.Min(7, sha.Length)]
                    : sha[..Math.Min(7, sha.Length)],
                Ref = root.TryGetProperty("ref", out var r) ? r.GetString() ?? "local" : "local",
                RefType = root.TryGetProperty("refType", out var rt) ? rt.GetString() ?? "branch" : "branch",
                BuiltAt = root.TryGetProperty("builtAt", out var b)
                    ? b.GetString() ?? DateTime.UnixEpoch.ToString("O")
                    : DateTime.UnixEpoch.ToString("O"),
            };
        }
        catch
        {
            return null;
        }
    }
}
