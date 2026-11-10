using System.Text.Json;

namespace PiShock.Activity.Server.Security;

public static class Consent
{
    public static readonly string[] SafetyAckItems =
    [
        "I accept full responsibility for safe use and understand my actions will deliver real electronic shocks to other users",
        "I understand device owners can block me and developers cannot override these blocks or restore my access",
        "I understand this controls real electronic shock devices physically attached to other users",
        "I understand developers bear no liability for any harm, injury, or adverse effects from using this application",
        "I confirm voluntary participation with full knowledge of risks",
    ];

    public const int SafetyAckVersion = 1;

    public static ConsentValidationResult ValidateAcknowledgements(JsonElement? body)
    {
        if (body is null || body.Value.ValueKind != JsonValueKind.Object)
        {
            return ConsentValidationResult.Fail("Consent body required");
        }

        var row = body.Value;
        if (!row.TryGetProperty("acknowledged", out var ack) || ack.ValueKind != JsonValueKind.True)
        {
            return ConsentValidationResult.Fail("All safety items must be acknowledged");
        }

        if (row.TryGetProperty("version", out var version) && version.ValueKind != JsonValueKind.Null)
        {
            var versionNumber = version.ValueKind switch
            {
                JsonValueKind.Number => version.GetInt32(),
                JsonValueKind.String when int.TryParse(version.GetString(), out var n) => n,
                _ => int.MinValue,
            };
            if (versionNumber != SafetyAckVersion)
            {
                return ConsentValidationResult.Fail("Outdated safety acknowledgement version");
            }
        }

        if (!row.TryGetProperty("items", out var itemsEl) || itemsEl.ValueKind != JsonValueKind.Array)
        {
            return ConsentValidationResult.Fail("Consent items required");
        }

        var items = itemsEl.EnumerateArray().Select(x => x.ToString()).ToList();
        if (items.Count != SafetyAckItems.Length)
        {
            return ConsentValidationResult.Fail("All safety items must be acknowledged");
        }

        for (var i = 0; i < SafetyAckItems.Length; i++)
        {
            if (items[i] != SafetyAckItems[i])
            {
                return ConsentValidationResult.Fail("Safety acknowledgement text mismatch");
            }
        }

        return ConsentValidationResult.Success();
    }

    public static ConsentValidationResult ValidateAcknowledgements(object? body)
    {
        if (body is null) return ConsentValidationResult.Fail("Consent body required");
        if (body is JsonElement je) return ValidateAcknowledgements(je);
        if (body is ConsentRequest req)
        {
            if (req.Acknowledged != true)
                return ConsentValidationResult.Fail("All safety items must be acknowledged");
            if (req.Version is not null && req.Version != SafetyAckVersion)
                return ConsentValidationResult.Fail("Outdated safety acknowledgement version");
            if (req.Items is null)
                return ConsentValidationResult.Fail("Consent items required");
            if (req.Items.Count != SafetyAckItems.Length)
                return ConsentValidationResult.Fail("All safety items must be acknowledged");
            for (var i = 0; i < SafetyAckItems.Length; i++)
            {
                if (req.Items[i] != SafetyAckItems[i])
                    return ConsentValidationResult.Fail("Safety acknowledgement text mismatch");
            }
            return ConsentValidationResult.Success();
        }

        var json = JsonSerializer.SerializeToElement(body);
        return ValidateAcknowledgements(json);
    }
}

public sealed class ConsentRequest
{
    public bool? Acknowledged { get; set; }
    public int? Version { get; set; }
    public List<string>? Items { get; set; }
}

public readonly struct ConsentValidationResult
{
    public bool Ok { get; }
    public string? Error { get; }

    private ConsentValidationResult(bool ok, string? error)
    {
        Ok = ok;
        Error = error;
    }

    public static ConsentValidationResult Success() => new(true, null);
    public static ConsentValidationResult Fail(string error) => new(false, error);
}
