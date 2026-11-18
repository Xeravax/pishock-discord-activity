// Log sharing preferences and the "extra features" (wearer safety, budget, per-person
// limits, admin limit-override consent).
import { prisma } from '../db.js';
import {
  LOG_PRIVACY_SELECT,
  logPrivacyFromColumns,
  logPrivacyPatchToColumns,
  type LogPrivacy,
} from '../log-privacy.js';
import {
  WEARER_SAFETY_SELECT,
  personLimitPatchToColumns,
  wearerSafetyFromColumns,
  wearerSafetyPatchToColumns,
  type PersonLimit,
  type WearerSafetySettings,
} from '../wearer-safety-settings.js';
import { dayBudgetExpired, type BudgetState } from '../wearer-safety.js';

export async function getLogPrivacy(discordUserId: string): Promise<LogPrivacy> {
  const user = await prisma.discordUser.findUnique({
    where: { id: discordUserId },
    select: LOG_PRIVACY_SELECT,
  });
  return logPrivacyFromColumns(user);
}

export async function setLogPrivacy(discordUserId: string, patch: unknown): Promise<LogPrivacy> {
  const data = logPrivacyPatchToColumns(patch);
  if (Object.keys(data).length === 0) return getLogPrivacy(discordUserId);
  const user = await prisma.discordUser.update({
    where: { id: discordUserId },
    data,
    select: LOG_PRIVACY_SELECT,
  });
  return logPrivacyFromColumns(user);
}


// ---------------------------------------------------------------------------
// Extra features: wearer safety settings, budget, per-person limits

export async function getWearerSafety(discordUserId: string): Promise<WearerSafetySettings> {
  const user = await prisma.discordUser.findUnique({
    where: { id: discordUserId },
    select: WEARER_SAFETY_SELECT,
  });
  return wearerSafetyFromColumns(user);
}

export async function setWearerSafety(
  discordUserId: string,
  patch: unknown,
): Promise<WearerSafetySettings> {
  const data = wearerSafetyPatchToColumns(patch);
  if (Object.keys(data).length === 0) return getWearerSafety(discordUserId);
  const user = await prisma.discordUser.update({
    where: { id: discordUserId },
    data,
    select: WEARER_SAFETY_SELECT,
  });
  return wearerSafetyFromColumns(user);
}

const BUDGET_STATE_SELECT = {
  budgetUsedShocks: true,
  budgetUsedShockMs: true,
  budgetPeriodStartedAt: true,
} as const;

function mapBudgetState(row: {
  budgetUsedShocks: number;
  budgetUsedShockMs: number;
  budgetPeriodStartedAt: Date | null;
} | null): BudgetState {
  return {
    usedShocks: row?.budgetUsedShocks ?? 0,
    usedShockMs: row?.budgetUsedShockMs ?? 0,
    periodStartedAt: row?.budgetPeriodStartedAt ?? null,
  };
}

/** Budget usage, refilling a "day" budget that belongs to an earlier day. */
export async function getBudgetState(
  discordUserId: string,
  settings?: WearerSafetySettings,
): Promise<BudgetState> {
  const s = settings ?? (await getWearerSafety(discordUserId));
  const row = await prisma.discordUser.findUnique({
    where: { id: discordUserId },
    select: BUDGET_STATE_SELECT,
  });
  const state = mapBudgetState(row);
  if (dayBudgetExpired(s, state, new Date())) return resetBudget(discordUserId);
  return state;
}

export async function resetBudget(discordUserId: string): Promise<BudgetState> {
  const row = await prisma.discordUser.update({
    where: { id: discordUserId },
    data: { budgetUsedShocks: 0, budgetUsedShockMs: 0, budgetPeriodStartedAt: new Date() },
    select: BUDGET_STATE_SELECT,
  });
  return mapBudgetState(row);
}

/** Atomically count one delivered shock. */
export async function addBudgetUsage(discordUserId: string, shockMs: number): Promise<BudgetState> {
  const current = await prisma.discordUser.findUnique({
    where: { id: discordUserId },
    select: { budgetPeriodStartedAt: true },
  });
  const row = await prisma.discordUser.update({
    where: { id: discordUserId },
    data: {
      budgetUsedShocks: { increment: 1 },
      budgetUsedShockMs: { increment: Math.max(0, Math.floor(shockMs)) },
      ...(current?.budgetPeriodStartedAt ? {} : { budgetPeriodStartedAt: new Date() }),
    },
    select: BUDGET_STATE_SELECT,
  });
  return mapBudgetState(row);
}

export async function getLastSeenAt(discordUserId: string): Promise<Date | null> {
  const row = await prisma.discordUser.findUnique({
    where: { id: discordUserId },
    select: { lastSeenAt: true },
  });
  return row?.lastSeenAt ?? null;
}

export async function touchLastSeen(discordUserId: string, at = new Date()): Promise<void> {
  await prisma.discordUser
    .update({ where: { id: discordUserId }, data: { lastSeenAt: at } })
    .catch(() => undefined);
}

const PERSON_LIMIT_SELECT = {
  controllerDiscordUserId: true,
  shockMaxIntensity: true,
  shockMaxDurationMs: true,
  vibMaxIntensity: true,
  vibMaxDurationMs: true,
  beepMaxIntensity: true,
  beepMaxDurationMs: true,
  canShock: true,
  canVibrate: true,
  canBeep: true,
} as const;

export async function listPersonLimits(ownerDiscordUserId: string): Promise<PersonLimit[]> {
  return prisma.activityPersonLimit.findMany({
    where: { ownerDiscordUserId },
    select: PERSON_LIMIT_SELECT,
  });
}

/** Per-person row for this controller — null when the wearer has the feature off. */
export async function getEffectivePersonLimit(
  ownerDiscordUserId: string,
  controllerDiscordUserId: string,
  settings?: Pick<WearerSafetySettings, 'perPersonLimitsEnabled'>,
): Promise<PersonLimit | null> {
  const enabled = settings ?? (await getWearerSafety(ownerDiscordUserId));
  if (!enabled.perPersonLimitsEnabled) return null;
  return prisma.activityPersonLimit.findUnique({
    where: {
      ownerDiscordUserId_controllerDiscordUserId: { ownerDiscordUserId, controllerDiscordUserId },
    },
    select: PERSON_LIMIT_SELECT,
  });
}

export async function setPersonLimit(
  ownerDiscordUserId: string,
  controllerDiscordUserId: string,
  patch: unknown,
): Promise<PersonLimit> {
  const data = personLimitPatchToColumns(patch);
  await prisma.discordUser.upsert({
    where: { id: controllerDiscordUserId },
    create: { id: controllerDiscordUserId },
    update: {},
  });
  return prisma.activityPersonLimit.upsert({
    where: {
      ownerDiscordUserId_controllerDiscordUserId: { ownerDiscordUserId, controllerDiscordUserId },
    },
    create: { ownerDiscordUserId, controllerDiscordUserId, ...data },
    update: data,
    select: PERSON_LIMIT_SELECT,
  });
}

export async function deletePersonLimit(
  ownerDiscordUserId: string,
  controllerDiscordUserId: string,
): Promise<void> {
  await prisma.activityPersonLimit.deleteMany({
    where: { ownerDiscordUserId, controllerDiscordUserId },
  });
}

/** Pause every enabled, unpaused share. Returns the shocker ids that were paused. */
export async function pauseAllActiveShares(discordUserId: string): Promise<number[]> {
  const rows = await prisma.activityShare.findMany({
    where: { discordUserId, enabled: true, paused: false },
    select: { shockerId: true },
  });
  const ids = rows.map((r) => r.shockerId);
  if (ids.length) {
    await prisma.activityShare.updateMany({
      where: { discordUserId, shockerId: { in: ids } },
      data: { paused: true },
    });
  }
  return ids;
}

export async function resumeShares(discordUserId: string, shockerIds: number[]): Promise<number> {
  const ids = shockerIds.filter((id) => Number.isFinite(id) && id > 0).map(Math.floor);
  if (!ids.length) return 0;
  const res = await prisma.activityShare.updateMany({
    where: { discordUserId, shockerId: { in: ids }, enabled: true, paused: true },
    data: { paused: false },
  });
  return res.count;
}

export async function hasActiveShares(discordUserId: string): Promise<boolean> {
  const n = await prisma.activityShare.count({
    where: { discordUserId, enabled: true, paused: false },
  });
  return n > 0;
}

// ---------------------------------------------------------------------------
// Admin limit-override consent

const ADMIN_CONSENT_SELECT = {
  adminLimitOverrideConsentAt: true,
  adminLimitOverrideConsentVersion: true,
} as const;

export async function getAdminLimitConsent(discordUserId: string): Promise<{
  adminLimitOverrideConsentAt: Date | null;
  adminLimitOverrideConsentVersion: number | null;
} | null> {
  return prisma.discordUser.findUnique({ where: { id: discordUserId }, select: ADMIN_CONSENT_SELECT });
}

export async function setAdminLimitConsent(discordUserId: string, version: number | null): Promise<void> {
  await prisma.discordUser.update({
    where: { id: discordUserId },
    data: {
      adminLimitOverrideConsentAt: version == null ? null : new Date(),
      adminLimitOverrideConsentVersion: version,
    },
  });
}
