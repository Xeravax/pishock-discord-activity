import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ROULETTE_LEAD_MS,
  ROULETTE_SPIN_MS,
  ROULETTE_VOTE_MS,
  buildSegments,
  createRouletteCenter,
  votePasses,
  type SpinPayload,
} from '../src/server/roulette.js';

const band = (minI: number, maxI: number, minD = 300, maxD = 2_000) => ({
  minIntensity: minI,
  maxIntensity: maxI,
  minDurationMs: minD,
  maxDurationMs: maxD,
});

describe('roulette segments', () => {
  it('every segment stays inside the wearer’s band', () => {
    for (let run = 0; run < 50; run++) {
      const segments = buildSegments({
        actions: ['shock', 'vibrate', 'beep', 'safe'],
        bands: { shock: band(10, 40), vibrate: band(20, 80), beep: band(1, 100) },
      });
      assert.ok(segments.length >= 8 && segments.length <= 12);
      for (const s of segments) {
        if (s.action === 'safe') continue;
        const b = s.action === 'shock' ? band(10, 40) : s.action === 'vibrate' ? band(20, 80) : band(1, 100);
        assert.ok(s.intensity >= b.minIntensity && s.intensity <= b.maxIntensity, `${s.action} ${s.intensity}`);
        assert.ok(s.durationMs >= b.minDurationMs && s.durationMs <= b.maxDurationMs, `${s.durationMs}`);
      }
    }
  });

  it('respects the escalation cap for shocks', () => {
    for (let run = 0; run < 30; run++) {
      const segments = buildSegments({ actions: ['shock'], bands: { shock: band(5, 90) }, shockCap: 25 });
      assert.ok(segments.every((s) => s.intensity <= 25));
    }
  });

  it('drops actions the wearer does not allow, keeps every allowed one', () => {
    const segments = buildSegments({
      actions: ['shock', 'beep', 'safe'],
      bands: { beep: band(1, 10) },
      count: 9,
    });
    const kinds = new Set(segments.map((s) => s.action));
    assert.deepEqual([...kinds].sort(), ['beep', 'safe']);
    assert.deepEqual(buildSegments({ actions: ['shock'], bands: {} }), []);
  });
});

describe('roulette vote', () => {
  it('needs a majority of voters, at least two yes, and no veto', () => {
    assert.equal(votePasses({ yes: 1, no: 0, vetoed: false }), false);
    assert.equal(votePasses({ yes: 2, no: 2, vetoed: false }), false);
    assert.equal(votePasses({ yes: 3, no: 2, vetoed: false }), true);
    assert.equal(votePasses({ yes: 5, no: 0, vetoed: true }), false);
  });
});

describe('roulette center', () => {
  function harness() {
    let now = 0;
    const timers: Array<{ at: number; fn: () => void; dead?: boolean }> = [];
    const spins: SpinPayload[] = [];
    const closed: string[] = [];
    const executed: string[] = [];
    const center = createRouletteCenter({
      now: () => now,
      rand: (a) => a,
      setTimer: (fn, ms) => {
        const t = { at: now + ms, fn };
        timers.push(t);
        return t as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: (t) => {
        (t as unknown as { dead: boolean }).dead = true;
      },
      emitSpin: (s) => spins.push(s),
      emitVoteOpen: () => undefined,
      emitVoteClosed: (_v, outcome) => closed.push(outcome),
      execute: async (spin) => {
        executed.push(spin.spinId);
      },
    });
    const advance = (ms: number) => {
      now += ms;
      for (const t of [...timers]) {
        if (!t.dead && t.at <= now) {
          t.dead = true;
          t.fn();
        }
      }
    };
    return { center, spins, closed, executed, advance };
  }
  const segments = [
    { action: 'shock' as const, intensity: 10, durationMs: 500 },
    { action: 'safe' as const, intensity: 0, durationMs: 0 },
  ];

  it('solo: only the starter sees it, and it executes after the spin', () => {
    const h = harness();
    const spin = h.center.startSolo({ targetDiscordUserId: 't', starterDiscordUserId: 's', shockerId: 1, segments });
    assert.deepEqual(spin.viewers, ['s']);
    h.advance(ROULETTE_LEAD_MS + ROULETTE_SPIN_MS - 1);
    assert.equal(h.executed.length, 0);
    h.advance(1);
    assert.deepEqual(h.executed, [spin.spinId]);
  });

  it('vote: everyone who voted gets the identical spin; the wearer can only veto', () => {
    const h = harness();
    const vote = h.center.startVote({
      instanceId: 'i', targetDiscordUserId: 't', starterDiscordUserId: 's', shockerId: 1, segments,
    });
    assert.equal(h.center.vote(vote.voteId, 't', true), null, 'wearer cannot vote');
    h.center.vote(vote.voteId, 'a', true);
    h.center.vote(vote.voteId, 'b', false);
    h.advance(ROULETTE_VOTE_MS);
    assert.deepEqual(h.closed, ['passed']);
    assert.equal(h.spins.length, 1);
    assert.deepEqual([...h.spins[0]!.viewers].sort(), ['a', 'b', 's']);
  });

  it('veto ends the vote without a spin', () => {
    const h = harness();
    const vote = h.center.startVote({
      instanceId: 'i', targetDiscordUserId: 't', starterDiscordUserId: 's', shockerId: 1, segments,
    });
    h.center.vote(vote.voteId, 'a', true);
    assert.equal(h.center.veto(vote.voteId, 'a'), false, 'only the wearer can veto');
    assert.equal(h.center.veto(vote.voteId, 't'), true);
    assert.deepEqual(h.closed, ['vetoed']);
    h.advance(ROULETTE_VOTE_MS);
    assert.equal(h.spins.length, 0);
  });

  it('E-STOP cancels open votes and spins that have not executed', () => {
    const h = harness();
    h.center.startSolo({ targetDiscordUserId: 't', starterDiscordUserId: 's', shockerId: 1, segments });
    h.center.startVote({ instanceId: 'i', targetDiscordUserId: 't', starterDiscordUserId: 's', shockerId: 1, segments });
    assert.equal(h.center.cancelForTarget('t'), 2);
    h.advance(60_000);
    assert.deepEqual(h.executed, []);
    assert.deepEqual(h.closed, ['canceled']);
  });
});
