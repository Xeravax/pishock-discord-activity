import { prisma } from './db.js';
import { decryptToken, encryptToken } from './crypto.js';
import type { AppEnv } from './env.js';
import type { PiShockCreds } from './pishock/client.js';

export async function savePiShockSession(
  env: AppEnv,
  discordUserId: string,
  userId: number,
  token: string,
) {
  const enc = encryptToken(env.tokenKey, token);
  await prisma.piShockSession.upsert({
    where: { discordUserId },
    create: {
      discordUserId,
      pishockUserId: userId,
      encryptedToken: enc.encryptedToken,
      tokenIv: enc.tokenIv,
      tokenAuthTag: enc.tokenAuthTag,
    },
    update: {
      pishockUserId: userId,
      encryptedToken: enc.encryptedToken,
      tokenIv: enc.tokenIv,
      tokenAuthTag: enc.tokenAuthTag,
    },
  });
}

export async function loadPiShockCreds(
  env: AppEnv,
  discordUserId: string,
): Promise<PiShockCreds | null> {
  const row = await prisma.piShockSession.findUnique({ where: { discordUserId } });
  if (!row) return null;
  const token = decryptToken(env.tokenKey, row.encryptedToken, row.tokenIv, row.tokenAuthTag);
  return { userId: row.pishockUserId, token };
}

export async function clearPiShockSession(discordUserId: string) {
  await prisma.piShockSession.deleteMany({ where: { discordUserId } });
}

export async function getConsent(discordUserId: string) {
  const user = await prisma.discordUser.findUnique({ where: { id: discordUserId } });
  return Boolean(user?.consentAt);
}

export async function setConsent(discordUserId: string) {
  await prisma.discordUser.update({
    where: { id: discordUserId },
    data: { consentAt: new Date() },
  });
}

export async function logCommand(input: {
  discordUserId: string;
  executorDiscordUserId?: string;
  targetDiscordUserId?: string;
  action: string;
  shockerId?: number;
  shareCode?: string;
  intensity?: number;
  durationMs?: number;
  success: boolean;
  detail?: string;
}) {
  await prisma.commandLog.create({ data: input });
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

export async function replaceActivityShares(
  discordUserId: string,
  shares: Array<{
    shockerId: number;
    shockerName: string;
    hubClientId?: string | null;
    shareCode?: string | null;
    deviceMaxIntensity?: number;
    deviceMaxDurationMs?: number;
    enabled?: boolean;
    paused?: boolean;
    maxIntensity?: number;
    maxDurationMs?: number;
    canShock?: boolean;
    canVibrate?: boolean;
    canBeep?: boolean;
    canHold?: boolean;
  }>,
) {
  await prisma.$transaction(async (tx) => {
    await tx.activityShare.deleteMany({ where: { discordUserId } });
    if (shares.length === 0) return;
    await tx.activityShare.createMany({
      data: shares.map((s) => {
        const deviceMaxIntensity = Math.max(1, Math.min(100, s.deviceMaxIntensity ?? 100));
        const deviceMaxDurationMs = Math.max(16, Math.min(15_000, s.deviceMaxDurationMs ?? 15_000));
        return {
          discordUserId,
          shockerId: s.shockerId,
          shockerName: s.shockerName,
          hubClientId: s.hubClientId ?? null,
          shareCode: s.shareCode ? String(s.shareCode) : null,
          deviceMaxIntensity,
          deviceMaxDurationMs,
          enabled: s.enabled !== false,
          paused: Boolean(s.paused),
          maxIntensity: Math.max(1, Math.min(deviceMaxIntensity, s.maxIntensity ?? deviceMaxIntensity)),
          maxDurationMs: Math.max(16, Math.min(deviceMaxDurationMs, s.maxDurationMs ?? deviceMaxDurationMs)),
          canShock: s.canShock !== false,
          canVibrate: s.canVibrate !== false,
          canBeep: s.canBeep !== false,
          canHold: s.canHold !== false,
        };
      }),
    });
  });
  return listActivityShares(discordUserId);
}

export async function getPersonalActivityLimits(discordUserId: string) {
  const user = await prisma.discordUser.findUnique({ where: { id: discordUserId } });
  return {
    activityMaxIntensity: user?.activityMaxIntensity ?? 100,
    activityMaxDurationMs: user?.activityMaxDurationMs ?? 15_000,
  };
}

export async function getEmergencyStopShockerIds(discordUserId: string): Promise<number[]> {
  const user = await prisma.discordUser.findUnique({
    where: { id: discordUserId },
    select: { emergencyStopShockerIds: true },
  });
  return user?.emergencyStopShockerIds ?? [];
}

export async function isEmergencyStopped(discordUserId: string, shockerId: number): Promise<boolean> {
  const ids = await getEmergencyStopShockerIds(discordUserId);
  return ids.includes(shockerId);
}

/** Latch or release owner emergency stop for a shocker. Returns the new engaged state. */
export async function setEmergencyStop(
  discordUserId: string,
  shockerId: number,
  engaged: boolean,
): Promise<{ engaged: boolean; emergencyStopShockerIds: number[] }> {
  const current = await getEmergencyStopShockerIds(discordUserId);
  const next = engaged
    ? [...new Set([...current, shockerId])]
    : current.filter((id) => id !== shockerId);
  const user = await prisma.discordUser.update({
    where: { id: discordUserId },
    data: { emergencyStopShockerIds: next },
    select: { emergencyStopShockerIds: true },
  });
  return {
    engaged: user.emergencyStopShockerIds.includes(shockerId),
    emergencyStopShockerIds: user.emergencyStopShockerIds,
  };
}

export async function setPersonalActivityLimits(
  discordUserId: string,
  input: { activityMaxIntensity?: number; activityMaxDurationMs?: number },
) {
  return prisma.discordUser.update({
    where: { id: discordUserId },
    data: {
      activityMaxIntensity: Math.max(1, Math.min(100, input.activityMaxIntensity ?? 100)),
      activityMaxDurationMs: Math.max(16, Math.min(15_000, input.activityMaxDurationMs ?? 15_000)),
    },
  });
}

export async function listActivityBans(ownerDiscordUserId: string) {
  return prisma.activityBan.findMany({
    where: { ownerDiscordUserId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function replaceActivityBans(ownerDiscordUserId: string, bannedDiscordUserIds: string[]) {
  const unique = [...new Set(bannedDiscordUserIds.filter(Boolean))];
  await prisma.$transaction(async (tx) => {
    await tx.activityBan.deleteMany({ where: { ownerDiscordUserId } });
    if (unique.length === 0) return;
    // Ensure banned users exist as DiscordUser rows (minimal stub)
    for (const id of unique) {
      await tx.discordUser.upsert({
        where: { id },
        create: { id },
        update: {},
      });
    }
    await tx.activityBan.createMany({
      data: unique.map((bannedDiscordUserId) => ({
        ownerDiscordUserId,
        bannedDiscordUserId,
      })),
    });
  });
  return listActivityBans(ownerDiscordUserId);
}

export async function isExecutorBanned(ownerDiscordUserId: string, executorDiscordUserId: string) {
  const row = await prisma.activityBan.findUnique({
    where: {
      ownerDiscordUserId_bannedDiscordUserId: {
        ownerDiscordUserId,
        bannedDiscordUserId: executorDiscordUserId,
      },
    },
  });
  return Boolean(row);
}

export async function listCommandLogs(discordUserId: string, limit = 50) {
  return prisma.commandLog.findMany({
    where: {
      OR: [
        { discordUserId },
        { executorDiscordUserId: discordUserId },
        { targetDiscordUserId: discordUserId },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
