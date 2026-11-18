import { apiFetch } from './api';

/** Mirrors src/server/wearer-safety-settings.ts (extra features). */
export type BudgetPeriod = 'session' | 'day' | 'manual';

export type WearerSafety = {
  approveEachCommand: boolean;
  approvalTimeoutMs: number;
  cooldownPerSenderMs: number;
  cooldownGlobalMs: number;
  favoritesOnly: boolean;
  budgetEnabled: boolean;
  budgetPeriod: BudgetPeriod;
  budgetMaxShocks: number | null;
  budgetMaxShockMs: number | null;
  budgetTimezone: string | null;
  checkInEnabled: boolean;
  checkInIntervalMs: number;
  checkInGraceMs: number;
  perPersonLimitsEnabled: boolean;
};

export const DEFAULT_WEARER_SAFETY: WearerSafety = {
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
};

export type BudgetState = {
  usedShocks: number;
  usedShockMs: number;
  periodStartedAt: string | null;
};

export type ApprovalRequest = {
  approvalId: string;
  ownerDiscordUserId: string;
  executorDiscordUserId: string;
  executorUsername: string | null;
  executorGlobalName: string | null;
  executorAvatar: string | null;
  operation: string;
  items: Array<{ shockerId: number; shockerName: string | null; intensity: number; durationMs: number }>;
  expiresAt: number;
  at: number;
};

export type AdminConsentState = {
  granted: boolean;
  grantedAt: string | null;
  version: number;
  phrase: string;
};

export type SafetySnapshot = {
  settings: WearerSafety;
  budget: BudgetState;
  pendingApprovals: ApprovalRequest[];
  checkInDeadline: number | null;
  adminConsent: AdminConsentState;
};

const NO_ADMIN_CONSENT: AdminConsentState = {
  granted: false,
  grantedAt: null,
  version: 1,
  phrase: 'I CONSENT',
};

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

/** What a sender sees about a wearer's gates (participant status). */
export type ParticipantSafety = {
  favoritesOnly: boolean;
  approveEachCommand: boolean;
  cooldownPerSenderMs: number;
  cooldownGlobalMs: number;
  cooldownRemainingMs: number;
  budget: { exhausted: boolean; remainingShocks: number | null; remainingShockMs: number | null } | null;
  personLimited: boolean;
};

export function normalizeWearerSafety(raw: Partial<WearerSafety> | null | undefined): WearerSafety {
  const out = { ...DEFAULT_WEARER_SAFETY };
  if (!raw) return out;
  for (const key of Object.keys(DEFAULT_WEARER_SAFETY) as Array<keyof WearerSafety>) {
    const v = raw[key];
    if (v !== undefined) (out as Record<string, unknown>)[key] = v;
  }
  if (!['session', 'day', 'manual'].includes(out.budgetPeriod)) out.budgetPeriod = 'session';
  return out;
}

export function localTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function snapshotFrom(res: Partial<SafetySnapshot>): SafetySnapshot {
  return {
    settings: normalizeWearerSafety(res.settings),
    budget: res.budget ?? { usedShocks: 0, usedShockMs: 0, periodStartedAt: null },
    pendingApprovals: res.pendingApprovals ?? [],
    checkInDeadline: res.checkInDeadline ?? null,
    adminConsent: res.adminConsent ?? NO_ADMIN_CONSENT,
  };
}

export async function loadSafety(token: string): Promise<SafetySnapshot> {
  return snapshotFrom(await apiFetch<Partial<SafetySnapshot>>('/safety/settings', token));
}

export async function saveSafety(token: string, patch: Partial<WearerSafety>): Promise<SafetySnapshot> {
  const body = { ...patch };
  if (body.budgetPeriod === 'day' || body.budgetEnabled) body.budgetTimezone = localTimezone();
  return snapshotFrom(
    await apiFetch<Partial<SafetySnapshot>>('/safety/settings', token, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  );
}

export async function answerApproval(token: string, approvalId: string, accept: boolean): Promise<void> {
  await apiFetch(`/safety/approvals/${encodeURIComponent(approvalId)}`, token, {
    method: 'POST',
    body: JSON.stringify({ accept }),
  });
}

export async function ackCheckIn(token: string): Promise<void> {
  await apiFetch('/safety/checkin', token, { method: 'POST', body: '{}' });
}

export async function resumeAfterCheckIn(token: string): Promise<number> {
  const res = await apiFetch<{ resumed: number }>('/safety/resume', token, { method: 'POST', body: '{}' });
  return res.resumed;
}

export async function resetBudget(token: string): Promise<BudgetState> {
  const res = await apiFetch<{ budget: BudgetState }>('/safety/budget/reset', token, {
    method: 'POST',
    body: '{}',
  });
  return res.budget;
}

export async function raiseBudget(
  token: string,
  add: { shocks?: number; shockMs?: number },
): Promise<SafetySnapshot> {
  return snapshotFrom(
    await apiFetch<Partial<SafetySnapshot>>('/safety/budget/raise', token, {
      method: 'POST',
      body: JSON.stringify(add),
    }),
  );
}

export async function loadPersonLimits(token: string): Promise<PersonLimit[]> {
  const res = await apiFetch<{ limits: PersonLimit[] }>('/safety/person-limits', token);
  return res.limits ?? [];
}

export async function savePersonLimit(
  token: string,
  discordUserId: string,
  patch: Partial<Omit<PersonLimit, 'controllerDiscordUserId'>>,
): Promise<PersonLimit> {
  const res = await apiFetch<{ limit: PersonLimit }>(
    `/safety/person-limits/${encodeURIComponent(discordUserId)}`,
    token,
    { method: 'PUT', body: JSON.stringify(patch) },
  );
  return res.limit;
}

export async function clearPersonLimit(token: string, discordUserId: string): Promise<void> {
  await apiFetch(`/safety/person-limits/${encodeURIComponent(discordUserId)}`, token, {
    method: 'DELETE',
  });
}

/** Friendly sender-side text for the new refusal codes. */
export function safetyErrorMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case 'FAVORITES_ONLY':
    case 'STAR_ONLY':
      return 'They only accept commands from their favorites.';
    case 'COOLDOWN':
      return fallback;
    case 'BUDGET_EXHAUSTED':
      return 'Their shock budget is used up for now.';
    case 'APPROVAL_DENIED':
      return 'They declined your command.';
    case 'APPROVAL_TIMEOUT':
      return 'They did not accept in time.';
    case 'APPROVAL_CANCELED':
      return 'Their approval request was canceled.';
    case 'PERSON_LIMIT':
      return fallback;
    default:
      return fallback;
  }
}

export function formatBudgetUsage(settings: WearerSafety, budget: BudgetState): string {
  const parts: string[] = [];
  if (settings.budgetMaxShocks != null) {
    parts.push(`${budget.usedShocks}/${settings.budgetMaxShocks} shocks`);
  }
  if (settings.budgetMaxShockMs != null) {
    parts.push(
      `${(budget.usedShockMs / 1000).toFixed(1)}s/${Math.round(settings.budgetMaxShockMs / 1000)}s`,
    );
  }
  return parts.length ? parts.join(' · ') : `${budget.usedShocks} shocks (no cap set)`;
}

export type AdminConsentStepResult =
  | { complete: false; nonce: string; nextStep: 2 | 3 }
  | { complete: true; adminConsent: AdminConsentState };

/** One of the three server-enforced consent steps. */
export async function adminConsentStep(
  token: string,
  step: 1 | 2 | 3,
  nonce?: string,
  phrase?: string,
): Promise<AdminConsentStepResult> {
  return apiFetch<AdminConsentStepResult>('/safety/admin-consent/step', token, {
    method: 'POST',
    body: JSON.stringify({ step, nonce, phrase }),
  });
}

export async function revokeAdminConsent(token: string): Promise<AdminConsentState> {
  const res = await apiFetch<{ adminConsent: AdminConsentState }>('/safety/admin-consent', token, {
    method: 'DELETE',
  });
  return res.adminConsent;
}
