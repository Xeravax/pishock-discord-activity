/**
 * Wearer safety gates shared by every execution path (direct participant operate,
 * queued dispatch, cross-user share codes). Pure logic + small in-memory trackers;
 * DB / realtime wiring lives in wearer-safety-runtime.ts.
 *
 * Never-bypassable checks (E-STOP, consent, bans, pauses, mode permissions, required
 * warning, device max) stay where they already are — these gates only add to them.
 */
import { nestBands, type IntensityDurationBand, type ModeLimitBands } from './limit-bands.js';
import type { WarningLevel } from '../shared/warning.js';
import type { PersonLimitColumns, WearerSafetySettings } from './wearer-safety-settings.js';
import { personLimitBands } from './wearer-safety-settings.js';

export type SafetyGate = 'favorites' | 'cooldown' | 'budget' | 'approval';

/** How long a wearer must be gone before a "session" budget refills. */
export const SESSION_GAP_MS = 10 * 60_000;
/** Escalation looks at the previous shock on the same shocker within this window. */
export const ESCALATION_WINDOW_MS = 10 * 60_000;

export class WearerGateError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterMs?: number;
  constructor(message: string, status: number, code: string, retryAfterMs?: number) {
    super(message);
    this.name = 'WearerGateError';
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
  toBody() {
    return {
      error: this.message,
      code: this.code,
      ...(this.retryAfterMs != null ? { retryAfterMs: this.retryAfterMs } : {}),
    };
  }
}

// ---------------------------------------------------------------------------
// Operations

/** Only real shocks consume budget / count for escalation. */
export function isShockOperation(operation: string): boolean {
  return operation === 'shock' || operation === 'hold';
}

// ---------------------------------------------------------------------------
// Cooldowns

type CooldownMark = { at: number; batchId: string | null };

/**
 * Remembers the last admitted command per (wearer, sender) and per wearer.
 * Commands from the same multishock batch share one slot so a single fire at
 * several shockers is not blocked by its own cooldown.
 */
export function createCooldownTracker(now: () => number = () => Date.now()) {
  const bySender = new Map<string, CooldownMark>();
  const byOwner = new Map<string, CooldownMark>();

  function remaining(mark: CooldownMark | undefined, gapMs: number, batchId: string | null): number {
    if (!mark || gapMs <= 0) return 0;
    if (batchId && mark.batchId === batchId) return 0;
    return Math.max(0, mark.at + gapMs - now());
  }

  return {
    /** ms until this sender may command this wearer again (0 = now). */
    retryAfter(
      ownerId: string,
      senderId: string,
      perSenderMs: number,
      globalMs: number,
      batchId: string | null,
    ): number {
      return Math.max(
        remaining(bySender.get(`${ownerId}:${senderId}`), perSenderMs, batchId),
        remaining(byOwner.get(ownerId), globalMs, batchId),
      );
    },
    record(ownerId: string, senderId: string, batchId: string | null) {
      const mark = { at: now(), batchId };
      bySender.set(`${ownerId}:${senderId}`, mark);
      byOwner.set(ownerId, mark);
    },
    clearOwner(ownerId: string) {
      byOwner.delete(ownerId);
      for (const key of bySender.keys()) if (key.startsWith(`${ownerId}:`)) bySender.delete(key);
    },
  };
}
export type CooldownTracker = ReturnType<typeof createCooldownTracker>;

// ---------------------------------------------------------------------------
// Escalation cap (per shocker)

export function createEscalationTracker(
  now: () => number = () => Date.now(),
  windowMs = ESCALATION_WINDOW_MS,
) {
  const last = new Map<string, { intensity: number; at: number }>();
  return {
    /**
     * Highest shock intensity allowed next, or null when the cap is off.
     * Without a recent shock the baseline is the band minimum.
     */
    cap(ownerId: string, shockerId: number, step: number | null | undefined, bandMin: number): number | null {
      if (step == null || !Number.isFinite(step) || step <= 0) return null;
      const prev = last.get(`${ownerId}:${shockerId}`);
      const base = prev && now() - prev.at <= windowMs ? prev.intensity : bandMin;
      return Math.max(bandMin, base + Math.floor(step));
    },
    record(ownerId: string, shockerId: number, intensity: number) {
      last.set(`${ownerId}:${shockerId}`, { intensity, at: now() });
    },
    clearOwner(ownerId: string) {
      for (const key of last.keys()) if (key.startsWith(`${ownerId}:`)) last.delete(key);
    },
  };
}
export type EscalationTracker = ReturnType<typeof createEscalationTracker>;

export function applyEscalationCap(
  intensity: number,
  cap: number | null,
): { intensity: number; clamped: boolean } {
  if (cap == null || intensity <= cap) return { intensity, clamped: false };
  return { intensity: cap, clamped: true };
}

// ---------------------------------------------------------------------------
// Shock budget

export type BudgetState = {
  usedShocks: number;
  usedShockMs: number;
  periodStartedAt: Date | null;
};

/** Calendar day (YYYY-MM-DD) of `date` in `timeZone` (falls back to UTC). */
export function dayKey(date: Date, timeZone: string | null): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone ?? 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** True when a "day" budget belongs to an earlier calendar day than now. */
export function dayBudgetExpired(
  settings: Pick<WearerSafetySettings, 'budgetPeriod' | 'budgetTimezone'>,
  state: Pick<BudgetState, 'periodStartedAt'>,
  now: Date,
): boolean {
  if (settings.budgetPeriod !== 'day' || !state.periodStartedAt) return false;
  return dayKey(state.periodStartedAt, settings.budgetTimezone) !== dayKey(now, settings.budgetTimezone);
}

/** True when a "session" budget should refill because the wearer was away long enough. */
export function sessionBudgetShouldReset(
  settings: Pick<WearerSafetySettings, 'budgetPeriod'>,
  lastSeenAt: Date | null,
  now: Date,
  gapMs = SESSION_GAP_MS,
): boolean {
  if (settings.budgetPeriod !== 'session' || !lastSeenAt) return false;
  return now.getTime() - lastSeenAt.getTime() >= gapMs;
}

export type BudgetCheck =
  | { ok: true; remainingShocks: number | null; remainingShockMs: number | null }
  | { ok: false; reason: 'shocks' | 'time' };

export function checkBudget(
  settings: Pick<WearerSafetySettings, 'budgetEnabled' | 'budgetMaxShocks' | 'budgetMaxShockMs'>,
  state: Pick<BudgetState, 'usedShocks' | 'usedShockMs'>,
  durationMs: number,
): BudgetCheck {
  if (!settings.budgetEnabled) return { ok: true, remainingShocks: null, remainingShockMs: null };
  const remainingShocks =
    settings.budgetMaxShocks == null ? null : Math.max(0, settings.budgetMaxShocks - state.usedShocks);
  const remainingShockMs =
    settings.budgetMaxShockMs == null ? null : Math.max(0, settings.budgetMaxShockMs - state.usedShockMs);
  if (remainingShocks != null && remainingShocks < 1) return { ok: false, reason: 'shocks' };
  if (remainingShockMs != null && remainingShockMs < Math.max(0, durationMs)) {
    return { ok: false, reason: 'time' };
  }
  return { ok: true, remainingShocks, remainingShockMs };
}

export function budgetExhaustedAfter(
  settings: Pick<WearerSafetySettings, 'budgetEnabled' | 'budgetMaxShocks' | 'budgetMaxShockMs'>,
  state: Pick<BudgetState, 'usedShocks' | 'usedShockMs'>,
): boolean {
  if (!settings.budgetEnabled) return false;
  if (settings.budgetMaxShocks != null && state.usedShocks >= settings.budgetMaxShocks) return true;
  if (settings.budgetMaxShockMs != null && state.usedShockMs >= settings.budgetMaxShockMs) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Gate check

export type GateContext = {
  ownerDiscordUserId: string;
  executorDiscordUserId: string;
  operation: string;
  durationMs: number;
  batchId: string | null;
  /** When the wearer's queue is on it spaces commands itself (max(cooldown, progress)). */
  queueEnabled: boolean;
  /** Gates this caller may skip (admin bypass, Phase 2). */
  bypass?: ReadonlySet<SafetyGate>;
};

export type GateDeps = {
  settings: WearerSafetySettings;
  isFavorite: () => Promise<boolean>;
  /** Current budget usage with any period refill already applied. */
  getBudget: () => Promise<BudgetState>;
  cooldowns: CooldownTracker;
};

export type GateResult = {
  /** Gates that would have refused but were skipped. */
  bypassed: SafetyGate[];
  /** Whether the wearer must still accept this command. */
  needsApproval: boolean;
};

/**
 * Favorites-only → cooldown → budget. Throws WearerGateError on refusal.
 * Approval is interactive and handled by the caller when `needsApproval`.
 * Does not record anything; call `cooldowns.record` once the command is admitted.
 */
export async function checkWearerGates(deps: GateDeps, ctx: GateContext): Promise<GateResult> {
  const { settings } = deps;
  const bypassed: SafetyGate[] = [];
  const skip = (gate: SafetyGate) => ctx.bypass?.has(gate) ?? false;

  if (settings.favoritesOnly && !(await deps.isFavorite())) {
    if (!skip('favorites')) {
      throw new WearerGateError(
        'This person only accepts commands from their favorites',
        403,
        'FAVORITES_ONLY',
      );
    }
    bypassed.push('favorites');
  }

  if (!ctx.queueEnabled) {
    const retryAfterMs = deps.cooldowns.retryAfter(
      ctx.ownerDiscordUserId,
      ctx.executorDiscordUserId,
      settings.cooldownPerSenderMs,
      settings.cooldownGlobalMs,
      ctx.batchId,
    );
    if (retryAfterMs > 0) {
      if (!skip('cooldown')) {
        throw new WearerGateError(
          `Cooldown — try again in ${Math.ceil(retryAfterMs / 1000)}s`,
          429,
          'COOLDOWN',
          retryAfterMs,
        );
      }
      bypassed.push('cooldown');
    }
  }

  if (settings.budgetEnabled && isShockOperation(ctx.operation)) {
    const budget = checkBudget(settings, await deps.getBudget(), ctx.durationMs);
    if (!budget.ok) {
      if (!skip('budget')) {
        throw new WearerGateError(
          budget.reason === 'time'
            ? 'Their shock-time budget is used up'
            : 'Their shock budget is used up',
          429,
          'BUDGET_EXHAUSTED',
        );
      }
      bypassed.push('budget');
    }
  }

  let needsApproval = settings.approveEachCommand;
  if (needsApproval && skip('approval')) {
    needsApproval = false;
    bypassed.push('approval');
  }
  return { bypassed, needsApproval };
}

// ---------------------------------------------------------------------------
// Effective limit bands (share ∩ personal ∩ per-person ∩ device)

export type EffectiveModes = ModeLimitBands & {
  requiredWarningLevel: WarningLevel;
  /** Mode permissions after the per-person row (share flags are checked separately). */
  personAllows: { shock: boolean; vibrate: boolean; beep: boolean };
};

/**
 * Nest a per-person max under an existing band. When the person cap would fall below
 * the band minimum the mode is unusable for that person (instead of a 400 conflict).
 */
function nestPersonMax(
  band: IntensityDurationBand,
  person: { maxIntensity?: number; maxDurationMs?: number } | undefined,
): IntensityDurationBand | null {
  if (!person) return band;
  const maxIntensity = Math.min(band.maxIntensity, person.maxIntensity ?? band.maxIntensity);
  const maxDurationMs = Math.min(band.maxDurationMs, person.maxDurationMs ?? band.maxDurationMs);
  if (maxIntensity < band.minIntensity || maxDurationMs < band.minDurationMs) return null;
  return { ...band, maxIntensity, maxDurationMs };
}

export function buildEffectiveModes(
  share: ModeLimitBands & { requiredWarningLevel: WarningLevel },
  personal: ModeLimitBands & { requiredWarningLevel: WarningLevel },
  device: { maxIntensity: number; maxDurationMs: number },
  requiredWarningLevel: WarningLevel,
  person?: PersonLimitColumns | null,
): EffectiveModes {
  const base = {
    shock: nestBands([share.shock, personal.shock], device.maxIntensity, device.maxDurationMs),
    vibrate: nestBands([share.vibrate, personal.vibrate], device.maxIntensity, device.maxDurationMs),
    beep: nestBands([share.beep, personal.beep], device.maxIntensity, device.maxDurationMs),
  };
  const p = personLimitBands(person ?? null);
  const shock = nestPersonMax(base.shock, p?.shock);
  const vibrate = nestPersonMax(base.vibrate, p?.vibrate);
  const beep = nestPersonMax(base.beep, p?.beep);
  return {
    shock: shock ?? base.shock,
    vibrate: vibrate ?? base.vibrate,
    beep: beep ?? base.beep,
    requiredWarningLevel,
    personAllows: {
      shock: Boolean(shock) && (p?.canShock ?? true),
      vibrate: Boolean(vibrate) && (p?.canVibrate ?? true),
      beep: Boolean(beep) && (p?.canBeep ?? true),
    },
  };
}

/** Throws when the per-person row forbids this operation. */
export function assertPersonAllows(modes: EffectiveModes, operation: string): void {
  const mode =
    operation === 'vibrate' || operation === 'warning'
      ? 'vibrate'
      : operation === 'beep'
        ? 'beep'
        : 'shock';
  if (!modes.personAllows[mode]) {
    throw new WearerGateError(
      `This person doesn't allow you to ${mode === 'shock' ? 'shock' : mode}`,
      403,
      'PERSON_LIMIT',
    );
  }
}

/**
 * Admin limit override (wearer consented): only the PiShock device max applies.
 * Mode permissions and the required warning are kept by the caller.
 */
export function deviceOnlyModes(
  device: { maxIntensity: number; maxDurationMs: number },
  requiredWarningLevel: WarningLevel,
): EffectiveModes {
  const band = nestBands([], device.maxIntensity, device.maxDurationMs);
  return {
    shock: band,
    vibrate: band,
    beep: band,
    requiredWarningLevel,
    personAllows: { shock: true, vibrate: true, beep: true },
  };
}
