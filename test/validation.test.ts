import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import type { z } from 'zod';
import {
  activityShareSaveBody,
  discordAuthBody,
  emergencyStopBody,
  operateBody,
  parseBody,
  participantOperateBody,
  participantsStatusBody,
  pauseBody,
  queueEnabledBody,
  queueProgressBody,
  queueSettingsBody,
} from '../src/server/schemas/index.js';

/** Mounts one schema on a throwaway POST route and returns an injector. */
function harness(schema: z.ZodType) {
  const app = Fastify();
  app.post('/t', async (req, reply) => {
    const body = parseBody(schema, req, reply);
    if (!body) return reply;
    return { ok: true, body };
  });
  return async (payload?: unknown) => {
    const res = await app.inject({
      method: 'POST',
      url: '/t',
      // A genuinely body-less request carries no content-type (Fastify rejects an empty JSON body itself).
      headers: payload === undefined ? {} : { 'content-type': 'application/json' },
      payload: payload === undefined ? undefined : JSON.stringify(payload),
    });
    return { status: res.statusCode, json: res.json() as Record<string, unknown> };
  };
}

// Shape of what OfficialController actually sends (includes retired fields + warning object).
const clientOperate = {
  shockerId: 42,
  shareCode: 'ABC123',
  clientId: 7,
  targetDiscordUserId: '111',
  operation: 'shock',
  intensity: 20,
  durationMs: 1000,
  canShock: true,
  canVibrate: true,
  canBeep: true,
  canHold: true,
  maxIntensity: 100,
  maxDuration: 15000,
  warning: { Active: true, Intensity: 30, DurationMs: 500 },
  warningLevel: 'small',
  hold: false,
  instanceId: 'i-1',
  locationHint: { guildId: '1', channelId: null, locationKind: 'gc', locationName: 'x' },
};

test('operate: real client payload (with retired fields) is accepted and stripped', async () => {
  const post = harness(operateBody);
  const res = await post(clientOperate);
  assert.equal(res.status, 200);
  const body = res.json.body as Record<string, unknown>;
  assert.equal(body.shockerId, 42);
  assert.equal(body.canShock, undefined, 'retired policy fields must not reach the handler');
  assert.equal(body.maxIntensity, undefined);
});

test('operate: friend route accepts the same payload with warning as an object or null', async () => {
  const post = harness(participantOperateBody);
  assert.equal((await post(clientOperate)).status, 200);
  assert.equal((await post({ ...clientOperate, warning: null })).status, 200);
  assert.equal((await post({ ...clientOperate, warning: true })).status, 200);
});

test('operate: rejects wrong types and unknown operations with 400', async () => {
  const post = harness(operateBody);
  for (const bad of [
    { ...clientOperate, intensity: '99' },
    { ...clientOperate, durationMs: null },
    { ...clientOperate, shockerId: '42' },
    { ...clientOperate, operation: 'explode' },
    { ...clientOperate, instanceId: 'x'.repeat(5000) },
    { ...clientOperate, warning: { Active: 'yes' } },
  ]) {
    const res = await post(bad);
    assert.equal(res.status, 400, JSON.stringify(bad).slice(0, 80));
    assert.equal(res.json.code, 'INVALID_BODY');
  }
});

test('non-object bodies (array, string, number) are rejected, not crashed on', async () => {
  const post = harness(queueSettingsBody);
  for (const bad of [[1, 2], 'str', 5]) {
    assert.equal((await post(bad)).status, 400);
  }
});

test('missing body is treated as {} so all-optional schemas still work', async () => {
  const post = harness(queueSettingsBody);
  assert.equal((await post()).status, 200);
});

test('queue schemas keep their original error messages', async () => {
  const enabled = await harness(queueEnabledBody)({ enabled: 'true' });
  assert.equal(enabled.status, 400);
  assert.equal(enabled.json.error, 'enabled boolean required');
  const progress = await harness(queueProgressBody)({});
  assert.equal(progress.json.error, 'progressMs number required');
  const auth = await harness(discordAuthBody)({});
  assert.equal(auth.json.error, 'Missing code');
  const pause = await harness(pauseBody)({ pauseState: true });
  assert.equal(pause.json.error, 'shareId required');
});

test('emergency stop: numeric-string ids still accepted, bad/huge input rejected', async () => {
  const post = harness(emergencyStopBody);
  assert.equal((await post({ shockerId: '5', engaged: true })).status, 200);
  assert.equal((await post({ shockerIds: [1, 2, 3], engaged: false, clientId: '9' })).status, 200);
  const missing = await post({ shockerId: 5 });
  assert.equal(missing.status, 400);
  assert.equal(missing.json.error, 'engaged boolean required');
  const huge = await post({ shockerIds: Array.from({ length: 101 }, (_, i) => i + 1), engaged: true });
  assert.equal(huge.status, 400);
});

test('participants status: caps id list and accepts numeric ids', async () => {
  const post = harness(participantsStatusBody);
  assert.equal((await post({ discordUserIds: ['1', 2], instanceId: 'i' })).status, 200);
  const many = Array.from({ length: 501 }, (_, i) => String(i));
  assert.equal((await post({ discordUserIds: many })).status, 400);
});

test('activity share save: shape-checks but leaves row normalisation to the handler', async () => {
  const post = harness(activityShareSaveBody);
  const ok = await post({
    personal: { activityMaxIntensity: 50 },
    shares: [{ shockerId: 1, enabled: true, anythingElse: 'kept for normalizeShareRow' }],
    bannedDiscordUserIds: ['1'],
  });
  assert.equal(ok.status, 200);
  assert.equal((await post({ shares: 'nope' })).status, 400);
  assert.equal((await post({ shares: [1, 2] })).status, 400);
});
