import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ADMIN_CONSENT_PHRASE,
  ADMIN_CONSENT_STEP_TTL_MS,
  ADMIN_CONSENT_VERSION,
  ADMIN_SOFT_GATES,
  AdminConsentError,
  createAdminConsentFlow,
  hasLimitConsent,
  isAdmin,
} from '../src/server/admin-bypass.js';
import {
  WearerGateError,
  checkWearerGates,
  createCooldownTracker,
  deviceOnlyModes,
} from '../src/server/wearer-safety.js';
import { DEFAULT_WEARER_SAFETY } from '../src/server/wearer-safety-settings.js';
import { createCommandQueue, type QueueEnqueueInput } from '../src/server/pishock/command-queue.js';

function consentError(fn: () => unknown, code: string) {
  assert.throws(fn, (e: unknown) => e instanceof AdminConsentError && e.code === code);
}

describe('admin identity', () => {
  it('only listed ids are admins', () => {
    const admins = new Set(['111111111111111111']);
    assert.equal(isAdmin(admins, '111111111111111111'), true);
    assert.equal(isAdmin(admins, '222222222222222222'), false);
  });
});

describe('limit consent (three separate prompts)', () => {
  it('needs steps 1 → 2 → 3 with nonces and the typed phrase', () => {
    const flow = createAdminConsentFlow();
    const s1 = flow.step('wearer', { step: 1 });
    assert.ok('nonce' in s1);
    const s2 = flow.step('wearer', { step: 2, nonce: s1.nonce });
    assert.ok('nonce' in s2);
    assert.notEqual(s2.nonce, s1.nonce);
    consentError(() => flow.step('wearer', { step: 3, nonce: s2.nonce, phrase: 'yes' }), 'CONSENT_PHRASE');
    assert.deepEqual(flow.step('wearer', { step: 3, nonce: s2.nonce, phrase: ADMIN_CONSENT_PHRASE }), {
      complete: true,
    });
  });

  it('a single request can never grant consent', () => {
    const flow = createAdminConsentFlow();
    consentError(() => flow.step('wearer', { step: 3, phrase: ADMIN_CONSENT_PHRASE }), 'CONSENT_EXPIRED');
    consentError(() => flow.step('wearer', { step: 2 }), 'CONSENT_EXPIRED');
  });

  it('rejects skipped steps, reused nonces and other users’ nonces', () => {
    const flow = createAdminConsentFlow();
    const s1 = flow.step('wearer', { step: 1 }) as { nonce: string };
    consentError(
      () => flow.step('wearer', { step: 3, nonce: s1.nonce, phrase: ADMIN_CONSENT_PHRASE }),
      'CONSENT_ORDER',
    );
    // The failed attempt resets the flow.
    consentError(() => flow.step('wearer', { step: 2, nonce: s1.nonce }), 'CONSENT_EXPIRED');

    const a = flow.step('a', { step: 1 }) as { nonce: string };
    flow.step('b', { step: 1 });
    consentError(() => flow.step('b', { step: 2, nonce: a.nonce }), 'CONSENT_ORDER');
  });

  it('expires between steps', () => {
    let t = 0;
    const flow = createAdminConsentFlow(() => t);
    const s1 = flow.step('wearer', { step: 1 }) as { nonce: string };
    t += ADMIN_CONSENT_STEP_TTL_MS + 1;
    consentError(() => flow.step('wearer', { step: 2, nonce: s1.nonce }), 'CONSENT_EXPIRED');
  });

  it('consent is tied to the current wording version', () => {
    const at = new Date();
    assert.equal(hasLimitConsent(null), false);
    assert.equal(hasLimitConsent({ adminLimitOverrideConsentAt: null, adminLimitOverrideConsentVersion: null }), false);
    assert.equal(
      hasLimitConsent({ adminLimitOverrideConsentAt: at, adminLimitOverrideConsentVersion: ADMIN_CONSENT_VERSION }),
      true,
    );
    assert.equal(
      hasLimitConsent({ adminLimitOverrideConsentAt: at, adminLimitOverrideConsentVersion: ADMIN_CONSENT_VERSION - 1 }),
      false,
    );
  });
});

describe('admin bypass of soft gates', () => {
  const strict = {
    ...DEFAULT_WEARER_SAFETY,
    favoritesOnly: true,
    approveEachCommand: true,
    cooldownPerSenderMs: 60_000,
    budgetEnabled: true,
    budgetMaxShocks: 1,
  };
  const deps = () => {
    const cooldowns = createCooldownTracker(() => 1_000);
    cooldowns.record('owner', 'admin', null);
    return {
      settings: strict,
      isFavorite: async () => false,
      getBudget: async () => ({ usedShocks: 5, usedShockMs: 0, periodStartedAt: null }),
      cooldowns,
    };
  };
  const ctx = {
    ownerDiscordUserId: 'owner',
    executorDiscordUserId: 'admin',
    operation: 'shock',
    durationMs: 1000,
    batchId: null,
    queueEnabled: false,
  };

  it('without bypass every soft gate refuses', async () => {
    await assert.rejects(checkWearerGates(deps(), ctx), (e: unknown) => e instanceof WearerGateError);
  });

  it('with bypass all soft gates are skipped and reported', async () => {
    const res = await checkWearerGates(deps(), { ...ctx, bypass: ADMIN_SOFT_GATES });
    assert.deepEqual(res, {
      bypassed: ['favorites', 'cooldown', 'budget', 'approval'],
      needsApproval: false,
    });
  });

  it('nothing is reported when nothing had to be bypassed', async () => {
    const res = await checkWearerGates(
      {
        settings: DEFAULT_WEARER_SAFETY,
        isFavorite: async () => false,
        getBudget: async () => ({ usedShocks: 0, usedShockMs: 0, periodStartedAt: null }),
        cooldowns: createCooldownTracker(),
      },
      { ...ctx, bypass: ADMIN_SOFT_GATES },
    );
    assert.deepEqual(res.bypassed, []);
  });
});

describe('limit override never exceeds the device', () => {
  it('uses the PiShock device max and keeps the required warning', () => {
    const modes = deviceOnlyModes({ maxIntensity: 60, maxDurationMs: 5_000 }, 'mid');
    assert.equal(modes.shock.maxIntensity, 60);
    assert.equal(modes.shock.maxDurationMs, 5_000);
    assert.equal(modes.requiredWarningLevel, 'mid');
  });
});

describe('admin queue jump', () => {
  it('runs ahead of starred senders and ignores per-sender cooldown', async () => {
    let now = 0;
    const executed: string[] = [];
    const queue = createCommandQueue({
      now: () => now,
      sleep: () => new Promise(() => undefined),
      isStarred: (_o, e) => e === 'star',
      getLimits: () => ({ progressMs: 0, maxPerSender: 10, cooldownPerSenderMs: 60_000 }),
      validateBeforeRun: async () => true,
      execute: async (item) => {
        executed.push(item.executorDiscordUserId);
      },
      endActive: async () => undefined,
      onStateChange: () => undefined,
      onTicket: () => undefined,
    });
    const base = (executor: string, front = false): QueueEnqueueInput => ({
      ownerDiscordUserId: 'owner',
      executorDiscordUserId: executor,
      executorUsername: null,
      executorGlobalName: null,
      executorAvatar: null,
      operation: 'shock',
      intensity: 10,
      durationMs: 100,
      hold: false,
      warning: false,
      shockerId: 1,
      shareCode: null,
      hubClientId: 'hub',
      instanceId: 'i',
      front,
    });
    await queue.enqueue(base('first'));
    await queue.enqueue(base('star'));
    const admin = await queue.enqueue(base('admin', true));
    assert.equal(admin.position, 1, 'admin item is next in line');
    const state = await queue.snapshot('owner');
    assert.deepEqual(
      state.waiting.map((w) => w.executorDiscordUserId),
      ['admin', 'star'],
    );
    now += 1;
    assert.deepEqual(executed, ['first']);
  });
});
