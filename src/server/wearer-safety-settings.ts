/**
 * Per-wearer "extra features" safety settings (approve-each, cooldowns, favorites-only,
 * shock budget, check-ins, per-person limits). Pure mapping + validation — no DB access,
 * so it can be unit-tested. Mirrors the log-privacy module.
 */

export const BUDGET_PERIODS = ['session', 'day', 'manual'] as const;
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];

export const APPROVAL_TIMEOUT_MIN_MS = 5_000;
export const APPROVAL_TIMEOUT_MAX_MS = 60_000;
export const COOLDOWN_MAX_MS = 10 * 60_000;
export const BUDGET_MAX_SHOCKS = 10_000;
export const BUDGET_MAX_SHOCK_MS = 24 * 60 * 60_000;
export const CHECKIN_INTERVAL_MIN_MS = 60_000;
export const CHECKIN_INTERVAL_MAX_MS = 4 * 60 * 60_000;
export const CHECKIN_GRACE_MIN_MS = 15_000;
export const CHECKIN_GRACE_MAX_MS = 5 * 60_000;

export type WearerSafetySettings = {
  approveEachCommand: boolean;
  approvalTimeoutMs: number;
  cooldownPerSenderMs: number;
  cooldownGlobalMs: number;
  favoritesOnly: boolean;
  budgetEnabled: boolean;
  budgetPeriod: BudgetPeriod;
  /** null = no cap on count. */
  budgetMaxShocks: number | null;
  /** null = no cap on total shock time. */
  budgetMaxShockMs: number | null;
  budgetTimezone: string | null;
  checkInEnabled: boolean;
  checkInIntervalMs: number;
  checkInGraceMs: number;
  perPersonLimitsEnabled: boolean;
  /** Others may spin the roulette wheel on you (results still pass every gate). */
  rouletteAllowed: boolean;
  /** DM a recap after each session (always stored in history too). */
  recapDmEnabled: boolean;
};

export const DEFAULT_WEARER_SAFETY: WearerSafetySettings = {
  approveEachCommand: false,
  approvalTimeoutMs: 20_000,
  cooldownPerSenderMs: 0,
  cooldownGlobalMs: 0,
  favoritesOnly: false,
  budgetEnabled: false,
  budgetPeriod: 'session',
  budgetMaxShocks: null,
  budgetMaxShockMs: null,
  budgetTimezone: null,
  checkInEnabled: false,
  checkInIntervalMs: 15 * 60_000,
  checkInGraceMs: 60_000,
  perPersonLimitsEnabled: false,
  rouletteAllowed: false,
  recapDmEnabled: false,
};

/** Settings fields are stored under the same column names on DiscordUser. */
export const WEARER_SAFETY_SELECT = {
  approveEachCommand: true,
  approvalTimeoutMs: true,
  cooldownPerSenderMs: true,
  cooldownGlobalMs: true,
  favoritesOnly: true,
  budgetEnabled: true,
  budgetPeriod: true,
  budgetMaxShocks: true,
  budgetMaxShockMs: true,
  budgetTimezone: true,
  checkInEnabled: true,
  checkInIntervalMs: true,
  checkInGraceMs: true,
  perPersonLimitsEnabled: true,
  rouletteAllowed: true,
  recapDmEnabled: true,
} as const satisfies Record<keyof WearerSafetySettings, true>;

export type WearerSafetyColumns = {
  [K in keyof WearerSafetySettings]: K extends 'budgetPeriod' ? string : WearerSafetySettings[K];
};

function clampInt(raw: unknown, min: number, max: number): number | undefined {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return undefined;
  return Math.max(min, Math.min(max, n));
}

export function normalizeBudgetPeriod(raw: unknown): BudgetPeriod {
  return BUDGET_PERIODS.includes(raw as BudgetPeriod) ? (raw as BudgetPeriod) : 'session';
}

/** Accept only IANA zone names the runtime understands. */
export function normalizeTimezone(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 64) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: raw.trim() });
    return raw.trim();
  } catch {
    return null;
  }
}

export function wearerSafetyFromColumns(
  row: Partial<WearerSafetyColumns> | null | undefined,
): WearerSafetySettings {
  const out = { ...DEFAULT_WEARER_SAFETY };
  if (!row) return out;
  for (const key of Object.keys(WEARER_SAFETY_SELECT) as Array<keyof WearerSafetySettings>) {
    const v = row[key];
    if (v === undefined) continue;
    (out as Record<string, unknown>)[key] = v;
  }
  out.budgetPeriod = normalizeBudgetPeriod(row.budgetPeriod);
  return out;
}

/** Validate a partial client patch into column updates. Unknown / bad fields are ignored. */
export function wearerSafetyPatchToColumns(patch: unknown): Partial<WearerSafetyColumns> {
  const data: Partial<WearerSafetyColumns> = {};
  if (!patch || typeof patch !== 'object') return data;
  const p = patch as Record<string, unknown>;

  for (const key of [
    'approveEachCommand',
    'favoritesOnly',
    'budgetEnabled',
    'checkInEnabled',
    'perPersonLimitsEnabled',
    'rouletteAllowed',
    'recapDmEnabled',
  ] as const) {
    if (typeof p[key] === 'boolean') data[key] = p[key] as boolean;
  }

  const ranges: Array<[keyof WearerSafetySettings, number, number]> = [
    ['approvalTimeoutMs', APPROVAL_TIMEOUT_MIN_MS, APPROVAL_TIMEOUT_MAX_MS],
    ['cooldownPerSenderMs', 0, COOLDOWN_MAX_MS],
    ['cooldownGlobalMs', 0, COOLDOWN_MAX_MS],
    ['checkInIntervalMs', CHECKIN_INTERVAL_MIN_MS, CHECKIN_INTERVAL_MAX_MS],
    ['checkInGraceMs', CHECKIN_GRACE_MIN_MS, CHECKIN_GRACE_MAX_MS],
  ];
  for (const [key, min, max] of ranges) {
    if (p[key] === undefined) continue;
    const v = clampInt(p[key], min, max);
    if (v !== undefined) (data as Record<string, unknown>)[key] = v;
  }

  // Nullable caps: null / 0 clears the cap.
  for (const [key, max] of [
    ['budgetMaxShocks', BUDGET_MAX_SHOCKS],
    ['budgetMaxShockMs', BUDGET_MAX_SHOCK_MS],
  ] as const) {
    if (!(key in p)) continue;
    if (p[key] === null) {
      data[key] = null;
      continue;
    }
    const v = clampInt(p[key], 0, max);
    if (v !== undefined) data[key] = v === 0 ? null : v;
  }

  if (BUDGET_PERIODS.includes(p.budgetPeriod as BudgetPeriod)) {
    data.budgetPeriod = p.budgetPeriod as BudgetPeriod;
  }
  if ('budgetTimezone' in p) {
    data.budgetTimezone = p.budgetTimezone === null ? null : normalizeTimezone(p.budgetTimezone);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Per-person limits

export type PersonLimit = {
  controllerDiscordUserId: string;
  shockMaxIntensity: number | null;
  shockMaxDurationMs: number | null;
  vibMaxIntensity: number | null;
  vibMaxDurationMs: number | null;
  beepMaxIntensity: number | null;
  beepMaxDurationMs: number | null;
  canShock: boolean;
  canVibrate: boolean;
  canBeep: boolean;
};

export type PersonLimitColumns = Omit<PersonLimit, 'controllerDiscordUserId'>;

export function personLimitPatchToColumns(patch: unknown): Partial<PersonLimitColumns> {
  const data: Partial<PersonLimitColumns> = {};
  if (!patch || typeof patch !== 'object') return data;
  const p = patch as Record<string, unknown>;
  for (const key of ['canShock', 'canVibrate', 'canBeep'] as const) {
    if (typeof p[key] === 'boolean') data[key] = p[key] as boolean;
  }
  for (const [key, min, max] of [
    ['shockMaxIntensity', 1, 100],
    ['vibMaxIntensity', 1, 100],
    ['beepMaxIntensity', 1, 100],
    ['shockMaxDurationMs', 16, 15_000],
    ['vibMaxDurationMs', 16, 15_000],
    ['beepMaxDurationMs', 16, 15_000],
  ] as const) {
    if (!(key in p)) continue;
    if (p[key] === null) {
      data[key] = null;
      continue;
    }
    const v = clampInt(p[key], min, max);
    if (v !== undefined) data[key] = v;
  }
  return data;
}

/** Turn a per-person row into a band list entry (max-only) for nestBands. */
export function personLimitBands(row: PersonLimitColumns | null | undefined) {
  if (!row) return null;
  return {
    shock: { maxIntensity: row.shockMaxIntensity ?? undefined, maxDurationMs: row.shockMaxDurationMs ?? undefined },
    vibrate: { maxIntensity: row.vibMaxIntensity ?? undefined, maxDurationMs: row.vibMaxDurationMs ?? undefined },
    beep: { maxIntensity: row.beepMaxIntensity ?? undefined, maxDurationMs: row.beepMaxDurationMs ?? undefined },
    canShock: row.canShock,
    canVibrate: row.canVibrate,
    canBeep: row.canBeep,
  };
}
