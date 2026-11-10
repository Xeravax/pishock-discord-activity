import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
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
  assertModeAllowed,
  assertOperateRateLimit,
  assertWithinCeilings,
  clampDurationMs,
  clampIntensity,
  deviceMaxDurationMsOf,
  OperatePolicyError,
  resolveOwnOperatePolicy,
  shareCodeOf,
  shockerIdOf,
  verifyOwnedClientId,
  type ActivitySharePolicyRow,
  type OperatePolicyDeps,
} from '../src/server/operate-policy.js';
import {
  assertProxyPayloadMatchesUser,
  ProxyAuthError,
  validateDiscordProxyHeaders,
} from '../src/server/discord-proxy-auth.js';
import type { AppEnv } from '../src/server/env.js';
import type { ControlSnapshot, PiShockCreds } from '../src/server/pishock/client.js';

const CREDS: PiShockCreds = { userId: 1, token: 'test-token' };

function emptySnapshot(overrides: Partial<ControlSnapshot> = {}): ControlSnapshot {
  return {
    hubs: [],
    shockers: [],
    shared: [],
    links: [],
    ...overrides,
  };
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
  tamperSignature?: boolean;
}): { env: AppEnv; req: FastifyRequest } {
  const createdAt = opts.createdAt ?? Math.floor(Date.now() / 1000);
  const expiresAt = opts.expiresAt ?? createdAt + 60;
  const payload = {
    created_at: createdAt,
    expires_at: expiresAt,
    user_id: opts.userId ?? 'user-1',
    application_id: opts.applicationId ?? 'app-123',
  };
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const signature = nacl.sign.detached(new Uint8Array(payloadBytes), opts.secretKey);
  let sigB64 = Buffer.from(signature).toString('base64');
  if (opts.tamperSignature) {
    const flipped = Buffer.from(signature);
    flipped[0] = flipped[0]! ^ 0xff;
    sigB64 = flipped.toString('base64');
  }
  return {
    env: makeEnv({ discordPublicKey: opts.publicKeyHex, discordClientId: 'app-123' }),
    req: {
      headers: {
        'x-signature-ed25519': sigB64,
        'x-signature-timestamp': String(createdAt),
        'x-discord-proxy-payload': payloadBytes.toString('base64'),
      },
    } as FastifyRequest,
  };
}

describe('can break — fragile payload heuristics', () => {
  it('treats MaxDuration <= 60 as seconds and converts to ms', () => {
    assert.equal(deviceMaxDurationMsOf({ MaxDuration: 15 }), 15_000);
  });

  it('treats MaxDuration > 60 as already milliseconds', () => {
    assert.equal(deviceMaxDurationMsOf({ MaxDuration: 5000 }), 5000);
  });

  it('prefers explicit MaxDurationMs over MaxDuration', () => {
    assert.equal(deviceMaxDurationMsOf({ MaxDurationMs: 2500, MaxDuration: 15 }), 2500);
  });

  it('reads alternate shocker id field names', () => {
    assert.equal(shockerIdOf({ Id: 7 }), 7);
    assert.equal(shockerIdOf({ ShockerId: 9 }), 9);
    assert.equal(shockerIdOf({ id: 0 }), null);
  });

  it('reads alternate share code field names', () => {
    assert.equal(shareCodeOf({ ShareCode: 'ABC' }), 'ABC');
    assert.equal(shareCodeOf({ code: 'xyz' }), 'xyz');
  });

  it('clamps duration to absolute floor and ceiling', () => {
    assert.equal(clampDurationMs(1, 15_000), 16);
    assert.equal(clampDurationMs(99_000, 15_000), 15_000);
    assert.equal(clampDurationMs(500, 300), 300);
  });
});

describe('supposed to break — paths that must fail', () => {
  it('decryptToken throws when the auth tag is flipped', () => {
    const key = randomBytes(32).toString('hex');
    const sealed = encryptToken(key, 'session-secret');
    const flippedTag = Buffer.from(sealed.tokenAuthTag, 'base64');
    flippedTag[0] = flippedTag[0]! ^ 0xff;
    assert.throws(() =>
      decryptToken(key, sealed.encryptedToken, sealed.tokenIv, flippedTag.toString('base64')),
    );
  });

  it('decryptToken throws when the key is wrong', () => {
    const sealed = encryptToken(randomBytes(32).toString('hex'), 'session-secret');
    assert.throws(() =>
      decryptToken(
        randomBytes(32).toString('hex'),
        sealed.encryptedToken,
        sealed.tokenIv,
        sealed.tokenAuthTag,
      ),
    );
  });

  it('rejects consent when acknowledgement text differs', () => {
    const items = [...SAFETY_ACK_ITEMS];
    items[0] = 'tampered acknowledgement';
    const result = validateConsentAcknowledgements({
      acknowledged: true,
      version: SAFETY_ACK_VERSION,
      items,
    });
    assert.equal(result.ok, false);
  });

  it('rejects consent when the list is short', () => {
    const result = validateConsentAcknowledgements({
      acknowledged: true,
      version: SAFETY_ACK_VERSION,
      items: SAFETY_ACK_ITEMS.slice(0, 2),
    });
    assert.equal(result.ok, false);
  });

  it('rejects consent when acknowledged is not true', () => {
    const result = validateConsentAcknowledgements({
      acknowledged: false,
      version: SAFETY_ACK_VERSION,
      items: [...SAFETY_ACK_ITEMS],
    });
    assert.equal(result.ok, false);
  });

  it('rejects consent when version mismatches', () => {
    const result = validateConsentAcknowledgements({
      acknowledged: true,
      version: SAFETY_ACK_VERSION + 1,
      items: [...SAFETY_ACK_ITEMS],
    });
    assert.equal(result.ok, false);
  });

  it('assertModeAllowed throws MODE_DENIED when flags are off', () => {
    const denied = {
      canShock: false,
      canVibrate: false,
      canBeep: false,
      canHold: false,
    };
    for (const [operation, hold] of [
      ['shock', false],
      ['vibrate', false],
      ['beep', false],
      ['shock', true],
    ] as const) {
      assert.throws(
        () => assertModeAllowed(operation, hold, denied),
        (err: unknown) => err instanceof OperatePolicyError && err.code === 'MODE_DENIED',
      );
    }
  });

  it('assertOperateRateLimit throws RATE_LIMIT on the 31st call', () => {
    const userId = `rate-limit-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 30; i++) {
      assertOperateRateLimit(userId);
    }
    assert.throws(
      () => assertOperateRateLimit(userId),
      (err: unknown) => err instanceof OperatePolicyError && err.code === 'RATE_LIMIT',
    );
  });
});

describe('expects to happen — happy paths', () => {
  it('encrypt/decrypt round-trips for hex, base64, and passphrase keys', () => {
    const plaintext = 'pishock-session-token';
    const hexKey = randomBytes(32).toString('hex');
    const base64Key = randomBytes(32).toString('base64');
    const passphrase = 'dev-passphrase-not-hex';

    for (const key of [hexKey, base64Key, passphrase]) {
      const sealed = encryptToken(key, plaintext);
      assert.equal(
        decryptToken(key, sealed.encryptedToken, sealed.tokenIv, sealed.tokenAuthTag),
        plaintext,
      );
    }
  });

  it('accepts the exact safety acknowledgement list', () => {
    const result = validateConsentAcknowledgements({
      acknowledged: true,
      version: SAFETY_ACK_VERSION,
      items: [...SAFETY_ACK_ITEMS],
    });
    assert.deepEqual(result, { ok: true });
  });

  it('clampIntensity keeps values under the max', () => {
    assert.equal(clampIntensity(40, 50), 40);
  });

  it('resolveOwnOperatePolicy returns own-shocker caps as the tighter of device and personal max', async () => {
    const deps = baseDeps({
      getPersonalActivityLimits: async () => ({
        activityMaxIntensity: 60,
        activityMaxDurationMs: 8_000,
      }),
      fetchControlSnapshot: async () =>
        emptySnapshot({
          shockers: [{ Id: 7, ClientId: 'hub-1', MaxIntensity: 80, MaxDuration: 10 }],
        }),
    });
    const policy = await resolveOwnOperatePolicy('caller-1', CREDS, { shockerId: 7 }, deps);
    assert.equal(policy.shockerId, 7);
    assert.equal(policy.crossUser, false);
    assert.equal(policy.hubClientId, 'hub-1');
    assert.equal(policy.maxIntensity, 60);
    assert.equal(policy.maxDurationMs, 8_000);
  });

  it('validateDiscordProxyHeaders accepts a correctly signed payload', () => {
    const keyPair = nacl.sign.keyPair();
    const publicKeyHex = Buffer.from(keyPair.publicKey).toString('hex');
    const { env, req } = signedProxyRequest({
      publicKeyHex,
      secretKey: keyPair.secretKey,
      userId: 'user-1',
    });
    const payload = validateDiscordProxyHeaders(env, req);
    assert.ok(payload);
    assert.equal(payload.user_id, 'user-1');
  });
});

describe('should refuse — must not proceed', () => {
  it('refuses cross-user operate when the target has not consented', async () => {
    const deps = baseDeps({
      findActivityShareByCode: async () => shareRow({ discordUserId: 'owner-1' }),
      getConsent: async () => false,
    });
    await assert.rejects(
      () => resolveOwnOperatePolicy('caller-2', CREDS, { shareCode: 'SHARECODE' }, deps),
      (err: unknown) =>
        err instanceof OperatePolicyError &&
        err.status === 403 &&
        err.code === 'TARGET_CONSENT',
    );
  });

  it('refuses cross-user operate when the owner banned the caller', async () => {
    const deps = baseDeps({
      findActivityShareByCode: async () => shareRow({ discordUserId: 'owner-1' }),
      getConsent: async () => true,
      isExecutorBanned: async () => true,
    });
    await assert.rejects(
      () => resolveOwnOperatePolicy('caller-2', CREDS, { shareCode: 'SHARECODE' }, deps),
      (err: unknown) =>
        err instanceof OperatePolicyError && err.status === 403 && err.code === 'BANNED',
    );
  });

  it('refuses own shocker when emergency stop is latched', async () => {
    const deps = baseDeps({
      fetchControlSnapshot: async () =>
        emptySnapshot({
          shockers: [{ Id: 7, ClientId: 'hub-1', MaxIntensity: 80, MaxDuration: 10 }],
        }),
      isEmergencyStopped: async () => true,
    });
    await assert.rejects(
      () => resolveOwnOperatePolicy('caller-1', CREDS, { shockerId: 7 }, deps),
      (err: unknown) =>
        err instanceof OperatePolicyError &&
        err.status === 423 &&
        err.code === 'EMERGENCY_STOP',
    );
  });

  it('refuses cross-user share when emergency stop is latched', async () => {
    const deps = baseDeps({
      findActivityShareByCode: async () => shareRow({ discordUserId: 'owner-1' }),
      getConsent: async () => true,
      isEmergencyStopped: async () => true,
    });
    await assert.rejects(
      () => resolveOwnOperatePolicy('caller-2', CREDS, { shareCode: 'SHARECODE' }, deps),
      (err: unknown) =>
        err instanceof OperatePolicyError &&
        err.status === 423 &&
        err.code === 'EMERGENCY_STOP',
    );
  });

  it('refuses disabled or paused shares', async () => {
    for (const overrides of [{ enabled: false }, { paused: true }] as const) {
      const deps = baseDeps({
        findActivityShareByCode: async () =>
          shareRow({ discordUserId: 'owner-1', ...overrides }),
        getConsent: async () => true,
      });
      await assert.rejects(
        () => resolveOwnOperatePolicy('caller-2', CREDS, { shareCode: 'SHARECODE' }, deps),
        (err: unknown) =>
          err instanceof OperatePolicyError &&
          err.status === 404 &&
          err.code === 'TARGET_UNAVAILABLE',
      );
    }
  });

  it('refuses unknown share codes', async () => {
    const deps = baseDeps({
      findActivityShareByCode: async () => null,
      fetchControlSnapshot: async () => emptySnapshot(),
    });
    await assert.rejects(
      () => resolveOwnOperatePolicy('caller-1', CREDS, { shareCode: 'MISSING' }, deps),
      (err: unknown) =>
        err instanceof OperatePolicyError &&
        err.status === 404 &&
        err.code === 'SHARE_UNKNOWN',
    );
  });

  it('refuses shockers not on the snapshot', async () => {
    const deps = baseDeps({
      fetchControlSnapshot: async () => emptySnapshot({ shockers: [] }),
    });
    await assert.rejects(
      () => resolveOwnOperatePolicy('caller-1', CREDS, { shockerId: 99 }, deps),
      (err: unknown) =>
        err instanceof OperatePolicyError &&
        err.status === 404 &&
        err.code === 'SHOCKER_UNKNOWN',
    );
  });

  it('refuses when neither shockerId nor shareCode is provided', async () => {
    const deps = baseDeps();
    await assert.rejects(
      () => resolveOwnOperatePolicy('caller-1', CREDS, {}, deps),
      (err: unknown) =>
        err instanceof OperatePolicyError &&
        err.status === 400 &&
        err.code === 'BAD_REQUEST',
    );
  });

  it('assertWithinCeilings refuses intensity and duration above the resolved max', () => {
    assert.throws(
      () => assertWithinCeilings(51, 1000, 50, 5000),
      (err: unknown) =>
        err instanceof OperatePolicyError &&
        err.status === 412 &&
        err.message === 'Intensity exceeds allowed maximum',
    );
    assert.throws(
      () => assertWithinCeilings(40, 6000, 50, 5000),
      (err: unknown) =>
        err instanceof OperatePolicyError &&
        err.status === 416 &&
        err.message === 'Duration exceeds allowed maximum',
    );
    assert.doesNotThrow(() => assertWithinCeilings(40, 1000, 50, 5000));
  });

  it('verifyOwnedClientId returns null for hubs not on the account', () => {
    const snapshot = emptySnapshot({
      shockers: [{ Id: 7, ClientId: 'hub-1' }],
      hubs: [{ ClientId: 'hub-1' }],
    });
    assert.equal(verifyOwnedClientId(snapshot, 'hub-1'), 'hub-1');
    assert.equal(verifyOwnedClientId(snapshot, 'foreign-hub'), null);
  });

  it('assertProxyPayloadMatchesUser throws when user_id mismatches the bearer', () => {
    assert.throws(
      () => assertProxyPayloadMatchesUser({ created_at: 1, expires_at: 2, user_id: 'other' }, 'bearer'),
      (err: unknown) => err instanceof ProxyAuthError,
    );
  });

  it('requires proxy headers when requireDiscordProxyAuth is set', () => {
    const env = makeEnv({ requireDiscordProxyAuth: true });
    assert.throws(
      () => validateDiscordProxyHeaders(env, { headers: {} } as FastifyRequest),
      (err: unknown) => err instanceof ProxyAuthError,
    );
  });

  it('rejects expired or badly signed proxy payloads', () => {
    const keyPair = nacl.sign.keyPair();
    const publicKeyHex = Buffer.from(keyPair.publicKey).toString('hex');

    const expired = signedProxyRequest({
      publicKeyHex,
      secretKey: keyPair.secretKey,
      expiresAt: Math.floor(Date.now() / 1000) - 10,
    });
    assert.throws(
      () => validateDiscordProxyHeaders(expired.env, expired.req),
      (err: unknown) => err instanceof ProxyAuthError,
    );

    const badSig = signedProxyRequest({
      publicKeyHex,
      secretKey: keyPair.secretKey,
      tamperSignature: true,
    });
    assert.throws(
      () => validateDiscordProxyHeaders(badSig.env, badSig.req),
      (err: unknown) => err instanceof ProxyAuthError,
    );
  });
});
