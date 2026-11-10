using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace PiShock.Activity.Server.Security;

public static class TokenCrypto
{
    private static readonly Regex Hex64 = new("^[0-9a-fA-F]{64}$", RegexOptions.Compiled);

    public static byte[] KeyFromEnv(string tokenKey)
    {
        var trimmed = tokenKey.Trim();
        if (Hex64.IsMatch(trimmed))
        {
            return Convert.FromHexString(trimmed);
        }

        try
        {
            var b64 = Convert.FromBase64String(trimmed);
            if (b64.Length == 32) return b64;
        }
        catch (FormatException)
        {
            // fall through
        }

        return SHA256.HashData(Encoding.UTF8.GetBytes(trimmed));
    }

    public static (string EncryptedToken, string TokenIv, string TokenAuthTag) EncryptToken(
        string tokenKey,
        string plaintext)
    {
        var key = KeyFromEnv(tokenKey);
        var iv = RandomNumberGenerator.GetBytes(12);
        var plaintextBytes = Encoding.UTF8.GetBytes(plaintext);
        var ciphertext = new byte[plaintextBytes.Length];
        var tag = new byte[16];
        using var aes = new AesGcm(key, tag.Length);
        aes.Encrypt(iv, plaintextBytes, ciphertext, tag);
        return (
            Convert.ToBase64String(ciphertext),
            Convert.ToBase64String(iv),
            Convert.ToBase64String(tag));
    }

    public static string DecryptToken(
        string tokenKey,
        string encryptedToken,
        string tokenIv,
        string tokenAuthTag)
    {
        var key = KeyFromEnv(tokenKey);
        var iv = Convert.FromBase64String(tokenIv);
        var ciphertext = Convert.FromBase64String(encryptedToken);
        var tag = Convert.FromBase64String(tokenAuthTag);
        var plaintext = new byte[ciphertext.Length];
        using var aes = new AesGcm(key, tag.Length);
        aes.Decrypt(iv, ciphertext, tag, plaintext);
        return Encoding.UTF8.GetString(plaintext);
    }
}
