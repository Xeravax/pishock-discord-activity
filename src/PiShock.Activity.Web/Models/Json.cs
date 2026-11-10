using System.Globalization;
using System.Text.Json;

namespace PiShock.Activity.Web.Models;

/// <summary>Tolerant JSON readers for the loosely-typed PiShock device payloads.</summary>
public static class Json
{
    public static bool TryGet(JsonElement el, out JsonElement value, params string[] names)
    {
        value = default;
        if (el.ValueKind != JsonValueKind.Object) return false;
        foreach (var name in names)
        {
            if (el.TryGetProperty(name, out var v) && v.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined))
            {
                value = v;
                return true;
            }
        }
        return false;
    }

    public static string? Str(JsonElement el, params string[] names)
    {
        if (!TryGet(el, out var v, names)) return null;
        return v.ValueKind switch
        {
            JsonValueKind.String => v.GetString(),
            JsonValueKind.Number => v.GetRawText(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            _ => null,
        };
    }

    public static double? Num(JsonElement el, params string[] names)
    {
        if (!TryGet(el, out var v, names)) return null;
        if (v.ValueKind == JsonValueKind.Number) return v.GetDouble();
        if (v.ValueKind == JsonValueKind.String &&
            double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var d)) return d;
        return null;
    }

    public static bool? Bool(JsonElement el, params string[] names)
    {
        if (!TryGet(el, out var v, names)) return null;
        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number => v.GetDouble() != 0,
            JsonValueKind.String => bool.TryParse(v.GetString(), out var b) ? b : null,
            _ => null,
        };
    }

    public static IEnumerable<JsonElement> Items(JsonElement el, params string[] names)
    {
        if (!TryGet(el, out var v, names)) yield break;
        if (v.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in v.EnumerateArray()) yield return item;
        }
    }

    /// <summary>Flatten an array, or an object whose values are arrays/objects (devices.shared shape).</summary>
    public static IEnumerable<JsonElement> FlattenList(JsonElement el, params string[] names)
    {
        if (!TryGet(el, out var v, names)) yield break;
        if (v.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in v.EnumerateArray()) yield return item;
        }
        else if (v.ValueKind == JsonValueKind.Object)
        {
            foreach (var prop in v.EnumerateObject())
            {
                if (prop.Value.ValueKind == JsonValueKind.Array)
                {
                    foreach (var item in prop.Value.EnumerateArray()) yield return item;
                }
                else if (prop.Value.ValueKind == JsonValueKind.Object)
                {
                    yield return prop.Value;
                }
            }
        }
    }
}
