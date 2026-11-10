using System.Text.Json;
using System.Text.Json.Serialization;

namespace PiShock.Activity.Web.Models;

/// <summary>Warning vibrate-before-shock levels.</summary>
public enum WarningLevel { None, Small, Mid, Long }

public sealed record WarningPreset(int Intensity, int DurationMs, string Label);

public static class WarningPresets
{
    /// <summary>Extra settle time after the warning vibe ends before the shock is sent.</summary>
    public const int ShockGapMs = 350;

    public static WarningPreset Get(WarningLevel level) => level switch
    {
        WarningLevel.Small => new(25, 500, "SMALL"),
        WarningLevel.Mid => new(50, 500, "MID"),
        WarningLevel.Long => new(50, 1000, "LONG"),
        _ => new(0, 0, "None"),
    };

    public static WarningLevel Next(WarningLevel level) => level switch
    {
        WarningLevel.None => WarningLevel.Small,
        WarningLevel.Small => WarningLevel.Mid,
        WarningLevel.Mid => WarningLevel.Long,
        _ => WarningLevel.None,
    };

    public static string ButtonLabel(WarningLevel level) =>
        level == WarningLevel.None ? "None" : Get(level).Label;

    public static string ToKey(WarningLevel level) => level.ToString().ToLowerInvariant();

    public static WarningLevel FromKey(string? key) => key?.ToLowerInvariant() switch
    {
        "small" => WarningLevel.Small,
        "mid" => WarningLevel.Mid,
        "long" => WarningLevel.Long,
        _ => WarningLevel.None,
    };
}

/// <summary>Context handed to the friends-panel render fragment (multishock controls live in the controller).</summary>
public sealed record FriendsPanelContext(
    bool MultiShock,
    Microsoft.AspNetCore.Components.EventCallback OnToggleMultiShock,
    bool IndividualIntensity,
    Microsoft.AspNetCore.Components.EventCallback OnToggleIndividualIntensity);

/// <summary>Per-person limit tick shown on slider / duration chips in multishock mode.</summary>
public sealed record LimitMarker(
    string Key,
    string Color,
    int Intensity,
    int? Value,
    int DurationMs,
    string Label);

/// <summary>Persisted remote control state (localStorage <c>pishock.official-controls.v1</c>).</summary>
public sealed class ControlPrefs
{
    public const string StorageKey = "pishock.official-controls.v1";

    [JsonPropertyName("shockIntensity")] public int ShockIntensity { get; set; }
    [JsonPropertyName("shockDurationMs")] public int ShockDurationMs { get; set; } = 300;
    [JsonPropertyName("shockRandom")] public bool ShockRandom { get; set; }
    [JsonPropertyName("shockMin")] public int ShockMin { get; set; }
    [JsonPropertyName("shockMax")] public int ShockMax { get; set; } = 100;
    [JsonPropertyName("vibIntensity")] public int VibIntensity { get; set; } = 69;
    [JsonPropertyName("vibDurationMs")] public int VibDurationMs { get; set; } = 1000;
    [JsonPropertyName("warningLevel")] public string WarningLevelKey { get; set; } = "none";
    [JsonPropertyName("tapMode")] public bool TapMode { get; set; }
    [JsonPropertyName("multiShock")] public bool MultiShock { get; set; }
    [JsonPropertyName("individualIntensity")] public bool IndividualIntensity { get; set; }
    [JsonPropertyName("perShockIntensity")] public Dictionary<string, int> PerShockIntensity { get; set; } = [];
    [JsonPropertyName("activeId")] public int? ActiveId { get; set; }

    public static ControlPrefs Parse(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return new ControlPrefs();
        try
        {
            // Tolerant parse: the React client may have written slightly different numeric types.
            using var doc = JsonDocument.Parse(raw);
            var r = doc.RootElement;
            var p = new ControlPrefs
            {
                ShockIntensity = (int)(Json.Num(r, "shockIntensity") ?? 0),
                ShockDurationMs = (int)(Json.Num(r, "shockDurationMs") ?? 300),
                ShockRandom = Json.Bool(r, "shockRandom") ?? false,
                ShockMin = (int)(Json.Num(r, "shockMin") ?? 0),
                ShockMax = (int)(Json.Num(r, "shockMax") ?? 100),
                VibIntensity = (int)(Json.Num(r, "vibIntensity") ?? 69),
                VibDurationMs = (int)(Json.Num(r, "vibDurationMs") ?? 1000),
                WarningLevelKey = Json.Str(r, "warningLevel") ?? ((Json.Bool(r, "warningOn") ?? false) ? "small" : "none"),
                TapMode = Json.Bool(r, "tapMode") ?? false,
                MultiShock = Json.Bool(r, "multiShock") ?? false,
                IndividualIntensity = Json.Bool(r, "individualIntensity") ?? false,
                ActiveId = Json.Num(r, "activeId") is { } a ? (int)a : null,
            };
            if (r.TryGetProperty("perShockIntensity", out var per) && per.ValueKind == JsonValueKind.Object)
            {
                foreach (var prop in per.EnumerateObject())
                {
                    if (prop.Value.ValueKind == JsonValueKind.Number && prop.Value.TryGetDouble(out var d))
                        p.PerShockIntensity[prop.Name] = (int)d;
                }
            }
            return p;
        }
        catch
        {
            return new ControlPrefs();
        }
    }
}
