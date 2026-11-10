using System.Text.Json;

namespace PiShock.Activity.ApiClient;

/// <summary>
/// Client-side API failure shaped like React <c>src/client/api.ts</c> <c>ApiError</c>:
/// message from <c>body.error</c> (or <c>HTTP {status}</c>), plus optional <c>code</c>.
/// </summary>
public sealed class ApiError : Exception
{
    public int Status { get; }
    public string Error { get; }
    public string? Code { get; }
    public object? Body { get; }

    public ApiError(int status, object? body)
        : base(ExtractError(status, body))
    {
        Status = status;
        Body = body;
        Error = ExtractError(status, body);
        Code = ExtractCode(body);
    }

    private static string ExtractError(int status, object? body)
    {
        if (body is JsonElement el && el.ValueKind == JsonValueKind.Object
            && el.TryGetProperty("error", out var err))
        {
            return err.ValueKind switch
            {
                JsonValueKind.String => err.GetString() ?? $"HTTP {status}",
                JsonValueKind.Null or JsonValueKind.Undefined => $"HTTP {status}",
                _ => err.ToString(),
            };
        }

        if (body is string s && !string.IsNullOrWhiteSpace(s))
            return s;

        return $"HTTP {status}";
    }

    private static string? ExtractCode(object? body)
    {
        if (body is JsonElement el && el.ValueKind == JsonValueKind.Object
            && el.TryGetProperty("code", out var code)
            && code.ValueKind != JsonValueKind.Null
            && code.ValueKind != JsonValueKind.Undefined)
        {
            return code.ValueKind == JsonValueKind.String ? code.GetString() : code.ToString();
        }

        return null;
    }
}
