using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using NSec.Cryptography;
using PiShock.Activity.Server;
using PiShock.Activity.Server.Discord;
using PiShock.Activity.Server.Operate;
using PiShock.Activity.Server.PiShock;
using PiShock.Activity.Server.Security;
using Xunit;

namespace PiShock.Activity.Tests;

public class AbuseRefuseTests
{
    private static readonly PiShockCreds Creds = new(1, "test-token");

    private static ControlSnapshot EmptySnapshot(
        List<JsonElement>? hubs = null,
        List<JsonElement>? shockers = null,
        List<JsonElement>? shared = null) => new()
    {
        Hubs = hubs ?? [],
        Shockers = shockers ?? [],
        Shared = shared ?? [],
        Links = [],
    };

    private static JsonElement Obj(object anon) => JsonSerializer.SerializeToElement(anon);

    private static OperatePolicy.ActivitySharePolicyRow ShareRow(
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

    private static AppEnv MakeEnv(string? publicKey = null, bool requireProxy = false) => new()
    {
        DatabaseUrl = "postgres://test",
        DiscordClientId = "app-123",
        DiscordClientSecret = "secret",
        TokenKey = new string('x', 64),
        PublicUrl = "http://localhost:3000",
        Port = 3000,
        DiscordPublicKey = publicKey,
        RequireDiscordProxyAuth = requireProxy,
    };

    private static bool IsPolicy(Exception err, string code, int? status = null) =>
        err is OperatePolicy.OperatePolicyError e
        && e.Code == code
        && (status is null || e.Status == status);

    [Fact]
    public async Task Share_code_keeps_db_shocker_not_body()
    {
        var policy = await OperatePolicy.ResolveOwnOperatePolicyAsync(
            "caller-2", Creds, 999, "SHARECODE",
            BaseDeps(byCode: _ => Task.FromResult<OperatePolicy.ActivitySharePolicyRow?>(
                ShareRow(shockerId: 7, hubClientId: "hub-1"))));
        Assert.Equal(7, policy.ShockerId);
        Assert.Equal("hub-1", policy.HubClientId);
        Assert.True(policy.CrossUser);
    }

    [Fact]
    public async Task Cross_user_ignores_executor_personal_limits()
    {
        var policy = await OperatePolicy.ResolveOwnOperatePolicyAsync(
            "caller-2", Creds, null, "SHARECODE",
            BaseDeps(
                personal: _ => Task.FromResult((1, 16)),
                byCode: _ => Task.FromResult<OperatePolicy.ActivitySharePolicyRow?>(
                    ShareRow(maxIntensity: 50, maxDurationMs: 5_000, deviceMaxIntensity: 80))));
        Assert.Equal(50, policy.MaxIntensity);
        Assert.Equal(5_000, policy.MaxDurationMs);
    }

    [Fact]
    public async Task Cross_user_intensity_is_min_of_share_and_device()
    {
        var tightShare = await OperatePolicy.ResolveOwnOperatePolicyAsync(
            "caller-2", Creds, null, "A",
            BaseDeps(byCode: _ => Task.FromResult<OperatePolicy.ActivitySharePolicyRow?>(
                ShareRow(maxIntensity: 40, deviceMaxIntensity: 90))));
        Assert.Equal(40, tightShare.MaxIntensity);

        var tightDevice = await OperatePolicy.ResolveOwnOperatePolicyAsync(
            "caller-2", Creds, null, "B",
            BaseDeps(byCode: _ => Task.FromResult<OperatePolicy.ActivitySharePolicyRow?>(
                ShareRow(maxIntensity: 90, deviceMaxIntensity: 35))));
        Assert.Equal(35, tightDevice.MaxIntensity);
    }

    [Fact]
    public void Hold_denied_when_canHold_false()
    {
        var flags = new OperatePolicy.OperateModeFlags { CanShock = true, CanHold = false, CanVibrate = true, CanBeep = true };
        var err = Assert.Throws<OperatePolicy.OperatePolicyError>(() =>
            OperatePolicy.AssertModeAllowed("shock", true, flags));
        Assert.True(IsPolicy(err, "MODE_DENIED", 405));
    }

    [Fact]
    public void Operation_hold_denied_when_canShock_false()
    {
        var flags = new OperatePolicy.OperateModeFlags { CanShock = false, CanHold = true, CanVibrate = true, CanBeep = true };
        var err = Assert.Throws<OperatePolicy.OperatePolicyError>(() =>
            OperatePolicy.AssertModeAllowed("hold", false, flags));
        Assert.True(IsPolicy(err, "MODE_DENIED", 405));
    }

    [Fact]
    public void Clamps_never_exceed_absolute_max()
    {
        Assert.Equal(40, OperatePolicy.ClampIntensity(999, 40));
        Assert.Equal(OperatePolicy.AbsMaxIntensity, OperatePolicy.ClampIntensity(999, 200));
        Assert.Equal(2_000, OperatePolicy.ClampDurationMs(99_000, 2_000));
        Assert.Equal(OperatePolicy.AbsMaxDurationMs, OperatePolicy.ClampDurationMs(99_000, 99_000));
    }

    [Fact]
    public void DeviceMaxIntensity_clamped_1_to_100()
    {
        Assert.Equal(OperatePolicy.AbsMaxIntensity,
            OperatePolicy.DeviceMaxIntensityOf(new Dictionary<string, object?> { ["MaxIntensity"] = 500 }));
        Assert.Equal(1,
            OperatePolicy.DeviceMaxIntensityOf(new Dictionary<string, object?> { ["MaxIntensity"] = 0 }));
    }

    [Fact]
    public void Consent_rejects_reordered_and_padded()
    {
        var items = Consent.SafetyAckItems.ToList();
        (items[0], items[1]) = (items[1], items[0]);
        Assert.False(Consent.ValidateAcknowledgements(new ConsentRequest
        {
            Acknowledged = true,
            Version = Consent.SafetyAckVersion,
            Items = items,
        }).Ok);

        var padded = Consent.SafetyAckItems.ToList();
        padded[0] = $" {padded[0]} ";
        Assert.False(Consent.ValidateAcknowledgements(new ConsentRequest
        {
            Acknowledged = true,
            Version = Consent.SafetyAckVersion,
            Items = padded,
        }).Ok);
    }

    [Fact]
    public void Consent_omitting_version_allowed()
    {
        Assert.True(Consent.ValidateAcknowledgements(new ConsentRequest
        {
            Acknowledged = true,
            Items = Consent.SafetyAckItems.ToList(),
        }).Ok);
        Assert.False(Consent.ValidateAcknowledgements(new ConsentRequest
        {
            Acknowledged = true,
            Version = 0,
            Items = Consent.SafetyAckItems.ToList(),
        }).Ok);
    }

    [Fact]
    public void Pending_confirm_ttl_and_single_use()
    {
        var original = PendingConfirmStore.NowMs;
        try
        {
            var now = 1_000_000L;
            PendingConfirmStore.NowMs = () => now;
            var userId = $"pending-{Guid.NewGuid()}";
            PendingConfirmStore.SetPendingConfirm(userId, 9, "tok", ["Hub A"]);
            Assert.NotNull(PendingConfirmStore.GetPendingConfirm(userId));

            now = 1_000_000L + (long)PendingConfirmStore.ConfirmTtl.TotalMilliseconds + 1;
            Assert.Null(PendingConfirmStore.GetPendingConfirm(userId));

            now = 1_000_000L;
            PendingConfirmStore.SetPendingConfirm(userId, 9, "tok", []);
            Assert.NotNull(PendingConfirmStore.TakePendingConfirm(userId));
            Assert.Null(PendingConfirmStore.TakePendingConfirm(userId));
            PendingConfirmStore.ClearPendingConfirm(userId);
        }
        finally
        {
            PendingConfirmStore.NowMs = original;
        }
    }

    [Fact]
    public void VerifyOwnedClientId_rejects_shared_hubs()
    {
        var snapshot = EmptySnapshot(
            hubs: [Obj(new { ClientId = "hub-1" })],
            shockers: [Obj(new { Id = 7, ClientId = "hub-1" })],
            shared: [Obj(new { ClientId = "shared-hub", ShareCode = "X" })]);
        Assert.Equal("hub-1", OperatePolicy.VerifyOwnedClientId(snapshot, "hub-1"));
        Assert.Null(OperatePolicy.VerifyOwnedClientId(snapshot, "   "));
        Assert.Null(OperatePolicy.VerifyOwnedClientId(snapshot, "shared-hub"));
        Assert.False(OperatePolicy.OwnedHubClientIds(snapshot).Contains("shared-hub"));
    }

    [Fact]
    public void Rate_limit_isolated_per_user()
    {
        var a = $"rate-a-{Guid.NewGuid()}";
        var b = $"rate-b-{Guid.NewGuid()}";
        for (var i = 0; i < 30; i++) OperatePolicy.AssertOperateRateLimit(a);
        Assert.Throws<OperatePolicy.OperatePolicyError>(() => OperatePolicy.AssertOperateRateLimit(a));
        OperatePolicy.AssertOperateRateLimit(b);
    }

    [Fact]
    public void SanitizeClientHint_rejects_mismatched_ids_and_evil_icons()
    {
        Assert.Null(DiscordLocation.SanitizeClientHint(
            new ClientLocationHint
            {
                GuildId = "guild-evil",
                ChannelId = "chan-1",
                LocationName = "Evil Guild",
                LocationIconUrl = "https://cdn.discordapp.com/icons/1/a.png",
            },
            "guild-good",
            "chan-1"));

        var cleaned = DiscordLocation.SanitizeClientHint(
            new ClientLocationHint
            {
                GuildId = "g1",
                ChannelId = "c1",
                LocationName = "Voice",
                LocationIconUrl = "https://evil.example/icon.png",
            },
            "g1",
            "c1");
        Assert.NotNull(cleaned);
        Assert.Equal("Voice", cleaned!.LocationName);
        Assert.Null(cleaned.LocationIconUrl);
    }

    [Fact]
    public void ClampShareLimits_and_retained_share_code()
    {
        var caps = ShareHelpers.ClampShareLimits(40, 2_000, 100, 15_000);
        Assert.Equal(40, caps.MaxIntensity);
        Assert.Equal(2_000, caps.MaxDurationMs);
        Assert.Null(ShareHelpers.RetainedShareCode(null, "PLANTED"));
        Assert.Equal("SERVERCODE", ShareHelpers.RetainedShareCode("SERVERCODE", "PLANTED"));
    }

    [Fact]
    public void SerializeShare_never_returns_raw_code()
    {
        var outObj = ShareHelpers.SerializeShare(
            7, "A", "hub-1", "SECRET-CAPABILITY", 80, 10_000, true, false, 40, 2_000,
            true, true, true, false);
        var json = JsonSerializer.SerializeToElement(outObj);
        Assert.True(json.GetProperty("hasShareCode").GetBoolean());
        Assert.False(json.TryGetProperty("shareCode", out _));
    }

    [Fact]
    public void Decrypt_throws_on_flipped_ciphertext_or_iv()
    {
        var keyBytes = new byte[32];
        RandomNumberGenerator.Fill(keyBytes);
        var key = Convert.ToHexString(keyBytes);
        var sealedTok = TokenCrypto.EncryptToken(key, "session-secret");

        var ct = Convert.FromBase64String(sealedTok.EncryptedToken);
        ct[0] ^= 0xff;
        Assert.ThrowsAny<CryptographicException>(() =>
            TokenCrypto.DecryptToken(key, Convert.ToBase64String(ct), sealedTok.TokenIv, sealedTok.TokenAuthTag));

        var iv = Convert.FromBase64String(sealedTok.TokenIv);
        iv[0] ^= 0xff;
        Assert.ThrowsAny<CryptographicException>(() =>
            TokenCrypto.DecryptToken(key, sealedTok.EncryptedToken, Convert.ToBase64String(iv), sealedTok.TokenAuthTag));
    }

    [Fact]
    public void Proxy_rejects_incomplete_headers_and_app_mismatch()
    {
        Assert.Throws<ProxyAuthError>(() =>
            DiscordProxyAuth.ValidateDiscordProxyHeaders(
                MakeEnv(publicKey: "ab" + new string('c', 62)),
                new HeaderDictionary { ["x-signature-ed25519"] = "abc" }));

        var algorithm = SignatureAlgorithm.Ed25519;
        using var key = Key.Create(algorithm);
        var publicKeyHex = Convert.ToHexString(key.PublicKey.Export(KeyBlobFormat.RawPublicKey));
        var createdAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var payloadBytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
        {
            created_at = createdAt,
            expires_at = createdAt + 60,
            user_id = "user-1",
            application_id = "other-app",
        }));
        var sig = algorithm.Sign(key, payloadBytes);
        Assert.Throws<ProxyAuthError>(() => DiscordProxyAuth.ValidateDiscordProxyHeaders(
            MakeEnv(publicKey: publicKeyHex),
            new HeaderDictionary
            {
                ["x-signature-ed25519"] = Convert.ToBase64String(sig),
                ["x-signature-timestamp"] = createdAt.ToString(),
                ["x-discord-proxy-payload"] = Convert.ToBase64String(payloadBytes),
            }));
    }

    [Fact]
    public async Task Whitespace_shareCode_yields_SHARE_UNKNOWN()
    {
        var err = await Assert.ThrowsAsync<OperatePolicy.OperatePolicyError>(() =>
            OperatePolicy.ResolveOwnOperatePolicyAsync("caller-1", Creds, null, "   ", BaseDeps()));
        Assert.Equal("SHARE_UNKNOWN", err.Code);
    }

    [Fact]
    public async Task Rejects_zero_negative_nan_shockerIds()
    {
        foreach (var id in new int?[] { 0, -1 })
        {
            var err = await Assert.ThrowsAsync<OperatePolicy.OperatePolicyError>(() =>
                OperatePolicy.ResolveOwnOperatePolicyAsync("caller-1", Creds, id, null, BaseDeps()));
            Assert.Equal("BAD_REQUEST", err.Code);
        }
    }
}
