using System.Text.Json.Serialization;

namespace PiShock.Activity.ApiClient;

public sealed class MeResponse
{
    [JsonPropertyName("consent")]
    public bool Consent { get; set; }

    [JsonPropertyName("pishockLinked")]
    public bool PishockLinked { get; set; }

    [JsonPropertyName("pishockUserId")]
    public int? PishockUserId { get; set; }

    [JsonPropertyName("user")]
    public MeUser? User { get; set; }

    [JsonPropertyName("emergencyStopShockerIds")]
    public int[]? EmergencyStopShockerIds { get; set; }
}

public sealed class MeUser
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("username")]
    public string Username { get; set; } = "";

    [JsonPropertyName("global_name")]
    public string? GlobalName { get; set; }
}
