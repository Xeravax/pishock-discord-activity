/**
 * Roulette: a wheel of mixed actions (shock / vibrate / beep / safe), every segment
 * clamped to the wearer's effective limits. Started solo or by a room vote (majority
 * of voters, at least 2 yes, the wearer can veto). Everyone who should see the spin
 * gets the identical payload (segments + result + start time), so all wheels land on
 * the same segment. The result then goes through the normal command gates.
 */
import { randomInt, randomUUID } from 'node:crypto';
import type { IntensityDurationBand } from './limit-bands.js';

export type RouletteAction = 'shock' | 'vibrate' | 'beep' | 'safe';
export const ROULETTE_ACTIONS: readonly RouletteAction[] = ['shock', 'vibrate', 'beep', 'safe'];

export type RouletteSegment = { action: RouletteAction; intensity: number; durationMs: number };

export const ROULETTE_MIN_SEGMENTS = 8;
export const ROULETTE_MAX_SEGMENTS = 12;
export const ROULETTE_VOTE_MS = 20_000;
export const ROULETTE_LEAD_MS = 800;
export const ROULETTE_SPIN_MS = 4_500;

export type RouletteBands = Partial<Record<Exclude<RouletteAction, 'safe'>, IntensityDurationBand>>;

type Rand = (minInclusive: number, maxExclusive: number) => number;

function pickIn(band: IntensityDurationBand, rand: Rand, maxIntensity?: number | null) {
  const hiI = Math.max(band.minIntensity, Math.min(band.maxIntensity, maxIntensity ?? band.maxIntensity));
  // Durations in 100 ms steps between the band edges (wheel labels stay readable).
  const loD = Math.ceil(band.minDurationMs / 100);
  const hiD = Math.max(loD, Math.floor(Math.min(band.maxDurationMs, 5_000) / 100));
  return {
    intensity: rand(band.minIntensity, hiI + 1),
    durationMs: Math.max(band.minDurationMs, Math.min(band.maxDurationMs, rand(loD, hiD + 1) * 100)),
  };
}

/**
 * Build wheel segments. Only actions that are both requested and allowed (have a band)
 * appear; "safe" (nothing happens) needs no band. Shock intensity also respects the
 * escalation cap so the wheel never shows a value that would be lowered later.
 */
export function buildSegments(input: {
  actions: readonly RouletteAction[];
  bands: RouletteBands;
  shockCap?: number | null;
  rand?: Rand;
  count?: number;
}): RouletteSegment[] {
  const rand = input.rand ?? ((a, b) => randomInt(a, b));
  const usable = [...new Set(input.actions)].filter(
    (a) => a === 'safe' || Boolean(input.bands[a]),
  );
  if (!usable.length) return [];
  const count =
    input.count ?? rand(ROULETTE_MIN_SEGMENTS, ROULETTE_MAX_SEGMENTS + 1);
  const out: RouletteSegment[] = [];
  for (let i = 0; i < count; i++) {
    // Cycle through actions so every chosen action shows up on the wheel.
    const action = usable[i % usable.length]!;
    if (action === 'safe') {
      out.push({ action, intensity: 0, durationMs: 0 });
      continue;
    }
    const band = input.bands[action]!;
    out.push({ action, ...pickIn(band, rand, action === 'shock' ? input.shockCap : null) });
  }
  // Shuffle so the cycle is not obvious.
  for (let i = out.length - 1; i > 0; i--) {
    const j = rand(0, i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export type VoteTally = { yes: number; no: number; vetoed: boolean };

export function votePasses(t: VoteTally): boolean {
  return !t.vetoed && t.yes >= 2 && t.yes > t.no;
}

// ---------------------------------------------------------------------------

export type SpinPayload = {
  spinId: string;
  targetDiscordUserId: string;
  starterDiscordUserId: string;
  shockerId: number;
  segments: RouletteSegment[];
  resultIndex: number;
  startAt: number;
  spinMs: number;
  /** Everyone who sees this exact spin. */
  viewers: string[];
  /** Server-only context for execution (never sent to clients). */
  meta?: unknown;
};

export type VoteState = {
  voteId: string;
  instanceId: string;
  targetDiscordUserId: string;
  starterDiscordUserId: string;
  shockerId: number;
  segments: RouletteSegment[];
  endsAt: number;
  votes: Map<string, boolean>;
  vetoed: boolean;
  /** Server-only context for execution (never sent to clients). */
  meta?: unknown;
};

export type RouletteDeps = {
  now?: () => number;
  rand?: Rand;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (t: ReturnType<typeof setTimeout>) => void;
  /** Show the spin (identical payload) to these users. */
  emitSpin: (spin: SpinPayload) => void;
  emitVoteOpen: (vote: VoteState) => void;
  emitVoteClosed: (vote: VoteState, outcome: 'passed' | 'failed' | 'vetoed' | 'canceled', tally: VoteTally) => void;
  /** Send the landed segment through the normal command pipeline. */
  execute: (spin: SpinPayload, segment: RouletteSegment) => Promise<void>;
};

export function createRouletteCenter(deps: RouletteDeps) {
  const now = deps.now ?? (() => Date.now());
  const rand = deps.rand ?? ((a: number, b: number) => randomInt(a, b));
  const setTimer = deps.setTimer ?? ((fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  });
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t));
  const votes = new Map<string, VoteState & { timer: ReturnType<typeof setTimeout> }>();
  const spins = new Map<string, { spin: SpinPayload; timer: ReturnType<typeof setTimeout> }>();

  function tally(v: VoteState): VoteTally {
    let yes = 0;
    let no = 0;
    for (const choice of v.votes.values()) {
      if (choice) yes += 1;
      else no += 1;
    }
    return { yes, no, vetoed: v.vetoed };
  }

  function spin(input: {
    targetDiscordUserId: string;
    starterDiscordUserId: string;
    shockerId: number;
    segments: RouletteSegment[];
    viewers: string[];
    meta?: unknown;
  }): SpinPayload {
    const payload: SpinPayload = {
      meta: input.meta,
      spinId: randomUUID(),
      targetDiscordUserId: input.targetDiscordUserId,
      starterDiscordUserId: input.starterDiscordUserId,
      shockerId: input.shockerId,
      segments: input.segments,
      resultIndex: rand(0, input.segments.length),
      startAt: now() + ROULETTE_LEAD_MS,
      spinMs: ROULETTE_SPIN_MS,
      viewers: [...new Set(input.viewers)],
    };
    deps.emitSpin(payload);
    const timer = setTimer(() => {
      spins.delete(payload.spinId);
      void deps.execute(payload, payload.segments[payload.resultIndex]!).catch(() => undefined);
    }, ROULETTE_LEAD_MS + ROULETTE_SPIN_MS);
    spins.set(payload.spinId, { spin: payload, timer });
    return payload;
  }

  function close(voteId: string, forced?: 'vetoed' | 'canceled') {
    const v = votes.get(voteId);
    if (!v) return;
    votes.delete(voteId);
    clearTimer(v.timer);
    const t = tally(v);
    const outcome = forced ?? (votePasses(t) ? 'passed' : 'failed');
    deps.emitVoteClosed(v, outcome, t);
    if (outcome === 'passed') {
      spin({
        targetDiscordUserId: v.targetDiscordUserId,
        starterDiscordUserId: v.starterDiscordUserId,
        shockerId: v.shockerId,
        segments: v.segments,
        // Starter + everyone who voted (yes or no) see the same spin.
        viewers: [v.starterDiscordUserId, ...v.votes.keys()],
        meta: v.meta,
      });
    }
  }

  return {
    startSolo(input: {
      targetDiscordUserId: string;
      starterDiscordUserId: string;
      shockerId: number;
      segments: RouletteSegment[];
      meta?: unknown;
    }): SpinPayload {
      return spin({ ...input, viewers: [input.starterDiscordUserId] });
    },

    startVote(input: {
      instanceId: string;
      targetDiscordUserId: string;
      starterDiscordUserId: string;
      shockerId: number;
      segments: RouletteSegment[];
      meta?: unknown;
    }): VoteState {
      for (const v of votes.values()) {
        if (v.targetDiscordUserId === input.targetDiscordUserId) {
          throw new Error('A vote for this person is already running');
        }
      }
      const voteId = randomUUID();
      const state: VoteState = {
        ...input,
        voteId,
        endsAt: now() + ROULETTE_VOTE_MS,
        // The starter's own vote counts as yes.
        votes: new Map([[input.starterDiscordUserId, true]]),
        vetoed: false,
      };
      const timer = setTimer(() => close(voteId), ROULETTE_VOTE_MS);
      votes.set(voteId, { ...state, timer });
      deps.emitVoteOpen(state);
      return state;
    },

    /** The wearer can't vote — only veto. */
    vote(voteId: string, voterId: string, yes: boolean): VoteTally | null {
      const v = votes.get(voteId);
      if (!v || voterId === v.targetDiscordUserId) return null;
      v.votes.set(voterId, yes);
      return tally(v);
    },

    veto(voteId: string, wearerId: string): boolean {
      const v = votes.get(voteId);
      if (!v || v.targetDiscordUserId !== wearerId) return false;
      v.vetoed = true;
      close(voteId, 'vetoed');
      return true;
    },

    /** E-STOP / wearer turned roulette off: cancel open votes and spins not yet executed. */
    cancelForTarget(targetDiscordUserId: string): number {
      let n = 0;
      for (const [id, v] of [...votes]) {
        if (v.targetDiscordUserId === targetDiscordUserId) {
          close(id, 'canceled');
          n += 1;
        }
      }
      for (const [id, s] of [...spins]) {
        if (s.spin.targetDiscordUserId === targetDiscordUserId) {
          clearTimer(s.timer);
          spins.delete(id);
          n += 1;
        }
      }
      return n;
    },

    getVote(voteId: string): VoteState | undefined {
      return votes.get(voteId);
    },
  };
}

export type RouletteCenter = ReturnType<typeof createRouletteCenter>;
