using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using NSec.Cryptography;
using PiShock.Activity.Server;
using PiShock.Activity.Server.Operate;
using PiShock.Activity.Server.PiShock;
using PiShock.Activity.Server.Security;
using Xunit;

namespace PiShock.Activity.Tests;

public class SafetyGatesTests
{
    private static readonly PiShockCreds Creds = new(1, "test-token");

    private static ControlSnapshot EmptySnapshot(
        List<JsonElement>? hubs = null,
        List<JsonElement>? shockers = null,
        List<JsonElement>? shared = null,
        List<JsonElement>? links = null) => new()
    {
        Hubs = hubs ?? [],
        Shockers = shockers ?? [],
        Shared = shared ?? [],
        Links = links ?? [],
    };

    private static JsonElement Obj(object anon) =>
        JsonSerializer.SerializeToElement(anon);

    private static OperatePolicy.ActivitySharePolicyRow ShareRow(
        Action<OperatePolicy.ActivitySharePolicyRow>? _ = null,
        string discordUserId = "owner-1",
        int shockerId = 7,
        string? shareCode = "SHARECODE",
        string? hubClientId = "hub-1",
        int deviceMaxIntensity = 80,
        int deviceMaxDurationMs = 10_000,
        bool enabled = true,
        bool paused = false,
        int maxIntensity = 50,
        int maxDurationMs = 5_000,
        bool canShock = true,
        bool canVibrate = true,
        bool canBeep = true,
        bool canHold = true) => new()
    {
        DiscordUserId = discordUserId,
        ShockerId = shockerId,
        ShareCode = shareCode,
        HubClientId = hubClientId,
        DeviceMaxIntensity = deviceMaxIntensity,
        DeviceMaxDurationMs = deviceMaxDurationMs,
        Enabled = enabled,
        Paused = paused,
        MaxIntensity = maxIntensity,
        MaxDurationMs = maxDurationMs,
        CanShock = canShock,
        CanVibrate = canVibrate,
        CanBeep = canBeep,
        CanHold = canHold,
    };

    private static OperatePolicy.OperatePolicyDeps BaseDeps(
        Func<string, Task<(int, int)>>? personal = null,
        Func<PiShockCreds, Task<ControlSnapshot>>? snapshot = null,
        Func<string, Task<OperatePolicy.ActivitySharePolicyRow?>>? byCode = null,
        Func<string, int, Task<OperatePolicy.ActivitySharePolicyRow?>>? byShocker = null,
        Func<string, Task<bool>>? consent = null,
        Func<string, string, Task<bool>>? banned = null,
        Func<string, int, Task<bool>>? eStop = null) => new()
    {
        GetPersonalActivityLimits = personal ?? (_ => Task.FromResult((100, 15_000))),
        FetchControlSnapshot = snapshot ?? (_ => Task.FromResult(EmptySnapshot())),
        FindActivityShareByCode = byCode ?? (_ => Task.FromResult<OperatePolicy.ActivitySharePolicyRow?>(null)),
        FindActivityShareByShocker = byShocker ?? ((_, _) => Task.FromResult<OperatePolicy.ActivitySharePolicyRow?>(null)),
        GetConsent = consent ?? (_ => Task.FromResult(true)),
        IsExecutorBanned = banned ?? ((_, _) => Task.FromResult(false)),
        IsEmergencyStopped = eStop ?? ((_, _) => Task.FromResult(false)),
    };

    private static AppEnv MakeEnv(
        string? publicKey = null,
        bool requireProxy = false,
        string clientId = "app-123") => new()
    {
        DatabaseUrl = "postgres://test",
        DiscordClientId = clientId,
        DiscordClientSecret = "secret",
        TokenKey = new string('x', 64),
        PublicUrl = "http://localhost:3000",
        Port = 3000,
        DiscordBotToken = null,
        DiscordPublicKey = publicKey,
        RequireDiscordProxyAuth = requireProxy,
        AllowMissingBotInstanceCheck = false,
    };

    [Fact]
    public void MaxDuration_le_60_treated_as_seconds()
    {
        Assert.Equal(15_000, OperatePolicy.DeviceMaxDurationMsOf(new Dictionary<string, object?> { ["MaxDuration"] = 15 }));
    }

    [Fact]
    public void MaxDuration_gt_60_treated_as_ms()
    {
        Assert.Equal(5000, OperatePolicy.DeviceMaxDurationMsOf(new Dictionary<string, object?> { ["MaxDuration"] = 5000 }));
    }

    [Fact]
    public void Prefers_MaxDurationMs()
    {
        Assert.Equal(2500, OperatePolicy.DeviceMaxDurationMsOf(new Dictionary<string, object?>
        {
            ["MaxDurationMs"] = 2500,
            ["MaxDuration"] = 15,
        }));
    }

    [Fact]
    public void ShockerId_alternate_fields()
    {
        Assert.Equal(7, OperatePolicy.ShockerIdOf(new Dictionary<string, object?> { ["Id"] = 7 }));
        Assert.Equal(9, OperatePolicy.ShockerIdOf(new Dictionary<string, object?> { ["ShockerId"] = 9 }));
        Assert.Null(OperatePolicy.ShockerIdOf(new Dictionary<string, object?> { ["id"] = 0 }));
    }

    [Fact]
    public void ShareCode_alternate_fields()
    {
        Assert.Equal("ABC", OperatePolicy.ShareCodeOf(new Dictionary<string, object?> { ["ShareCode"] = "ABC" }));
        Assert.Equal("xyz", OperatePolicy.ShareCodeOf(new Dictionary<string, object?> { ["code"] = "xyz" }));
    }

    [Fact]
    public void ClampDuration_floor_and_ceiling()
    {
        Assert.Equal(16, OperatePolicy.ClampDurationMs(1, 15_000));
        Assert.Equal(15_000, OperatePolicy.ClampDurationMs(99_000, 15_000));
        Assert.Equal(300, OperatePolicy.ClampDurationMs(500, 300));
    }

    [Fact]
    public void Decrypt_throws_on_flipped_tag()
    {
        var key = Convert.ToHexString(RandomBytes(32));
        var sealedTok = TokenCrypto.EncryptToken(key, "session-secret");
        var flipped = Convert.FromBase64String(sealedTok.TokenAuthTag);
        flipped[0] ^= 0xff;
        Assert.ThrowsAny<CryptographicException>(() =>
            TokenCrypto.DecryptToken(key, sealedTok.EncryptedToken, sealedTok.TokenIv, Convert.ToBase64String(flipped)));
    }

    [Fact]
    public void Decrypt_throws_on_wrong_key()
    {
        var sealedTok = TokenCrypto.EncryptToken(Convert.ToHexString(RandomBytes(32)), "session-secret");
        Assert.ThrowsAny<CryptographicException>(() =>
            TokenCrypto.DecryptToken(
                Convert.ToHexString(RandomBytes(32)),
                sealedTok.EncryptedToken,
                sealedTok.TokenIv,
                sealedTok.TokenAuthTag));
    }

    [Fact]
    public void Consent_rejects_tampered_text()
    {
        var items = Consent.SafetyAckItems.ToList();
        items[0] = "tampered acknowledgement";
        var result = Consent.ValidateAcknowledgements(new ConsentRequest
        {
            Acknowledged = true,
            Version = Consent.SafetyAckVersion,
            Items = items,
        });
        Assert.False(result.Ok);
    }

    [Fact]
    public void Consent_rejects_short_list()
    {
        var result = Consent.ValidateAcknowledgements(new ConsentRequest
        {
            Acknowledged = true,
            Version = Consent.SafetyAckVersion,
            Items = Consent.SafetyAckItems.Take(2).ToList(),
        });
        Assert.False(result.Ok);
    }

    [Fact]
    public void Consent_rejects_not_acknowledged()
    {
        var result = Consent.ValidateAcknowledgements(new ConsentRequest
        {
            Acknowledged = false,
            Version = Consent.SafetyAckVersion,
            Items = Consent.SafetyAckItems.ToList(),
        });
        Assert.False(result.Ok);
    }

    [Fact]
    public void Consent_rejects_version_mismatch()
    {
        var result = Consent.ValidateAcknowledgements(new ConsentRequest
        {
            Acknowledged = true,
            Version = Consent.SafetyAckVersion + 1,
            Items = Consent.SafetyAckItems.ToList(),
        });
        Assert.False(result.Ok);
    }

    [Fact]
    public void ModeAllowed_throws_when_flags_off()
    {
        var denied = new OperatePolicy.OperateModeFlags
        {
            CanShock = false,
            CanVibrate = false,
            CanBeep = false,
            CanHold = false,
        };
        foreach (var (op, hold) in new[] { ("shock", false), ("vibrate", false), ("beep", false), ("shock", true) })
        {
            var err = Assert.Throws<OperatePolicy.OperatePolicyError>(() =>
                OperatePolicy.AssertModeAllowed(op, hold, denied));
            Assert.Equal("MODE_DENIED", err.Code);
        }
    }

    [Fact]
    public void RateLimit_throws_on_31st()
    {
        var userId = $"rate-limit-{Guid.NewGuid()}";
        for (var i = 0; i < 30; i++) OperatePolicy.AssertOperateRateLimit(userId);
        var err = Assert.Throws<OperatePolicy.OperatePolicyError>(() => OperatePolicy.AssertOperateRateLimit(userId));
        Assert.Equal("RATE_LIMIT", err.Code);
    }

    [Fact]
    public void Encrypt_decrypt_roundtrip_key_formats()
    {
        const string plaintext = "pishock-session-token";
        var hexKey = Convert.ToHexString(RandomBytes(32));
        var base64Key = Convert.ToBase64String(RandomBytes(32));
        const string passphrase = "dev-passphrase-not-hex";
        foreach (var key in new[] { hexKey, base64Key, passphrase })
        {
            var sealedTok = TokenCrypto.EncryptToken(key, plaintext);
            Assert.Equal(
                plaintext,
                TokenCrypto.DecryptToken(key, sealedTok.EncryptedToken, sealedTok.TokenIv, sealedTok.TokenAuthTag));
        }
    }

    private static byte[] RandomBytes(int count)
    {
        var bytes = new byte[count];
        System.Security.Cryptography.RandomNumberGenerator.Fill(bytes);
        return bytes;
    }

    [Fact]
    public void Consent_accepts_exact_list()
    {
        var result = Consent.ValidateAcknowledgements(new ConsentRequest
        {
            Acknowledged = true,
            Version = Consent.SafetyAckVersion,
            Items = Consent.SafetyAckItems.ToList(),
        });
        Assert.True(result.Ok);
    }

    [Fact]
    public void ClampIntensity_under_max() =>
        Assert.Equal(40, OperatePolicy.ClampIntensity(40, 50));

    [Fact]
    public async Task ResolveOwn_own_shocker_tighter_of_device_and_personal()
    {
        var deps = BaseDeps(
            personal: _ => Task.FromResult((60, 8_000)),
            snapshot: _ => Task.FromResult(EmptySnapshot(shockers:
            [
                Obj(new { Id = 7, ClientId = "hub-1", MaxIntensity = 80, MaxDuration = 10 }),
            ])));
        var policy = await OperatePolicy.ResolveOwnOperatePolicyAsync("caller-1", Creds, 7, null, deps);
        Assert.Equal(7, policy.ShockerId);
        Assert.False(policy.CrossUser);
        Assert.Equal("hub-1", policy.HubClientId);
        Assert.Equal(60, policy.MaxIntensity);
        Assert.Equal(8_000, policy.MaxDurationMs);
    }

    [Fact]
    public void ProxyHeaders_accepts_valid_signature()
    {
        var algorithm = SignatureAlgorithm.Ed25519;
        using var key = Key.Create(algorithm);
        var publicKeyHex = Convert.ToHexString(key.PublicKey.Export(KeyBlobFormat.RawPublicKey));
        var createdAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var payloadObj = new
        {
            created_at = createdAt,
            expires_at = createdAt + 60,
            user_id = "user-1",
            application_id = "app-123",
        };
        var payloadBytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payloadObj));
        var sig = algorithm.Sign(key, payloadBytes);
        var headers = new HeaderDictionary
        {
            ["x-signature-ed25519"] = Convert.ToBase64String(sig),
            ["x-signature-timestamp"] = createdAt.ToString(),
            ["x-discord-proxy-payload"] = Convert.ToBase64String(payloadBytes),
        };
        var env = MakeEnv(publicKey: publicKeyHex);
        var payload = DiscordProxyAuth.ValidateDiscordProxyHeaders(env, headers);
        Assert.NotNull(payload);
        Assert.Equal("user-1", payload!.UserId);
    }

    [Fact]
    public async Task Refuses_cross_user_without_consent()
    {
        var deps = BaseDeps(
            byCode: _ => Task.FromResult<OperatePolicy.ActivitySharePolicyRow?>(ShareRow()),
            consent: _ => Task.FromResult(false));
        var err = await Assert.ThrowsAsync<OperatePolicy.OperatePolicyError>(() =>
            OperatePolicy.ResolveOwnOperatePolicyAsync("caller-2", Creds, null, "SHARECODE", deps));
        Assert.Equal(403, err.Status);
        Assert.Equal("TARGET_CONSENT", err.Code);
    }

    [Fact]
    public async Task Refuses_when_banned()
    {
        var deps = BaseDeps(
            byCode: _ => Task.FromResult<OperatePolicy.ActivitySharePolicyRow?>(ShareRow()),
            banned: (_, _) => Task.FromResult(true));
        var err = await Assert.ThrowsAsync<OperatePolicy.OperatePolicyError>(() =>
            OperatePolicy.ResolveOwnOperatePolicyAsync("caller-2", Creds, null, "SHARECODE", deps));
        Assert.Equal("BANNED", err.Code);
    }

    [Fact]
    public async Task Refuses_own_shocker_on_estop()
    {
        var deps = BaseDeps(
            snapshot: _ => Task.FromResult(EmptySnapshot(shockers:
            [
                Obj(new { Id = 7, ClientId = "hub-1", MaxIntensity = 80, MaxDuration = 10 }),
            ])),
            eStop: (_, _) => Task.FromResult(true));
        var err = await Assert.ThrowsAsync<OperatePolicy.OperatePolicyError>(() =>
            OperatePolicy.ResolveOwnOperatePolicyAsync("caller-1", Creds, 7, null, deps));
        Assert.Equal("EMERGENCY_STOP", err.Code);
        Assert.Equal(423, err.Status);
    }

    [Fact]
    public async Task Refuses_disabled_or_paused_share()
    {
        foreach (var (enabled, paused) in new[] { (false, false), (true, true) })
        {
            var deps = BaseDeps(
                byCode: _ => Task.FromResult<OperatePolicy.ActivitySharePolicyRow?>(
                    ShareRow(enabled: enabled, paused: paused)));
            var err = await Assert.ThrowsAsync<OperatePolicy.OperatePolicyError>(() =>
                OperatePolicy.ResolveOwnOperatePolicyAsync("caller-2", Creds, null, "SHARECODE", deps));
            Assert.Equal("TARGET_UNAVAILABLE", err.Code);
        }
    }

    [Fact]
    public async Task Refuses_unknown_share()
    {
        var err = await Assert.ThrowsAsync<OperatePolicy.OperatePolicyError>(() =>
            OperatePolicy.ResolveOwnOperatePolicyAsync("caller-1", Creds, null, "MISSING", BaseDeps()));
        Assert.Equal("SHARE_UNKNOWN", err.Code);
    }

    [Fact]
    public async Task Refuses_unknown_shocker()
    {
        var err = await Assert.ThrowsAsync<OperatePolicy.OperatePolicyError>(() =>
            OperatePolicy.ResolveOwnOperatePolicyAsync("caller-1", Creds, 99, null, BaseDeps()));
        Assert.Equal("SHOCKER_UNKNOWN", err.Code);
    }

    [Fact]
    public async Task Refuses_missing_ids()
    {
        var err = await Assert.ThrowsAsync<OperatePolicy.OperatePolicyError>(() =>
            OperatePolicy.ResolveOwnOperatePolicyAsync("caller-1", Creds, null, null, BaseDeps()));
        Assert.Equal("BAD_REQUEST", err.Code);
    }

    [Fact]
    public void AssertWithinCeilings_refuses_over_max()
    {
        var iErr = Assert.Throws<OperatePolicy.OperatePolicyError>(() =>
            OperatePolicy.AssertWithinCeilings(51, 1000, 50, 5000));
        Assert.Equal(412, iErr.Status);
        var dErr = Assert.Throws<OperatePolicy.OperatePolicyError>(() =>
            OperatePolicy.AssertWithinCeilings(40, 6000, 50, 5000));
        Assert.Equal(416, dErr.Status);
        OperatePolicy.AssertWithinCeilings(40, 1000, 50, 5000);
    }

    [Fact]
    public void VerifyOwnedClientId_rejects_foreign()
    {
        var snapshot = EmptySnapshot(
            hubs: [Obj(new { ClientId = "hub-1" })],
            shockers: [Obj(new { Id = 7, ClientId = "hub-1" })]);
        Assert.Equal("hub-1", OperatePolicy.VerifyOwnedClientId(snapshot, "hub-1"));
        Assert.Null(OperatePolicy.VerifyOwnedClientId(snapshot, "foreign-hub"));
    }

    [Fact]
    public void Proxy_user_mismatch_throws()
    {
        Assert.Throws<ProxyAuthError>(() =>
            DiscordProxyAuth.AssertProxyPayloadMatchesUser(
                new ProxyPayload { CreatedAt = 1, ExpiresAt = 2, UserId = "other" },
                "bearer"));
    }

    [Fact]
    public void Proxy_required_when_configured()
    {
        var env = MakeEnv(requireProxy: true);
        Assert.Throws<ProxyAuthError>(() =>
            DiscordProxyAuth.ValidateDiscordProxyHeaders(env, new HeaderDictionary()));
    }

    [Fact]
    public void Proxy_rejects_expired_and_bad_sig()
    {
        var algorithm = SignatureAlgorithm.Ed25519;
        using var key = Key.Create(algorithm);
        var publicKeyHex = Convert.ToHexString(key.PublicKey.Export(KeyBlobFormat.RawPublicKey));
        var createdAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        var expiredPayload = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
        {
            created_at = createdAt,
            expires_at = createdAt - 10,
            user_id = "user-1",
            application_id = "app-123",
        }));
        var expiredSig = algorithm.Sign(key, expiredPayload);
        Assert.Throws<ProxyAuthError>(() => DiscordProxyAuth.ValidateDiscordProxyHeaders(
            MakeEnv(publicKey: publicKeyHex),
            new HeaderDictionary
            {
                ["x-signature-ed25519"] = Convert.ToBase64String(expiredSig),
                ["x-signature-timestamp"] = createdAt.ToString(),
                ["x-discord-proxy-payload"] = Convert.ToBase64String(expiredPayload),
            }));

        var goodPayload = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
        {
            created_at = createdAt,
            expires_at = createdAt + 60,
            user_id = "user-1",
            application_id = "app-123",
        }));
        var sig = algorithm.Sign(key, goodPayload);
        sig[0] ^= 0xff;
        Assert.Throws<ProxyAuthError>(() => DiscordProxyAuth.ValidateDiscordProxyHeaders(
            MakeEnv(publicKey: publicKeyHex),
            new HeaderDictionary
            {
                ["x-signature-ed25519"] = Convert.ToBase64String(sig),
                ["x-signature-timestamp"] = createdAt.ToString(),
                ["x-discord-proxy-payload"] = Convert.ToBase64String(goodPayload),
            }));
    }
}
