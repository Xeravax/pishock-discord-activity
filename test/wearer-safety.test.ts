import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  WearerGateError,
  applyEscalationCap,
  assertPersonAllows,
  buildEffectiveModes,
  checkBudget,
  checkWearerGates,
  createCooldownTracker,
  createEscalationTracker,
  dayBudgetExpired,
  dayKey,
  sessionBudgetShouldReset,
  type GateContext,
  type GateDeps,
} from '../src/server/wearer-safety.js';
import {
  DEFAULT_WEARER_SAFETY,
  personLimitPatchToColumns,
  wearerSafetyFromColumns,
  wearerSafetyPatchToColumns,
  type WearerSafetySettings,
} from '../src/server/wearer-safety-settings.js';
import { createApprovalCenter } from '../src/server/pishock/pending-approvals.js';
import { createCheckInManager } from '../src/server/checkin-manager.js';
import { personalBandsFromUser, shareBandsFromRow } from '../src/server/limit-bands.js';

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

function deps(settings: Partial<WearerSafetySettings>, extra: Partial<GateDeps> = {}, c = clock()): GateDeps {
  return {
    settings: { ...DEFAULT_WEARER_SAFETY, ...settings },
    isFavorite: async () => false,
    getBudget: async () => ({ usedShocks: 0, usedShockMs: 0, periodStartedAt: null }),
    cooldowns: createCooldownTracker(c.now),
    ...extra,
  };
}

const ctx = (over: Partial<GateContext> = {}): GateContext => ({
  ownerDiscordUserId: 'owner',
  executorDiscordUserId: 'sender',
  operation: 'shock',
  durationMs: 1000,
  batchId: null,
  queueEnabled: false,
  ...over,
});

async function refusal(p: Promise<unknown>): Promise<WearerGateError> {
  try {
    await p;
  } catch (err) {
    assert.ok(err instanceof WearerGateError);
    return err;
  }
  assert.fail('expected a WearerGateError');
}

describe('settings mapping', () => {
  it('clamps and ignores bad fields', () => {
    const cols = wearerSafetyPatchToColumns({
      approveEachCommand: true,
      approvalTimeoutMs: 1,
      cooldownGlobalMs: -50,
      cooldownPerSenderMs: 'x',
      budgetMaxShocks: 0,
      budgetPeriod: 'week',
      budgetTimezone: 'Europe/Amsterdam',
      unknown: 1,
    });
    assert.equal(cols.approveEachCommand, true);
    assert.equal(cols.approvalTimeoutMs, 5_000);
    assert.equal(cols.cooldownGlobalMs, 0);
    assert.equal('cooldownPerSenderMs' in cols, false);
    assert.equal(cols.budgetMaxShocks, null, '0 clears the cap');
    assert.equal('budgetPeriod' in cols, false);
    assert.equal(cols.budgetTimezone, 'Europe/Amsterdam');
    assert.equal('unknown' in cols, false);
  });

  it('rejects unknown timezones', () => {
    assert.equal(wearerSafetyPatchToColumns({ budgetTimezone: 'Mars/Base' }).budgetTimezone, null);
  });

  it('defaults when the row is missing', () => {
    assert.deepEqual(wearerSafetyFromColumns(null), DEFAULT_WEARER_SAFETY);
    assert.equal(wearerSafetyFromColumns({ budgetPeriod: 'nope' }).budgetPeriod, 'session');
  });

  it('person limit patch clamps to device ranges', () => {
    const cols = personLimitPatchToColumns({ shockMaxIntensity: 500, vibMaxDurationMs: 1, canShock: false });
    assert.equal(cols.shockMaxIntensity, 100);
    assert.equal(cols.vibMaxDurationMs, 16);
    assert.equal(cols.canShock, false);
  });
});

describe('gates', () => {
  it('lets everything through with defaults', async () => {
    const res = await checkWearerGates(deps({}), ctx());
    assert.deepEqual(res, { bypassed: [], needsApproval: false });
  });

  it('favorites only refuses non-favorites and allows favorites', async () => {
    const err = await refusal(checkWearerGates(deps({ favoritesOnly: true }), ctx()));
    assert.equal(err.code, 'FAVORITES_ONLY');
    await checkWearerGates(deps({ favoritesOnly: true }, { isFavorite: async () => true }), ctx());
  });

  it('cooldown refuses within the gap and reports retryAfter', async () => {
    const c = clock();
    const d = deps({ cooldownPerSenderMs: 5_000 }, {}, c);
    await checkWearerGates(d, ctx());
    d.cooldowns.record('owner', 'sender', null);
    c.advance(2_000);
    const err = await refusal(checkWearerGates(d, ctx()));
    assert.equal(err.code, 'COOLDOWN');
    assert.equal(err.retryAfterMs, 3_000);
    // Another sender is fine (per-sender only).
    await checkWearerGates(d, ctx({ executorDiscordUserId: 'other' }));
    c.advance(3_000);
    await checkWearerGates(d, ctx());
  });

  it('global cooldown applies across senders', async () => {
    const c = clock();
    const d = deps({ cooldownGlobalMs: 4_000 }, {}, c);
    d.cooldowns.record('owner', 'a', null);
    const err = await refusal(checkWearerGates(d, ctx({ executorDiscordUserId: 'b' })));
    assert.equal(err.code, 'COOLDOWN');
  });

  it('a multishock batch is not blocked by its own cooldown', async () => {
    const c = clock();
    const d = deps({ cooldownPerSenderMs: 5_000, cooldownGlobalMs: 5_000 }, {}, c);
    d.cooldowns.record('owner', 'sender', 'batch-1');
    await checkWearerGates(d, ctx({ batchId: 'batch-1' }));
    await refusal(checkWearerGates(d, ctx({ batchId: 'batch-2' })));
  });

  it('cooldown is left to the queue when the queue is on', async () => {
    const d = deps({ cooldownPerSenderMs: 5_000 });
    d.cooldowns.record('owner', 'sender', null);
    await checkWearerGates(d, ctx({ queueEnabled: true }));
  });

  it('budget refuses shocks once used up but not vibrate/beep', async () => {
    const d = deps(
      { budgetEnabled: true, budgetMaxShocks: 3 },
      { getBudget: async () => ({ usedShocks: 3, usedShockMs: 0, periodStartedAt: null }) },
    );
    const err = await refusal(checkWearerGates(d, ctx()));
    assert.equal(err.code, 'BUDGET_EXHAUSTED');
    await checkWearerGates(d, ctx({ operation: 'vibrate' }));
    await checkWearerGates(d, ctx({ operation: 'beep' }));
  });

  it('approve-each asks for approval', async () => {
    const res = await checkWearerGates(deps({ approveEachCommand: true }), ctx());
    assert.equal(res.needsApproval, true);
  });

  it('bypass skips only the listed gates and reports them', async () => {
    const d = deps({ favoritesOnly: true, approveEachCommand: true });
    const res = await checkWearerGates(d, ctx({ bypass: new Set(['favorites', 'approval']) }));
    assert.deepEqual(res, { bypassed: ['favorites', 'approval'], needsApproval: false });
  });
});

describe('budget', () => {
  it('counts shocks and shock time', () => {
    const s = { budgetEnabled: true, budgetMaxShocks: 5, budgetMaxShockMs: 10_000 };
    assert.deepEqual(checkBudget(s, { usedShocks: 2, usedShockMs: 4_000 }, 1_000), {
      ok: true,
      remainingShocks: 3,
      remainingShockMs: 6_000,
    });
    assert.deepEqual(checkBudget(s, { usedShocks: 2, usedShockMs: 9_500 }, 1_000), {
      ok: false,
      reason: 'time',
    });
    assert.deepEqual(checkBudget(s, { usedShocks: 5, usedShockMs: 0 }, 1), { ok: false, reason: 'shocks' });
  });

  it('day budget expires on the next calendar day in the wearer timezone', () => {
    const settings = { budgetPeriod: 'day' as const, budgetTimezone: 'Europe/Amsterdam' };
    // 22:30 UTC = 23:30 Amsterdam (winter); 23:30 UTC = 00:30 next day in Amsterdam.
    const started = new Date('2026-11-18T22:30:00Z');
    assert.equal(dayBudgetExpired(settings, { periodStartedAt: started }, new Date('2026-11-18T22:50:00Z')), false);
    assert.equal(dayBudgetExpired(settings, { periodStartedAt: started }, new Date('2026-11-18T23:30:00Z')), true);
    assert.equal(dayKey(started, 'UTC'), '2026-11-18');
  });

  it('day expiry is ignored for session / manual budgets', () => {
    const started = new Date('2026-11-01T00:00:00Z');
    const later = new Date('2026-11-18T00:00:00Z');
    assert.equal(dayBudgetExpired({ budgetPeriod: 'manual', budgetTimezone: null }, { periodStartedAt: started }, later), false);
    assert.equal(dayBudgetExpired({ budgetPeriod: 'session', budgetTimezone: null }, { periodStartedAt: started }, later), false);
  });

  it('session budget refills after a long enough absence only', () => {
    const now = new Date('2026-11-18T12:00:00Z');
    assert.equal(sessionBudgetShouldReset({ budgetPeriod: 'session' }, new Date('2026-11-18T11:55:00Z'), now), false);
    assert.equal(sessionBudgetShouldReset({ budgetPeriod: 'session' }, new Date('2026-11-18T11:40:00Z'), now), true);
    assert.equal(sessionBudgetShouldReset({ budgetPeriod: 'manual' }, new Date('2026-11-17T11:40:00Z'), now), false);
  });
});

describe('escalation cap', () => {
  it('limits the jump over the previous shock and resets after the window', () => {
    const c = clock();
    const esc = createEscalationTracker(c.now, 60_000);
    assert.equal(esc.cap('o', 1, null, 5), null, 'off without a step');
    assert.equal(esc.cap('o', 1, 10, 5), 15, 'first shock: min + step');
    esc.record('o', 1, 30);
    assert.equal(esc.cap('o', 1, 10, 5), 40);
    assert.equal(esc.cap('o', 2, 10, 5), 15, 'per shocker');
    c.advance(61_000);
    assert.equal(esc.cap('o', 1, 10, 5), 15);
  });

  it('clamps intensity above the cap', () => {
    assert.deepEqual(applyEscalationCap(80, 40), { intensity: 40, clamped: true });
    assert.deepEqual(applyEscalationCap(30, 40), { intensity: 30, clamped: false });
    assert.deepEqual(applyEscalationCap(80, null), { intensity: 80, clamped: false });
  });
});

describe('per-person limits', () => {
  const share = shareBandsFromRow({ minIntensity: 10, maxIntensity: 80, deviceMaxIntensity: 100 });
  const personal = personalBandsFromUser(null);
  const device = { maxIntensity: 100, maxDurationMs: 15_000 };
  const row = {
    shockMaxIntensity: 30,
    shockMaxDurationMs: 2_000,
    vibMaxIntensity: null,
    vibMaxDurationMs: null,
    beepMaxIntensity: null,
    beepMaxDurationMs: null,
    canShock: true,
    canVibrate: true,
    canBeep: false,
  };

  it('nests the person cap under share + personal limits', () => {
    const modes = buildEffectiveModes(share, personal, device, 'none', row);
    assert.equal(modes.shock.maxIntensity, 30);
    assert.equal(modes.shock.maxDurationMs, 2_000);
    assert.equal(modes.shock.minIntensity, 10);
    assert.equal(modes.vibrate.maxIntensity, 80);
  });

  it('never raises limits', () => {
    const modes = buildEffectiveModes(share, personal, device, 'none', { ...row, shockMaxIntensity: 100 });
    assert.equal(modes.shock.maxIntensity, 80);
  });

  it('blocks modes the person may not use, including caps below the minimum', () => {
    const modes = buildEffectiveModes(share, personal, device, 'none', { ...row, shockMaxIntensity: 5 });
    assert.throws(() => assertPersonAllows(modes, 'shock'), (e: unknown) => e instanceof WearerGateError && e.code === 'PERSON_LIMIT');
    assert.throws(() => assertPersonAllows(modes, 'beep'));
    assertPersonAllows(modes, 'vibrate');
    assertPersonAllows(modes, 'warning');
  });

  it('without a row nothing changes', () => {
    const modes = buildEffectiveModes(share, personal, device, 'none', null);
    assert.equal(modes.shock.maxIntensity, 80);
    assert.deepEqual(modes.personAllows, { shock: true, vibrate: true, beep: true });
  });
});

describe('approval center', () => {
  function center() {
    const events: Array<{ type: string; to: string[]; approvalId: string; items?: unknown[]; outcome?: string }> = [];
    const timers: Array<{ fn: () => void; at: number }> = [];
    const c = clock();
    const ac = createApprovalCenter({
      now: c.now,
      emit: (e, to) => events.push({ ...(e as never), to }),
      setTimer: (fn, ms) => {
        timers.push({ fn, at: c.now() + ms });
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: (t) => {
        const i = (t as unknown as number) - 1;
        if (timers[i]) timers[i]!.fn = () => undefined;
      },
    });
    const fire = (ms: number) => {
      c.advance(ms);
      for (const t of timers) if (t.at <= c.now()) t.fn();
    };
    return { ac, events, fire, c };
  }
  const sender = { id: 'sender', username: 's', globalName: null, avatar: null };
  const item = (shockerId: number) => ({ shockerId, shockerName: null, intensity: 10, durationMs: 500 });

  it('accept resolves the waiting sender and notifies both sides', async () => {
    const { ac, events } = center();
    const { approvalId, outcome } = ac.request({
      ownerDiscordUserId: 'owner', sender, operation: 'shock', batchId: null, item: item(1), timeoutMs: 10_000,
    });
    assert.equal(events[0]!.type, 'approval_request');
    assert.deepEqual(events[0]!.to, ['owner']);
    assert.equal(ac.resolve('someone-else', approvalId, true), false, 'only the wearer can answer');
    assert.equal(ac.resolve('owner', approvalId, true), true);
    assert.equal(await outcome, 'accepted');
    assert.deepEqual(events.at(-1)!.to, ['owner', 'sender']);
  });

  it('expires after the timeout', async () => {
    const { ac, fire } = center();
    const { outcome } = ac.request({
      ownerDiscordUserId: 'owner', sender, operation: 'shock', batchId: null, item: item(1), timeoutMs: 5_000,
    });
    fire(5_000);
    assert.equal(await outcome, 'expired');
  });

  it('groups one multishock batch into a single prompt', async () => {
    const { ac, events } = center();
    const a = ac.request({ ownerDiscordUserId: 'owner', sender, operation: 'shock', batchId: 'b1', item: item(1), timeoutMs: 5_000 });
    const b = ac.request({ ownerDiscordUserId: 'owner', sender, operation: 'shock', batchId: 'b1', item: item(2), timeoutMs: 5_000 });
    assert.equal(a.approvalId, b.approvalId);
    assert.equal((events.at(-1)!.items as unknown[]).length, 2);
    ac.resolve('owner', a.approvalId, false);
    assert.equal(await a.outcome, 'denied');
    assert.equal(await b.outcome, 'denied');
  });

  it('E-STOP cancels every open prompt for the wearer only', async () => {
    const { ac } = center();
    const mine = ac.request({ ownerDiscordUserId: 'owner', sender, operation: 'shock', batchId: null, item: item(1), timeoutMs: 5_000 });
    const other = ac.request({ ownerDiscordUserId: 'other', sender, operation: 'shock', batchId: null, item: item(1), timeoutMs: 5_000 });
    assert.equal(ac.cancelAllFor('owner'), 1);
    assert.equal(await mine.outcome, 'canceled');
    assert.equal(ac.listFor('other').length, 1);
    ac.resolve('other', other.approvalId, true);
  });
});

describe('check-ins', () => {
  function manager(opts: { enabled?: boolean; active?: boolean } = {}) {
    const timers: Array<{ fn: () => void; at: number; dead?: boolean }> = [];
    const c = clock();
    const due: number[] = [];
    const missed: string[] = [];
    const m = createCheckInManager({
      now: c.now,
      setTimer: (fn, ms) => {
        const t = { fn, at: c.now() + ms };
        timers.push(t);
        return t as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: (t) => {
        (t as unknown as { dead: boolean }).dead = true;
      },
      getSettings: async () => ({ enabled: opts.enabled ?? true, intervalMs: 60_000, graceMs: 10_000 }),
      hasActiveShares: async () => opts.active ?? true,
      onDue: (_o, deadline) => due.push(deadline),
      onMissed: async (o) => {
        missed.push(o);
      },
    });
    const fire = async (ms: number) => {
      c.advance(ms);
      for (const t of [...timers]) {
        if (!t.dead && t.at <= c.now()) {
          t.dead = true;
          t.fn();
        }
      }
      await Promise.resolve();
    };
    return { m, due, missed, fire };
  }

  it('asks after the interval and pauses when the grace runs out', async () => {
    const { m, due, missed, fire } = manager();
    await m.refresh('owner');
    await fire(60_000);
    assert.equal(due.length, 1);
    assert.ok(m.pendingDeadline('owner'));
    await fire(10_000);
    assert.deepEqual(missed, ['owner']);
  });

  it('answering in time restarts the interval', async () => {
    const { m, due, missed, fire } = manager();
    await m.refresh('owner');
    await fire(60_000);
    assert.equal(await m.ack('owner'), true);
    await fire(10_000);
    assert.deepEqual(missed, []);
    await fire(50_000);
    assert.equal(due.length, 2);
  });

  it('does nothing when off, without active shares, or after going offline', async () => {
    for (const opts of [{ enabled: false }, { active: false }]) {
      const { m, due, fire } = manager(opts);
      await m.refresh('owner');
      await fire(120_000);
      assert.equal(due.length, 0);
    }
    const { m, due, fire } = manager();
    await m.refresh('owner');
    m.stop('owner');
    await fire(120_000);
    assert.equal(due.length, 0);
  });
});
