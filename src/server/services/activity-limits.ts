import { prisma } from '../db.js';
import { personalBandsFromUser, shareBandsFromRow } from '../limit-bands.js';
import { normalizeWarningLevel } from '../../shared/warning.js';

export async function findActivityShareByCode(shareCode: string) {
  const code = shareCode.trim();
  if (!code) return null;
  return prisma.activityShare.findFirst({
    where: { shareCode: code },
  });
}

export async function findActivityShareByShocker(discordUserId: string, shockerId: number) {
  return prisma.activityShare.findUnique({
    where: {
      discordUserId_shockerId: { discordUserId, shockerId },
    },
  });
}

export async function listActivityShares(discordUserId: string) {
  return prisma.activityShare.findMany({
    where: { discordUserId },
    orderBy: { updatedAt: 'desc' },
  });
}

export async function listEnabledActivityShares(discordUserId: string) {
  return prisma.activityShare.findMany({
    where: { discordUserId, enabled: true },
    orderBy: { updatedAt: 'desc' },
  });
}

export type ActivityShareWrite = {
  shockerId: number;
  shockerName: string;
  hubClientId?: string | null;
  hubName?: string | null;
  shareCode?: string | null;
  deviceMaxIntensity?: number;
  deviceMaxDurationMs?: number;
  enabled?: boolean;
  paused?: boolean;
  minIntensity?: number;
  maxIntensity?: number;
  minDurationMs?: number;
  maxDurationMs?: number;
  vibMinIntensity?: number;
  vibMaxIntensity?: number;
  vibMinDurationMs?: number;
  vibMaxDurationMs?: number;
  beepMinIntensity?: number;
  beepMaxIntensity?: number;
  beepMinDurationMs?: number;
  beepMaxDurationMs?: number;
  canShock?: boolean;
  canVibrate?: boolean;
  canBeep?: boolean;
  canHold?: boolean;
  requiredWarningLevel?: string | null;
  maxIntensityStep?: number | null;
};

function activityShareCreateData(discordUserId: string, shares: ActivityShareWrite[]) {
  return shares.map((s) => {
    const deviceMaxIntensity = Math.max(1, Math.min(100, s.deviceMaxIntensity ?? 100));
    const deviceMaxDurationMs = Math.max(16, Math.min(15_000, s.deviceMaxDurationMs ?? 15_000));
    const bands = shareBandsFromRow({
      deviceMaxIntensity,
      deviceMaxDurationMs,
      minIntensity: s.minIntensity,
      maxIntensity: s.maxIntensity,
      minDurationMs: s.minDurationMs,
      maxDurationMs: s.maxDurationMs,
      vibMinIntensity: s.vibMinIntensity,
      vibMaxIntensity: s.vibMaxIntensity,
      vibMinDurationMs: s.vibMinDurationMs,
      vibMaxDurationMs: s.vibMaxDurationMs,
      beepMinIntensity: s.beepMinIntensity,
      beepMaxIntensity: s.beepMaxIntensity,
      beepMinDurationMs: s.beepMinDurationMs,
      beepMaxDurationMs: s.beepMaxDurationMs,
      requiredWarningLevel: s.requiredWarningLevel,
    });
    return {
      discordUserId,
      shockerId: s.shockerId,
      shockerName: s.shockerName,
      hubClientId: s.hubClientId ?? null,
      hubName: s.hubName ? String(s.hubName).trim().slice(0, 120) || null : null,
      shareCode: s.shareCode ? String(s.shareCode) : null,
      deviceMaxIntensity,
      deviceMaxDurationMs,
      enabled: s.enabled !== false,
      paused: Boolean(s.paused),
      minIntensity: bands.shock.minIntensity,
      maxIntensity: bands.shock.maxIntensity,
      minDurationMs: bands.shock.minDurationMs,
      maxDurationMs: bands.shock.maxDurationMs,
      vibMinIntensity: bands.vibrate.minIntensity,
      vibMaxIntensity: bands.vibrate.maxIntensity,
      vibMinDurationMs: bands.vibrate.minDurationMs,
      vibMaxDurationMs: bands.vibrate.maxDurationMs,
      beepMinIntensity: bands.beep.minIntensity,
      beepMaxIntensity: bands.beep.maxIntensity,
      beepMinDurationMs: bands.beep.minDurationMs,
      beepMaxDurationMs: bands.beep.maxDurationMs,
      canShock: s.canShock !== false,
      canVibrate: s.canVibrate !== false,
      canBeep: s.canBeep !== false,
      canHold: s.canHold !== false,
      requiredWarningLevel: bands.requiredWarningLevel,
      maxIntensityStep: s.maxIntensityStep ?? null,
    };
  });
}

async function writeActivityShares(
  tx: Pick<typeof prisma, 'activityShare'>,
  discordUserId: string,
  shares: ActivityShareWrite[],
) {
  await tx.activityShare.deleteMany({ where: { discordUserId } });
  if (shares.length === 0) return;
  await tx.activityShare.createMany({ data: activityShareCreateData(discordUserId, shares) });
}

export async function replaceActivityShares(discordUserId: string, shares: ActivityShareWrite[]) {
  await prisma.$transaction(async (tx) => {
    await writeActivityShares(tx, discordUserId, shares);
  });
  return listActivityShares(discordUserId);
}

/** Personal limits and share rows commit together, or neither is saved. */
export async function commitPersonalLimitsAndShares(
  discordUserId: string,
  input: PersonalLimitInput,
  shares: ActivityShareWrite[],
) {
  await withPersonalLimitLock(discordUserId, () =>
    prisma.$transaction(async (tx) => {
      const stored = await tx.discordUser.findUnique({ where: { id: discordUserId } });
      const data = personalLimitData(stored, input);
      await tx.discordUser.update({ where: { id: discordUserId }, data });
      await writeActivityShares(tx, discordUserId, shares);
    }),
  );
}

export async function getPersonalActivityLimits(discordUserId: string) {
  const user = await prisma.discordUser.findUnique({ where: { id: discordUserId } });
  const bands = personalBandsFromUser(user);
  return {
    activityMinIntensity: bands.shock.minIntensity,
    activityMaxIntensity: bands.shock.maxIntensity,
    activityMinDurationMs: bands.shock.minDurationMs,
    activityMaxDurationMs: bands.shock.maxDurationMs,
    activityVibMinIntensity: bands.vibrate.minIntensity,
    activityVibMaxIntensity: bands.vibrate.maxIntensity,
    activityVibMinDurationMs: bands.vibrate.minDurationMs,
    activityVibMaxDurationMs: bands.vibrate.maxDurationMs,
    activityBeepMinIntensity: bands.beep.minIntensity,
    activityBeepMaxIntensity: bands.beep.maxIntensity,
    activityBeepMinDurationMs: bands.beep.minDurationMs,
    activityBeepMaxDurationMs: bands.beep.maxDurationMs,
    activityRequiredWarningLevel: bands.requiredWarningLevel,
  };
}

type PersonalLimitInput = {
  activityMinIntensity?: number;
  activityMaxIntensity?: number;
  activityMinDurationMs?: number;
  activityMaxDurationMs?: number;
  activityVibMinIntensity?: number;
  activityVibMaxIntensity?: number;
  activityVibMinDurationMs?: number;
  activityVibMaxDurationMs?: number;
  activityBeepMinIntensity?: number;
  activityBeepMaxIntensity?: number;
  activityBeepMinDurationMs?: number;
  activityBeepMaxDurationMs?: number;
  activityRequiredWarningLevel?: string | null;
};

type StoredPersonalLimits = {
  activityMinIntensity?: number | null;
  activityMaxIntensity?: number | null;
  activityMinDurationMs?: number | null;
  activityMaxDurationMs?: number | null;
  activityVibMinIntensity?: number | null;
  activityVibMaxIntensity?: number | null;
  activityVibMinDurationMs?: number | null;
  activityVibMaxDurationMs?: number | null;
  activityBeepMinIntensity?: number | null;
  activityBeepMaxIntensity?: number | null;
  activityBeepMinDurationMs?: number | null;
  activityBeepMaxDurationMs?: number | null;
  activityRequiredWarningLevel?: string | null;
} | null;

function definedNumber(value: number | null | undefined): number | undefined {
  return value ?? undefined;
}

/** One in-flight read-modify-write per Discord user so partial updates cannot clobber each other. */
const personalLimitLocks = new Map<string, Promise<void>>();

function withPersonalLimitLock<T>(discordUserId: string, fn: () => Promise<T>): Promise<T> {
  const previous = personalLimitLocks.get(discordUserId) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  personalLimitLocks.set(discordUserId, tail);
  void tail.finally(() => {
    if (personalLimitLocks.get(discordUserId) === tail) personalLimitLocks.delete(discordUserId);
  });
  return run;
}

function personalLimitData(stored: StoredPersonalLimits, input: PersonalLimitInput) {
  const bands = personalBandsFromUser({
    activityMinIntensity: definedNumber(input.activityMinIntensity ?? stored?.activityMinIntensity),
    activityMaxIntensity: definedNumber(input.activityMaxIntensity ?? stored?.activityMaxIntensity),
    activityMinDurationMs: definedNumber(
      input.activityMinDurationMs ?? stored?.activityMinDurationMs,
    ),
    activityMaxDurationMs: definedNumber(
      input.activityMaxDurationMs ?? stored?.activityMaxDurationMs,
    ),
    activityVibMinIntensity: definedNumber(
      input.activityVibMinIntensity ?? stored?.activityVibMinIntensity,
    ),
    activityVibMaxIntensity: definedNumber(
      input.activityVibMaxIntensity ?? stored?.activityVibMaxIntensity,
    ),
    activityVibMinDurationMs: definedNumber(
      input.activityVibMinDurationMs ?? stored?.activityVibMinDurationMs,
    ),
    activityVibMaxDurationMs: definedNumber(
      input.activityVibMaxDurationMs ?? stored?.activityVibMaxDurationMs,
    ),
    activityBeepMinIntensity: definedNumber(
      input.activityBeepMinIntensity ?? stored?.activityBeepMinIntensity,
    ),
    activityBeepMaxIntensity: definedNumber(
      input.activityBeepMaxIntensity ?? stored?.activityBeepMaxIntensity,
    ),
    activityBeepMinDurationMs: definedNumber(
      input.activityBeepMinDurationMs ?? stored?.activityBeepMinDurationMs,
    ),
    activityBeepMaxDurationMs: definedNumber(
      input.activityBeepMaxDurationMs ?? stored?.activityBeepMaxDurationMs,
    ),
    activityRequiredWarningLevel:
      input.activityRequiredWarningLevel !== undefined
        ? input.activityRequiredWarningLevel
        : stored?.activityRequiredWarningLevel,
  });
  return {
    activityMinIntensity: bands.shock.minIntensity,
    activityMaxIntensity: bands.shock.maxIntensity,
    activityMinDurationMs: bands.shock.minDurationMs,
    activityMaxDurationMs: bands.shock.maxDurationMs,
    activityVibMinIntensity: bands.vibrate.minIntensity,
    activityVibMaxIntensity: bands.vibrate.maxIntensity,
    activityVibMinDurationMs: bands.vibrate.minDurationMs,
    activityVibMaxDurationMs: bands.vibrate.maxDurationMs,
    activityBeepMinIntensity: bands.beep.minIntensity,
    activityBeepMaxIntensity: bands.beep.maxIntensity,
    activityBeepMinDurationMs: bands.beep.minDurationMs,
    activityBeepMaxDurationMs: bands.beep.maxDurationMs,
    activityRequiredWarningLevel: normalizeWarningLevel(
      input.activityRequiredWarningLevel ?? bands.requiredWarningLevel,
    ),
  };
}

export async function setPersonalActivityLimits(discordUserId: string, input: PersonalLimitInput) {
  return withPersonalLimitLock(discordUserId, async () => {
    const stored = await prisma.discordUser.findUnique({ where: { id: discordUserId } });
    return prisma.discordUser.update({
      where: { id: discordUserId },
      data: personalLimitData(stored, input),
    });
  });
}
