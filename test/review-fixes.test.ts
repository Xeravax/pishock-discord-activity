import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import {
  assertModeAllowed,
  clampDurationMs,
  clampIntensity,
  OperatePolicyError,
} from '../src/server/operate-policy.js';
import { bandForOperation, shareBandsFromRow } from '../src/server/limit-bands.js';
import { isBrokerLogUniqueConflict } from '../src/server/pishock/broker-log-ingest.js';
import {
  getPiShockPauseState,
  invalidatePiShockPauseCache,
} from '../src/server/pishock/pause.js';
import { allActiveShockersEStopped } from '../src/server/pishock/estop-sync.js';
import {
  ShockWarningError,
  warnBeforeShock,
} from '../src/server/pishock/shock-warning.js';
import type { PiShockCreds } from '../src/server/pishock/client.js';
import { resetRejectedPiShockApiKeysForTests } from '../src/server/pishock/client.js';

const CREDS: PiShockCreds = {
  userId: 1,
  username: 'wearer',
  token: 'pause-test-key',
  mode: 'apiKey',
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetRejectedPiShockApiKeysForTests();
  invalidatePiShockPauseCache('pause-user');
  mock.timers.reset();
});

function jsonOk(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function routePauseFetch(url: string, shockers: unknown, failShockers = false): Response {
  if (url.includes('/Shockers')) {
    if (failShockers) return new Response('fail', { status: 503 });
    return jsonOk(shockers);
  }
  if (url.includes('/Share/GetShared')) return jsonOk([]);
  if (url.includes('GetUserDevices')) return jsonOk([]);
  return jsonOk([]);
}

describe('broker log ingest errors', () => {
  it('treats only Prisma P2002 as a unique-key conflict', () => {
    assert.equal(isBrokerLogUniqueConflict({ code: 'P2002' }), true);
    assert.equal(isBrokerLogUniqueConflict({ code: 'P2003' }), false);
    assert.equal(isBrokerLogUniqueConflict(new Error('db down')), false);
    assert.equal(isBrokerLogUniqueConflict(null), false);
  });
});

describe('queued permission and band recheck', () => {
  it('refuses a queued shock when the share no longer allows the mode', () => {
    assert.throws(
      () =>
        assertModeAllowed('shock', false, {
          canShock: false,
          canVibrate: true,
          canBeep: true,
          canHold: true,
        }),
      (err: unknown) => err instanceof OperatePolicyError && err.code === 'MODE_DENIED',
    );
  });

  it('reclamps queued intensity and duration to the current share band', () => {
    const modes = shareBandsFromRow({
      minIntensity: 20,
      maxIntensity: 40,
      minDurationMs: 200,
      maxDurationMs: 2_000,
      deviceMaxIntensity: 100,
      deviceMaxDurationMs: 15_000,
      canShock: true,
    });
    const band = bandForOperation(modes, 'shock');
    assert.equal(clampIntensity(5, band.maxIntensity, band.minIntensity), 20);
    assert.equal(clampIntensity(90, band.maxIntensity, band.minIntensity), 40);
    assert.equal(clampDurationMs(50, band.maxDurationMs, band.minDurationMs), 200);
    assert.equal(clampDurationMs(9_000, band.maxDurationMs, band.minDurationMs), 2_000);
  });
});

describe('allEStopped vs PiShock pause', () => {
  it('is true only from emergency-stop ids, not pause', () => {
    const active = [{ shockerId: 1 }, { shockerId: 2 }];
    assert.equal(allActiveShockersEStopped(active, new Set([1, 2])), true);
    assert.equal(allActiveShockersEStopped(active, new Set([1])), false);
    assert.equal(allActiveShockersEStopped([], new Set([1, 2])), false);
    // Pause is a separate filter; e-stop aggregation ignores it.
    assert.equal(allActiveShockersEStopped(active, new Set()), false);
  });
});

describe('warnBeforeShock', () => {
  const vibeBand = {
    minIntensity: 1,
    maxIntensity: 100,
    minDurationMs: 16,
    maxDurationMs: 15_000,
  };

  it('skips when effective warning level is none', async () => {
    let published = 0;
    await warnBeforeShock(
      {
        operation: 'shock',
        requestedWarningLevel: 'none',
        requiredWarningLevel: 'none',
        canVibrate: true,
        creds: CREDS,
        clientId: 'hub-1',
        shockerId: 7,
        ownerDiscordUserId: 'owner',
        vibrateBand: vibeBand,
      },
      {
        publishOperate: async () => {
          published += 1;
          return true;
        },
        isEmergencyStopped: async () => false,
        sleep: async () => undefined,
      },
    );
    assert.equal(published, 0);
  });

  it('aborts when the warning publish fails', async () => {
    await assert.rejects(
      () =>
        warnBeforeShock(
          {
            operation: 'shock',
            requestedWarningLevel: 'small',
            requiredWarningLevel: 'none',
            canVibrate: true,
            creds: CREDS,
            clientId: 'hub-1',
            shockerId: 7,
            ownerDiscordUserId: 'owner',
            vibrateBand: vibeBand,
          },
          {
            publishOperate: async () => false,
            isEmergencyStopped: async () => false,
            sleep: async () => undefined,
          },
        ),
      (err: unknown) =>
        err instanceof ShockWarningError &&
        err.code === 'WARNING_FAILED' &&
        err.status === 502,
    );
  });

  it('rechecks emergency stop after the warning wait', async () => {
    let slept = false;
    await assert.rejects(
      () =>
        warnBeforeShock(
          {
            operation: 'hold',
            requestedWarningLevel: 'none',
            requiredWarningLevel: 'mid',
            canVibrate: true,
            creds: CREDS,
            clientId: 'hub-1',
            shockerId: 7,
            ownerDiscordUserId: 'owner',
            vibrateBand: vibeBand,
          },
          {
            publishOperate: async () => true,
            isEmergencyStopped: async () => {
              assert.equal(slept, true);
              return true;
            },
            sleep: async () => {
              slept = true;
            },
          },
        ),
      (err: unknown) =>
        err instanceof ShockWarningError &&
        err.code === 'EMERGENCY_STOP' &&
        err.status === 423,
    );
  });
});

describe('pause source failure fail-closed', () => {
  it('marks unknown when pause sources fail with no prior data', async () => {
    globalThis.fetch = async () => new Response('nope', { status: 503 });
    const state = await getPiShockPauseState('pause-user', CREDS);
    assert.equal(state.unknown, true);
  });

  it('keeps previous paused ids when a previously known source fails', async () => {
    mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
    let phase: 'ok' | 'fail-shockers' = 'ok';
    globalThis.fetch = async (input) =>
      routePauseFetch(String(input), [{ Id: 42, Paused: true }], phase === 'fail-shockers');

    const first = await getPiShockPauseState('pause-user', CREDS);
    assert.equal(first.unknown, false);
    assert.ok(first.shockerIds.includes(42));

    phase = 'fail-shockers';
    mock.timers.setTime(1_000_000 + 9_000);
    const second = await getPiShockPauseState('pause-user', CREDS);
    assert.equal(second.unknown, false);
    assert.ok(second.shockerIds.includes(42));
  });
});
