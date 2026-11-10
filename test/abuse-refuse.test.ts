/**
 * Refuse / abuse cases: things a client must not be able to do.
 * Each test names the bypass it would enable if the check were removed.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { randomBytes } from 'node:crypto';
import nacl from 'tweetnacl';
import type { FastifyRequest } from 'fastify';

import { decryptToken, encryptToken } from '../src/server/crypto.js';
import {
  SAFETY_ACK_ITEMS,
  SAFETY_ACK_VERSION,
  validateConsentAcknowledgements,
} from '../src/server/consent.js';
import {
  ABS_MAX_DURATION_MS,
  ABS_MAX_INTENSITY,
  assertModeAllowed,
  assertOperateRateLimit,
  assertWithinCeilings,
  clampDurationMs,
  clampIntensity,
  deviceMaxIntensityOf,
  OperatePolicyError,
  ownedHubClientIds,
  resolveOwnOperatePolicy,
  verifyOwnedClientId,
  type ActivitySharePolicyRow,
  type OperatePolicyDeps,
} from '../src/server/operate-policy.js';
import {
  assertProxyPayloadMatchesUser,
  ProxyAuthError,
  validateDiscordProxyHeaders,
} from '../src/server/discord-proxy-auth.js';
import {
  InstanceAuthError,
  verifyActivityInstance,
} from '../src/server/discord-instance.js';
import { sanitizeClientHint } from '../src/server/discord-location.js';
import {
  CONFIRM_TTL_MS,
  clearPendingConfirm,
  getPendingConfirm,
  setPendingConfirm,
  takePendingConfirm,
} from '../src/server/pishock/pending-confirm.js';
import {
  clampShareLimits,
  retainedShareCode,
  serializeShare,
} from '../src/server/routes/activity-share.js';
import type { AppEnv } from '../src/server/env.js';
import type { ControlSnapshot, PiShockCreds } from '../src/server/pishock/client.js';

const CREDS: PiShockCreds = { userId: 1, username: 'test-user', token: 'test-token' };

function emptySnapshot(overrides: Partial<ControlSnapshot> = {}): ControlSnapshot {
  return { hubs: [], shockers: [], shared: [], links: [], ...overrides };
}

function shareRow(overrides: Partial<ActivitySharePolicyRow> = {}): ActivitySharePolicyRow {
  return {
    discordUserId: 'owner-1',
    shockerId: 7,
    shareCode: 'SHARECODE',
    hubClientId: 'hub-1',
    deviceMaxIntensity: 80,
    deviceMaxDurationMs: 10_000,
    enabled: true,
    paused: false,
    maxIntensity: 50,
    maxDurationMs: 5_000,
    canShock: true,
    canVibrate: true,
    canBeep: true,
    canHold: true,
    ...overrides,
  };
}

function baseDeps(overrides: Partial<OperatePolicyDeps> = {}): OperatePolicyDeps {
  return {
    getPersonalActivityLimits: async () => ({
      activityMaxIntensity: 100,
      activityMaxDurationMs: 15_000,
    }),
    fetchControlSnapshot: async () => emptySnapshot(),
    findActivityShareByCode: async () => null,
    findActivityShareByShocker: async () => null,
    getConsent: async () => true,
    isExecutorBanned: async () => false,
    isEmergencyStopped: async () => false,
    ...overrides,
  };
}

function makeEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    databaseUrl: 'postgres://test',
    discordClientId: 'app-123',
    discordClientSecret: 'secret',
    tokenKey: 'x'.repeat(64),
    publicUrl: 'http://localhost:3000',
    port: 3000,
    discordBotToken: null,
    discordPublicKey: null,
    requireDiscordProxyAuth: false,
    allowMissingBotInstanceCheck: false,
    ...overrides,
  };
}

function signedProxyRequest(opts: {
  publicKeyHex: string;
  secretKey: Uint8Array;
  userId?: string;
  applicationId?: string;
  expiresAt?: number;
  createdAt?: number;
  omitUserId?: boolean;
  headerTimestamp?: string;
  tamperSignature?: boolean;
  swapPayload?: Record<string, unknown>;
}): { env: AppEnv; req: FastifyRequest; payloadBytes: Buffer } {
  const createdAt = opts.createdAt ?? Math.floor(Date.now() / 1000);
  const expiresAt = opts.expiresAt ?? createdAt + 60;
  const payload: Record<string, unknown> = {
    created_at: createdAt,
    expires_at: expiresAt,
    application_id: opts.applicationId ?? 'app-123',
  };
  if (!opts.omitUserId) payload.user_id = opts.userId ?? 'user-1';
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const signBytes = opts.swapPayload
    ? Buffer.from(JSON.stringify(opts.swapPayload), 'utf8')
    : payloadBytes;
  const signature = nacl.sign.detached(new Uint8Array(signBytes), opts.secretKey);
  let sigB64 = Buffer.from(signature).toString('base64');
  if (opts.tamperSignature) {
    const flipped = Buffer.from(signature);
    flipped[0] = flipped[0]! ^ 0xff;
    sigB64 = flipped.toString('base64');
  }
  return {
    env: makeEnv({ discordPublicKey: opts.publicKeyHex, discordClientId: 'app-123' }),
    payloadBytes,
    req: {
      headers: {
        'x-signature-ed25519': sigB64,
        'x-signature-timestamp': opts.headerTimestamp ?? String(createdAt),
        'x-discord-proxy-payload': payloadBytes.toString('base64'),
      },
    } as FastifyRequest,
  };
}

function isPolicy(
  code: string,
  status?: number,
): (err: unknown) => boolean {
  return (err) =>
    err instanceof OperatePolicyError &&
    err.code === code &&
    (status == null || err.status === status);
}

afterEach(() => {
  mock.restoreAll();
  mock.timers.reset();
});

describe('refuse — operate policy bypasses', () => {
  it('share code path keeps DB shockerId/hub, not a different body shockerId', async () => {
    // Otherwise a valid share could be retargeted onto another device.
    const deps = baseDeps({
      findActivityShareByCode: async () =>
        shareRow({ shockerId: 7, hubClientId: 'hub-1', discordUserId: 'owner-1' }),
    });
    const policy = await resolveOwnOperatePolicy(
      'caller-2',
      CREDS,
      { shareCode: 'SHARECODE', shockerId: 999 },
      deps,
    );
    assert.equal(policy.shockerId, 7);
    assert.equal(policy.hubClientId, 'hub-1');
    assert.equal(policy.crossUser, true);
  });

  it('cross-user caps ignore the executor personal activity limits', async () => {
    // Executor must not raise (or redefine) someone else's share ceiling via their own settings.
    const deps = baseDeps({
      getPersonalActivityLimits: async () => ({
        activityMaxIntensity: 1,
        activityMaxDurationMs: 16,
      }),
      findActivityShareByCode: async () =>
        shareRow({ maxIntensity: 50, maxDurationMs: 5_000, deviceMaxIntensity: 80 }),
    });
    const policy = await resolveOwnOperatePolicy(
      'caller-2',
      CREDS,
      { shareCode: 'SHARECODE' },
      deps,
    );
    assert.equal(policy.maxIntensity, 50);
    assert.equal(policy.maxDurationMs, 5_000);
  });

  it('cross-user intensity is min(share max, device max) either way', async () => {
    // Share policy must tighten below device; share max must not exceed device.
    const tightShare = await resolveOwnOperatePolicy(
      'caller-2',
      CREDS,
      { shareCode: 'A' },
      baseDeps({
        findActivityShareByCode: async () =>
          shareRow({ maxIntensity: 40, deviceMaxIntensity: 90 }),
      }),
    );
    assert.equal(tightShare.maxIntensity, 40);

    const tightDevice = await resolveOwnOperatePolicy(
      'caller-2',
      CREDS,
      { shareCode: 'B' },
      baseDeps({
        findActivityShareByCode: async () =>
          shareRow({ maxIntensity: 90, deviceMaxIntensity: 35 }),
      }),
    );
    assert.equal(tightDevice.maxIntensity, 35);
  });

  it('own shocker path uses activity-share mode flags', async () => {
    // Owner-configured mode denials must apply even when operating their own device by id.
    const deps = baseDeps({
      fetchControlSnapshot: async () =>
        emptySnapshot({
          shockers: [{ Id: 7, ClientId: 'hub-1', MaxIntensity: 80, MaxDuration: 10 }],
        }),
      findActivityShareByShocker: async () =>
        shareRow({ canShock: false, canHold: false, canVibrate: true, canBeep: true }),
    });
    const policy = await resolveOwnOperatePolicy('caller-1', CREDS, { shockerId: 7 }, deps);
    assert.equal(policy.flags.canShock, false);
    assert.equal(policy.flags.canHold, false);
    assert.throws(
      () => assertModeAllowed('shock', false, policy.flags),
      isPolicy('MODE_DENIED', 405),
    );
  });

  it('cannot operate a foreign shockerId that is not on the caller snapshot', async () => {
    // shockerId alone is not a capability — must be owned or reached via share.
    await assert.rejects(
      () =>
        resolveOwnOperatePolicy(
          'caller-1',
          CREDS,
          { shockerId: 42 },
          baseDeps({
            fetchControlSnapshot: async () =>
              emptySnapshot({
                shockers: [{ Id: 7, ClientId: 'hub-1', MaxIntensity: 80, MaxDuration: 10 }],
              }),
          }),
        ),
      isPolicy('SHOCKER_UNKNOWN', 404),
    );
  });

  it('own path prefers the tighter of personal vs device ceilings', async () => {
    // Personal limits must overrule a looser device; personal must not raise above device.
    const personalWins = await resolveOwnOperatePolicy(
      'caller-1',
      CREDS,
      { shockerId: 7 },
      baseDeps({
        getPersonalActivityLimits: async () => ({
          activityMaxIntensity: 30,
          activityMaxDurationMs: 2_000,
        }),
        fetchControlSnapshot: async () =>
          emptySnapshot({
            shockers: [{ Id: 7, ClientId: 'hub-1', MaxIntensity: 80, MaxDuration: 10 }],
          }),
      }),
    );
    assert.equal(personalWins.maxIntensity, 30);
    assert.equal(personalWins.maxDurationMs, 2_000);

    const deviceWins = await resolveOwnOperatePolicy(
      'caller-1',
      CREDS,
      { shockerId: 7 },
      baseDeps({
        getPersonalActivityLimits: async () => ({
          activityMaxIntensity: 100,
          activityMaxDurationMs: 15_000,
        }),
        fetchControlSnapshot: async () =>
          emptySnapshot({
            shockers: [{ Id: 7, ClientId: 'hub-1', MaxIntensity: 40, MaxDuration: 5 }],
          }),
      }),
    );
    assert.equal(deviceWins.maxIntensity, 40);
    assert.equal(deviceWins.maxDurationMs, 5_000);
  });

  it('stored activity-share ceilings tighten own-by-id operate further', async () => {
    // Persisted Discord Activity limits must not be ignored when operating by shocker id.
    const policy = await resolveOwnOperatePolicy(
      'caller-1',
      CREDS,
      { shockerId: 7 },
      baseDeps({
        getPersonalActivityLimits: async () => ({
          activityMaxIntensity: 100,
          activityMaxDurationMs: 15_000,
        }),
        fetchControlSnapshot: async () =>
          emptySnapshot({
            shockers: [{ Id: 7, ClientId: 'hub-live', MaxIntensity: 90, MaxDuration: 12 }],
          }),
        findActivityShareByShocker: async () =>
          shareRow({
            deviceMaxIntensity: 55,
            deviceMaxDurationMs: 3_000,
            hubClientId: 'hub-stored',
          }),
      }),
    );
    assert.equal(policy.maxIntensity, 55);
    assert.equal(policy.maxDurationMs, 3_000);
    assert.equal(policy.hubClientId, 'hub-stored');
  });

  it('owner using own share code still applies share, device, and personal mins', async () => {
    // Owner share-code path must not skip personal or share caps.
    const policy = await resolveOwnOperatePolicy(
      'owner-1',
      CREDS,
      { shareCode: 'SHARECODE' },
      baseDeps({
        getPersonalActivityLimits: async () => ({
          activityMaxIntensity: 25,
          activityMaxDurationMs: 1_000,
        }),
        findActivityShareByCode: async () =>
          shareRow({
            discordUserId: 'owner-1',
            maxIntensity: 50,
            deviceMaxIntensity: 80,
            maxDurationMs: 5_000,
            deviceMaxDurationMs: 10_000,
          }),
      }),
    );
    assert.equal(policy.crossUser, false);
    assert.equal(policy.maxIntensity, 25);
    assert.equal(policy.maxDurationMs, 1_000);
  });

  it('owner own-share-code path honors emergency stop', async () => {
    await assert.rejects(
      () =>
        resolveOwnOperatePolicy(
          'owner-1',
          CREDS,
          { shareCode: 'SHARECODE' },
          baseDeps({
            findActivityShareByCode: async () => shareRow({ discordUserId: 'owner-1' }),
            isEmergencyStopped: async () => true,
          }),
        ),
      isPolicy('EMERGENCY_STOP', 423),
    );
  });

  it('claimed website share still refuses under emergency stop', async () => {
    await assert.rejects(
      () =>
        resolveOwnOperatePolicy(
          'caller-1',
          CREDS,
          { shareCode: 'WEBSHARE' },
          baseDeps({
            fetchControlSnapshot: async () =>
              emptySnapshot({
                shared: [{ ShareCode: 'WEBSHARE', Id: 7, ClientId: 'hub-1', MaxIntensity: 50 }],
              }),
            isEmergencyStopped: async () => true,
          }),
        ),
      isPolicy('EMERGENCY_STOP', 423),
    );
  });

  it('whitespace-only shareCode does not operate and yields SHARE_UNKNOWN', async () => {
    // Malformed codes must not fall through into an unconstrained own-operate path.
    await assert.rejects(
      () =>
        resolveOwnOperatePolicy('caller-1', CREDS, { shareCode: '   ' }, baseDeps()),
      isPolicy('SHARE_UNKNOWN', 404),
    );
  });

  it('rejects zero, negative, and NaN shockerIds', async () => {
    for (const shockerId of [0, -1, Number.NaN]) {
      await assert.rejects(
        () => resolveOwnOperatePolicy('caller-1', CREDS, { shockerId }, baseDeps()),
        isPolicy('BAD_REQUEST', 400),
      );
    }
  });

  it('resolved policy hub/flags/ceilings never come from untrusted body-like fields', async () => {
    // Documents: body ceilings / mode flags / clientId are never trusted inputs to policy.
    const policy = await resolveOwnOperatePolicy(
      'caller-2',
      CREDS,
      { shareCode: 'SHARECODE' },
      baseDeps({
        findActivityShareByCode: async () =>
          shareRow({
            hubClientId: 'trusted-hub',
            maxIntensity: 33,
            canShock: false,
            canHold: false,
          }),
      }),
    );
    assert.equal(policy.hubClientId, 'trusted-hub');
    assert.equal(policy.maxIntensity, 33);
    assert.equal(policy.flags.canShock, false);
    assert.equal(policy.flags.canHold, false);
  });
});

describe('refuse — ceiling and absolute hardware bounds', () => {
  it('assertWithinCeilings rejects string-coerced over-max values', () => {
    // JSON bodies often send numbers as strings; coercion must still refuse.
    assert.throws(() => assertWithinCeilings('51', '1000', 50, 5000), isPolicy('INTENSITY_CEILING', 412));
    assert.throws(() => assertWithinCeilings('40', '6000', 50, 5000), isPolicy('DURATION_CEILING', 416));
  });

  it('assertWithinCeilings allows exact max and refuses one over', () => {
    assert.doesNotThrow(() => assertWithinCeilings(50, 5000, 50, 5000));
    assert.throws(() => assertWithinCeilings(51, 5000, 50, 5000), isPolicy('INTENSITY_CEILING', 412));
    assert.throws(() => assertWithinCeilings(50, 5001, 50, 5000), isPolicy('DURATION_CEILING', 416));
  });

  it('clamps never exceed min(policyMax, absolute max) even if assert is skipped', () => {
    // Defense-in-depth if a route forgets assertWithinCeilings.
    assert.equal(clampIntensity(999, 40), 40);
    assert.equal(clampIntensity(999, 200), ABS_MAX_INTENSITY);
    assert.equal(clampDurationMs(99_000, 2_000), 2_000);
    assert.equal(clampDurationMs(99_000, 99_000), ABS_MAX_DURATION_MS);
  });

  it('deviceMaxIntensityOf refuses to yield >100 or <1 ceilings', () => {
    assert.equal(deviceMaxIntensityOf({ MaxIntensity: 500 }), ABS_MAX_INTENSITY);
    assert.equal(deviceMaxIntensityOf({ MaxIntensity: 0 }), 1);
  });
});

describe('refuse — mode and hold privilege splits', () => {
  const allOn = { canShock: true, canVibrate: true, canBeep: true, canHold: true };

  it('hold=true is denied when canHold is false even if shock is allowed', () => {
    // Hold is a separate privilege from a single tap shock.
    assert.throws(
      () => assertModeAllowed('shock', true, { ...allOn, canHold: false }),
      isPolicy('MODE_DENIED', 405),
    );
  });

  it('operation hold is denied when canShock is false even if canHold is true', () => {
    // Hold frames are still shock operations.
    assert.throws(
      () => assertModeAllowed('hold', false, { ...allOn, canShock: false }),
      isPolicy('MODE_DENIED', 405),
    );
  });

  it('warning is denied when vibrate is not allowed', () => {
    assert.throws(
      () => assertModeAllowed('warning', false, { ...allOn, canVibrate: false }),
      isPolicy('MODE_DENIED', 405),
    );
  });

  it('shock without hold is allowed when only canHold is false', () => {
    assert.doesNotThrow(() =>
      assertModeAllowed('shock', false, { ...allOn, canHold: false }),
    );
  });

  it('cross-user resolved canHold:false blocks hold end-to-end with policy', async () => {
    const policy = await resolveOwnOperatePolicy(
      'caller-2',
      CREDS,
      { shareCode: 'SHARECODE' },
      baseDeps({
        findActivityShareByCode: async () => shareRow({ canHold: false, canShock: true }),
      }),
    );
    assert.throws(
      () => assertModeAllowed('shock', true, policy.flags),
      isPolicy('MODE_DENIED', 405),
    );
  });
});

describe('refuse — Discord proxy auth edges', () => {
  it('incomplete proxy header sets are refused', () => {
    // Partial headers must not skip verification.
    const env = makeEnv({
      discordPublicKey: 'ab'.repeat(32),
      requireDiscordProxyAuth: false,
    });
    assert.throws(
      () =>
        validateDiscordProxyHeaders(env, {
          headers: { 'x-signature-ed25519': 'abc' },
        } as FastifyRequest),
      (err: unknown) => err instanceof ProxyAuthError,
    );
  });

  it('rejects when header timestamp does not match payload created_at', () => {
    const keyPair = nacl.sign.keyPair();
    const publicKeyHex = Buffer.from(keyPair.publicKey).toString('hex');
    const createdAt = Math.floor(Date.now() / 1000);
    const { env, req } = signedProxyRequest({
      publicKeyHex,
      secretKey: keyPair.secretKey,
      createdAt,
      headerTimestamp: String(createdAt - 5),
    });
    assert.throws(
      () => validateDiscordProxyHeaders(env, req),
      (err: unknown) => err instanceof ProxyAuthError,
    );
  });

  it('rejects valid signature for a different Discord application id', () => {
    // Cross-app token reuse must fail closed.
    const keyPair = nacl.sign.keyPair();
    const publicKeyHex = Buffer.from(keyPair.publicKey).toString('hex');
    const { env, req } = signedProxyRequest({
      publicKeyHex,
      secretKey: keyPair.secretKey,
      applicationId: 'other-app',
    });
    assert.throws(
      () => validateDiscordProxyHeaders(env, req),
      (err: unknown) => err instanceof ProxyAuthError,
    );
  });

  it('rejects proxy payloads that omit user_id when binding to a bearer', () => {
    const keyPair = nacl.sign.keyPair();
    const publicKeyHex = Buffer.from(keyPair.publicKey).toString('hex');
    const { env, req } = signedProxyRequest({
      publicKeyHex,
      secretKey: keyPair.secretKey,
      omitUserId: true,
    });
    const payload = validateDiscordProxyHeaders(env, req);
    assert.throws(
      () => assertProxyPayloadMatchesUser(payload, 'user-1'),
      (err: unknown) => err instanceof ProxyAuthError,
    );
  });

  it('fails closed when proxy headers are present but DISCORD_PUBLIC_KEY is missing', () => {
    assert.throws(
      () =>
        validateDiscordProxyHeaders(makeEnv({ discordPublicKey: null }), {
          headers: {
            'x-signature-ed25519': 'aa',
            'x-signature-timestamp': '1',
            'x-discord-proxy-payload': Buffer.from('{}').toString('base64'),
          },
        } as FastifyRequest),
      (err: unknown) => err instanceof ProxyAuthError && err.status === 503,
    );
  });

  it('rejects non-JSON proxy payload bytes', () => {
    const env = makeEnv({ discordPublicKey: 'ab'.repeat(32) });
    assert.throws(
      () =>
        validateDiscordProxyHeaders(env, {
          headers: {
            'x-signature-ed25519': 'aa',
            'x-signature-timestamp': '1',
            'x-discord-proxy-payload': Buffer.from('not-json').toString('base64'),
          },
        } as FastifyRequest),
      (err: unknown) => err instanceof ProxyAuthError,
    );
  });

  it('rejects a signature computed over a different payload than the header', () => {
    // Classic proxy forgery: sign A, send B.
    const keyPair = nacl.sign.keyPair();
    const publicKeyHex = Buffer.from(keyPair.publicKey).toString('hex');
    const createdAt = Math.floor(Date.now() / 1000);
    const { env, req } = signedProxyRequest({
      publicKeyHex,
      secretKey: keyPair.secretKey,
      createdAt,
      swapPayload: {
        created_at: createdAt,
        expires_at: createdAt + 60,
        user_id: 'attacker',
        application_id: 'app-123',
      },
    });
    assert.throws(
      () => validateDiscordProxyHeaders(env, req),
      (err: unknown) => err instanceof ProxyAuthError,
    );
  });
});

describe('refuse — activity instance binding', () => {
  it('rejects empty instanceId', async () => {
    await assert.rejects(
      () => verifyActivityInstance(makeEnv({ discordBotToken: 'bot' }), ''),
      (err: unknown) => err instanceof InstanceAuthError && err.status === 400,
    );
  });

  it('rejects missing bot token when env does not allow skipping', async () => {
    await assert.rejects(
      () =>
        verifyActivityInstance(makeEnv({ discordBotToken: null, allowMissingBotInstanceCheck: false }), 'inst-1', {
          allowMissingBot: true,
        }),
      (err: unknown) => err instanceof InstanceAuthError && err.status === 503,
    );
  });

  it('rejects inactive (404) instances', async () => {
    mock.method(globalThis, 'fetch', async () => new Response('', { status: 404 }));
    await assert.rejects(
      () => verifyActivityInstance(makeEnv({ discordBotToken: 'bot' }), 'inst-gone'),
      (err: unknown) => err instanceof InstanceAuthError && err.status === 403,
    );
  });

  it('rejects callers who are not participants', async () => {
    mock.method(
      globalThis,
      'fetch',
      async () =>
        new Response(JSON.stringify({ users: ['other-user'], instance_id: 'inst-1', application_id: 'app-123' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await assert.rejects(
      () =>
        verifyActivityInstance(makeEnv({ discordBotToken: 'bot' }), 'inst-1', {
          requireUserId: 'caller-1',
        }),
      (err: unknown) => err instanceof InstanceAuthError && err.status === 403,
    );
  });

  it('rejects targets who are not participants', async () => {
    mock.method(
      globalThis,
      'fetch',
      async () =>
        new Response(JSON.stringify({ users: ['caller-1'], instance_id: 'inst-1', application_id: 'app-123' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await assert.rejects(
      () =>
        verifyActivityInstance(makeEnv({ discordBotToken: 'bot' }), 'inst-1', {
          requireUserId: 'caller-1',
          requireUserIds: ['target-missing'],
        }),
      (err: unknown) => err instanceof InstanceAuthError && err.status === 403,
    );
  });
});

describe('refuse — consent acknowledgement tricks', () => {
  it('rejects null, non-object, and non-array items bodies', () => {
    assert.equal(validateConsentAcknowledgements(null).ok, false);
    assert.equal(validateConsentAcknowledgements('yes').ok, false);
    assert.equal(
      validateConsentAcknowledgements({
        acknowledged: true,
        version: SAFETY_ACK_VERSION,
        items: 'nope',
      }).ok,
      false,
    );
  });

  it('rejects reordered acknowledgement items', () => {
    // Order-sensitive text prevents cherry-picking / reshuffling statements.
    const items = [...SAFETY_ACK_ITEMS];
    const tmp = items[0]!;
    items[0] = items[1]!;
    items[1] = tmp;
    assert.equal(
      validateConsentAcknowledgements({
        acknowledged: true,
        version: SAFETY_ACK_VERSION,
        items,
      }).ok,
      false,
    );
  });

  it('rejects whitespace-padded acknowledgement text', () => {
    const items = [...SAFETY_ACK_ITEMS];
    items[0] = ` ${items[0]} `;
    assert.equal(
      validateConsentAcknowledgements({
        acknowledged: true,
        version: SAFETY_ACK_VERSION,
        items,
      }).ok,
      false,
    );
  });

  it('rejects stringy acknowledged:"true" and padded item lists', () => {
    assert.equal(
      validateConsentAcknowledgements({
        acknowledged: 'true',
        version: SAFETY_ACK_VERSION,
        items: [...SAFETY_ACK_ITEMS],
      }).ok,
      false,
    );
    assert.equal(
      validateConsentAcknowledgements({
        acknowledged: true,
        version: SAFETY_ACK_VERSION,
        items: [...SAFETY_ACK_ITEMS, SAFETY_ACK_ITEMS[0]],
      }).ok,
      false,
    );
  });

  it('rejects wrong numeric versions while omitting version remains allowed', () => {
    assert.equal(
      validateConsentAcknowledgements({
        acknowledged: true,
        items: [...SAFETY_ACK_ITEMS],
      }).ok,
      true,
    );
    assert.equal(
      validateConsentAcknowledgements({
        acknowledged: true,
        version: 0,
        items: [...SAFETY_ACK_ITEMS],
      }).ok,
      false,
    );
  });
});

describe('refuse — crypto, pending confirm, hub spoof', () => {
  it('decryptToken throws when ciphertext or IV is flipped', () => {
    const key = randomBytes(32).toString('hex');
    const sealed = encryptToken(key, 'session-secret');

    const ct = Buffer.from(sealed.encryptedToken, 'base64');
    ct[0] = ct[0]! ^ 0xff;
    assert.throws(() =>
      decryptToken(key, ct.toString('base64'), sealed.tokenIv, sealed.tokenAuthTag),
    );

    const iv = Buffer.from(sealed.tokenIv, 'base64');
    iv[0] = iv[0]! ^ 0xff;
    assert.throws(() =>
      decryptToken(key, sealed.encryptedToken, iv.toString('base64'), sealed.tokenAuthTag),
    );
  });

  it('pending PiShock confirm expires after TTL and take is single-use', () => {
    // Stale login tokens must not confirm; second take must not reuse credentials.
    mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
    const userId = `pending-${Date.now()}`;
    setPendingConfirm(userId, { UserId: 9, Token: 'tok' }, ['Hub A']);
    assert.ok(getPendingConfirm(userId));

    mock.timers.setTime(1_000_000 + CONFIRM_TTL_MS + 1);
    assert.equal(getPendingConfirm(userId), null);

    mock.timers.setTime(1_000_000);
    setPendingConfirm(userId, { UserId: 9, Token: 'tok' }, []);
    assert.ok(takePendingConfirm(userId));
    assert.equal(takePendingConfirm(userId), null);
    clearPendingConfirm(userId);
  });

  it('verifyOwnedClientId rejects empty and foreign hubs; shared rows do not grant ownership', () => {
    // Emergency-stop / broker clientId must not be spoofable from the body or shared list.
    const snapshot = emptySnapshot({
      hubs: [{ ClientId: 'hub-1' }],
      shockers: [{ Id: 7, ClientId: 'hub-1' }],
      shared: [{ ClientId: 'shared-hub', ShareCode: 'X' }],
    });
    assert.equal(verifyOwnedClientId(snapshot, 'hub-1'), 'hub-1');
    assert.equal(verifyOwnedClientId(snapshot, '   '), null);
    assert.equal(verifyOwnedClientId(snapshot, 'shared-hub'), null);
    assert.equal(ownedHubClientIds(snapshot).has('shared-hub'), false);
  });

  it('rate-limit buckets are isolated per Discord user', () => {
    // Exhausting user A must not DoS user B's operate path.
    const a = `rate-a-${Math.random()}`;
    const b = `rate-b-${Math.random()}`;
    for (let i = 0; i < 30; i++) assertOperateRateLimit(a);
    assert.throws(() => assertOperateRateLimit(a), isPolicy('RATE_LIMIT', 429));
    assert.doesNotThrow(() => assertOperateRateLimit(b));
  });
});

describe('refuse — location hint sanitization', () => {
  it('discards hints whose guild or channel IDs do not match the trusted instance', () => {
    // Clients must not forge command-log location attribution.
    assert.equal(
      sanitizeClientHint(
        {
          guildId: 'guild-evil',
          channelId: 'chan-1',
          locationName: 'Evil Guild',
          locationIconUrl: 'https://cdn.discordapp.com/icons/1/a.png',
        },
        'guild-good',
        'chan-1',
      ),
      null,
    );
    assert.equal(
      sanitizeClientHint(
        {
          guildId: 'guild-good',
          channelId: 'chan-evil',
          locationName: 'Wrong channel',
        },
        'guild-good',
        'chan-1',
      ),
      null,
    );
  });

  it('strips non-Discord CDN icon URLs', () => {
    // Blocks SSRF / phishing via forged log icons.
    const cleaned = sanitizeClientHint(
      {
        guildId: 'g1',
        channelId: 'c1',
        locationName: 'Voice',
        locationIconUrl: 'https://evil.example/icon.png',
      },
      'g1',
      'c1',
    );
    assert.ok(cleaned);
    assert.equal(cleaned.locationName, 'Voice');
    assert.equal(cleaned.locationIconUrl, null);
  });
});

describe('refuse — share save / API disclosure', () => {
  it('clampShareLimits refuses to persist caps above device ceilings', () => {
    // Client cannot store Discord Activity limits above the live device max.
    const caps = clampShareLimits({
      deviceMaxIntensity: 40,
      deviceMaxDurationMs: 2_000,
      requestedMaxIntensity: 100,
      requestedMaxDurationMs: 15_000,
    });
    assert.equal(caps.maxIntensity, 40);
    assert.equal(caps.maxDurationMs, 2_000);
  });

  it('retainedShareCode ignores client-planted share codes', () => {
    // Share codes are capabilities; clients must not invent or overwrite them.
    assert.equal(retainedShareCode(null, 'PLANTED'), null);
    assert.equal(retainedShareCode('SERVERCODE', 'PLANTED'), 'SERVERCODE');
  });

  it('serializeShare never returns the raw shareCode', () => {
    const out = serializeShare({
      shockerId: 7,
      shockerName: 'A',
      hubClientId: 'hub-1',
      shareCode: 'SECRET-CAPABILITY',
      deviceMaxIntensity: 80,
      deviceMaxDurationMs: 10_000,
      enabled: true,
      paused: false,
      maxIntensity: 40,
      maxDurationMs: 2_000,
      canShock: true,
      canVibrate: true,
      canBeep: true,
      canHold: false,
    });
    assert.equal(out.hasShareCode, true);
    assert.equal('shareCode' in out, false);
  });
});
