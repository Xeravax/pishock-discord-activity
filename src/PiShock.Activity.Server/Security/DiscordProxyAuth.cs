using System.Collections.Specialized;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using NSec.Cryptography;

namespace PiShock.Activity.Server.Security;

public sealed class ProxyAuthError : Exception
{
    public int Status { get; }

    public ProxyAuthError(string message, int status = 401) : base(message)
    {
        Status = status;
    }
}

public sealed class ProxyPayload
{
    public long CreatedAt { get; set; }
    public long ExpiresAt { get; set; }
    public string? UserId { get; set; }
    public string? ApplicationId { get; set; }
    public bool? IsDeveloper { get; set; }
}

public static class DiscordProxyAuth
{
    private static readonly Regex Hex = new("^[0-9a-fA-F]+$", RegexOptions.Compiled);

    public static ProxyPayload? ValidateDiscordProxyHeaders(
        AppEnv env,
        IHeaderDictionary headers)
    {
        var signature = Header(headers, "x-signature-ed25519");
        var timestamp = Header(headers, "x-signature-timestamp");
        var payloadB64 = Header(headers, "x-discord-proxy-payload");

        var anyPresent = signature is not null || timestamp is not null || payloadB64 is not null;
        if (!anyPresent)
        {
            if (env.RequireDiscordProxyAuth)
            {
                throw new ProxyAuthError("Missing Discord proxy authentication headers");
            }
            return null;
        }

        if (signature is null || timestamp is null || payloadB64 is null)
        {
            throw new ProxyAuthError("Incomplete Discord proxy authentication headers");
        }

        if (string.IsNullOrEmpty(env.DiscordPublicKey))
        {
            throw new ProxyAuthError("DISCORD_PUBLIC_KEY is not configured", 503);
        }

        byte[] payloadBytes;
        try
        {
            payloadBytes = Convert.FromBase64String(payloadB64);
        }
        catch (FormatException)
        {
            throw new ProxyAuthError("Invalid Discord proxy payload encoding");
        }

        ProxyPayload payloadData;
        try
        {
            using var doc = JsonDocument.Parse(payloadBytes);
            var root = doc.RootElement;
            payloadData = new ProxyPayload
            {
                CreatedAt = root.TryGetProperty("created_at", out var c) ? c.GetInt64() : 0,
                ExpiresAt = root.TryGetProperty("expires_at", out var e) ? e.GetInt64() : 0,
                UserId = root.TryGetProperty("user_id", out var u) ? u.ToString() : null,
                ApplicationId = root.TryGetProperty("application_id", out var a) ? a.ToString() : null,
            };
        }
        catch (JsonException)
        {
            throw new ProxyAuthError("Invalid Discord proxy payload JSON");
        }

        if (payloadData.CreatedAt.ToString() != timestamp)
        {
            throw new ProxyAuthError("invalid request timestamp");
        }

        if (payloadData.ExpiresAt < DateTimeOffset.UtcNow.ToUnixTimeSeconds())
        {
            throw new ProxyAuthError("expired proxy token");
        }

        var sigBuf = TryDecodeSignature(signature);
        var keyBuf = Convert.FromHexString(env.DiscordPublicKey);
        var algorithm = SignatureAlgorithm.Ed25519;
        var publicKey = PublicKey.Import(algorithm, keyBuf, KeyBlobFormat.RawPublicKey);
        if (!algorithm.Verify(publicKey, payloadBytes, sigBuf))
        {
            throw new ProxyAuthError("invalid request signature");
        }

        if (!string.IsNullOrEmpty(env.DiscordClientId) && !string.IsNullOrEmpty(payloadData.ApplicationId))
        {
            if (payloadData.ApplicationId != env.DiscordClientId)
            {
                throw new ProxyAuthError("Proxy payload application mismatch");
            }
        }

        return payloadData;
    }

    public static void AssertProxyPayloadMatchesUser(ProxyPayload? payload, string discordUserId)
    {
        if (payload is null) return;
        var proxyUserId = payload.UserId;
        if (string.IsNullOrEmpty(proxyUserId))
        {
            throw new ProxyAuthError("Proxy payload missing user_id");
        }
        if (proxyUserId != discordUserId)
        {
            throw new ProxyAuthError("Proxy payload user does not match bearer");
        }
    }

    private static string? Header(IHeaderDictionary headers, string name)
    {
        if (!headers.TryGetValue(name, out var values)) return null;
        var value = values.FirstOrDefault();
        return string.IsNullOrEmpty(value) ? null : value;
    }

    private static byte[] TryDecodeSignature(string signature)
    {
        if (Hex.IsMatch(signature) && signature.Length % 2 == 0)
        {
            return Convert.FromHexString(signature);
        }
        return Convert.FromBase64String(signature);
    }
}
