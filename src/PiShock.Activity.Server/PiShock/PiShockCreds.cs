using System.Text.Json;

namespace PiShock.Activity.Server.PiShock;

public sealed record PiShockCreds(int UserId, string Token);

public sealed class ControlSnapshot
{
    public List<JsonElement> Hubs { get; init; } = [];
    public List<JsonElement> Shockers { get; init; } = [];
    public List<JsonElement> Shared { get; init; } = [];
    public List<JsonElement> Links { get; init; } = [];
}

public sealed class PiShockApiError : Exception
{
    public int Status { get; }
    public string Body { get; }
    public bool NeedsRelogin => Status == 401;

    public PiShockApiError(int status, string body)
        : base($"PiShock API {status}: {body}")
    {
        Status = status;
        Body = body;
    }
}
