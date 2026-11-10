import { prisma } from './db.js';
import { decryptToken, encryptToken } from './crypto.js';
import type { AppEnv } from './env.js';
import type { PiShockCreds } from './pishock/client.js';
import { stopLogCapture } from './pishock/broker.js';
import {
  QUEUE_PROGRESS_MAX_MS,
  QUEUE_PROGRESS_MIN_MS,
  clampQueueMaxPerSender,
} from './pishock/command-queue.js';
import { personalBandsFromUser, shareBandsFromRow } from './limit-bands.js';
import { normalizeWarningLevel } from '../shared/warning.js';

export async function savePiShockSession(
  env: AppEnv,
  discordUserId: string,
  input: {
    userId: number;
    username: string;
    apiKey: string;
    /** Soft hint only — null means keep until PiShock rejects the key. */
    expiresAt?: Date | null;
    apiKeyId?: number | null;
  },
) {
  const enc = encryptToken(env.tokenKey, input.apiKey);
  await prisma.piShockSession.upsert({
    where: { discordUserId },
    create: {
      discordUserId,
      pishockUserId: input.userId,
      pishockUsername: input.username,
      encryptedToken: enc.encryptedToken,
      tokenIv: enc.tokenIv,
      tokenAuthTag: enc.tokenAuthTag,
      expiresAt: input.expiresAt ?? null,
      apiKeyId: input.apiKeyId ?? null,
    },
    update: {
      pishockUserId: input.userId,
      pishockUsername: input.username,
      encryptedToken: enc.encryptedToken,
      tokenIv: enc.tokenIv,
      tokenAuthTag: enc.tokenAuthTag,
      expiresAt: input.expiresAt ?? null,
      apiKeyId: input.apiKeyId ?? null,
    },
  });
}

export async function loadPiShockCreds(
  env: AppEnv,
  discordUserId: string,
): Promise<PiShockCreds | null> {
  const row = await prisma.piShockSession.findUnique({ where: { discordUserId } });
  if (!row) return null;
  // No clock wipe — keys stay until PiShock rejects them (401 → clearPiShockSession).
  const token = decryptToken(env.tokenKey, row.encryptedToken, row.tokenIv, row.tokenAuthTag);
  return {
    userId: row.pishockUserId,
    username: row.pishockUsername,
    token,
  };
}

export async function clearPiShockSession(discordUserId: string) {
  stopLogCapture(discordUserId);
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

export async function clearConsent(discordUserId: string) {
  await prisma.discordUser.update({
    where: { id: discordUserId },
    data: { consentAt: null },
  });
}

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

export type CommandLogSource = 'discord' | 'website';

export async function logCommand(input: {
  discordUserId: string;
  executorDiscordUserId?: string;
  targetDiscordUserId?: string;
  executorLabel?: string;
  action: string;
  shockerId?: number;
  shareCode?: string;
  intensity?: number;
  durationMs?: number;
  success: boolean;
  detail?: string;
  source?: CommandLogSource;
  instanceId?: string | null;
  guildId?: string | null;
  channelId?: string | null;
  locationKind?: string | null;
  locationName?: string | null;
  locationIconUrl?: string | null;
  externalLogKey?: string | null;
}) {
  await prisma.commandLog.create({
    data: {
      discordUserId: input.discordUserId,
      executorDiscordUserId: input.executorDiscordUserId,
      targetDiscordUserId: input.targetDiscordUserId,
      executorLabel: input.executorLabel,
      action: input.action,
      shockerId: input.shockerId,
      shareCode: input.shareCode,
      intensity: input.intensity,
      durationMs: input.durationMs,
      success: input.success,
      detail: input.detail,
      source: input.source ?? 'discord',
      instanceId: input.instanceId ?? undefined,
      guildId: input.guildId ?? undefined,
      channelId: input.channelId ?? undefined,
      locationKind: input.locationKind ?? undefined,
      locationName: input.locationName ?? undefined,
      locationIconUrl: input.locationIconUrl ?? undefined,
      externalLogKey: input.externalLogKey ?? undefined,
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
  }>,
) {
  await prisma.$transaction(async (tx) => {
    await tx.activityShare.deleteMany({ where: { discordUserId } });
    if (shares.length === 0) return;
    await tx.activityShare.createMany({
      data: shares.map((s) => {
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
        };
      }),
    });
  });
  return listActivityShares(discordUserId);
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

export type CommandQueueSettings = {
  enabled: boolean;
  progressMs: number;
  maxPerSender: number;
  starOnly: boolean;
};

const QUEUE_SETTINGS_SELECT = {
  commandQueueEnabled: true,
  commandQueueProgressMs: true,
  commandQueueMaxPerSender: true,
  commandQueueStarOnly: true,
} as const;

function mapQueueSettings(user: {
  commandQueueEnabled: boolean;
  commandQueueProgressMs: number;
  commandQueueMaxPerSender: number;
  commandQueueStarOnly: boolean;
} | null): CommandQueueSettings {
  return {
    enabled: Boolean(user?.commandQueueEnabled),
    progressMs: user?.commandQueueProgressMs ?? 0,
    maxPerSender: clampQueueMaxPerSender(user?.commandQueueMaxPerSender ?? 3),
    starOnly: Boolean(user?.commandQueueStarOnly),
  };
}

export async function getCommandQueueSettings(
  discordUserId: string,
): Promise<CommandQueueSettings> {
  const user = await prisma.discordUser.findUnique({
    where: { id: discordUserId },
    select: QUEUE_SETTINGS_SELECT,
  });
  return mapQueueSettings(user);
}

export async function getCommandQueueEnabled(discordUserId: string): Promise<boolean> {
  return (await getCommandQueueSettings(discordUserId)).enabled;
}

export async function setCommandQueueEnabled(
  discordUserId: string,
  enabled: boolean,
): Promise<boolean> {
  const user = await prisma.discordUser.update({
    where: { id: discordUserId },
    data: { commandQueueEnabled: enabled },
    select: { commandQueueEnabled: true },
  });
  return user.commandQueueEnabled;
}

export async function getCommandQueueProgressMs(discordUserId: string): Promise<number> {
  return (await getCommandQueueSettings(discordUserId)).progressMs;
}

export async function setCommandQueueProgressMs(
  discordUserId: string,
  progressMs: number,
): Promise<number> {
  const clamped = Math.max(
    QUEUE_PROGRESS_MIN_MS,
    Math.min(QUEUE_PROGRESS_MAX_MS, Math.floor(Number(progressMs) || 0)),
  );
  const user = await prisma.discordUser.update({
    where: { id: discordUserId },
    data: { commandQueueProgressMs: clamped },
    select: { commandQueueProgressMs: true },
  });
  return user.commandQueueProgressMs;
}

export async function setCommandQueueSettings(
  discordUserId: string,
  patch: Partial<{
    enabled: boolean;
    progressMs: number;
    maxPerSender: number;
    starOnly: boolean;
  }>,
): Promise<CommandQueueSettings> {
  const data: {
    commandQueueEnabled?: boolean;
    commandQueueProgressMs?: number;
    commandQueueMaxPerSender?: number;
    commandQueueStarOnly?: boolean;
  } = {};
  if (typeof patch.enabled === 'boolean') data.commandQueueEnabled = patch.enabled;
  if (typeof patch.progressMs === 'number' && Number.isFinite(patch.progressMs)) {
    data.commandQueueProgressMs = Math.max(
      QUEUE_PROGRESS_MIN_MS,
      Math.min(QUEUE_PROGRESS_MAX_MS, Math.floor(patch.progressMs)),
    );
  }
  if (typeof patch.maxPerSender === 'number' && Number.isFinite(patch.maxPerSender)) {
    data.commandQueueMaxPerSender = clampQueueMaxPerSender(patch.maxPerSender);
  }
  if (typeof patch.starOnly === 'boolean') data.commandQueueStarOnly = patch.starOnly;

  if (Object.keys(data).length === 0) {
    return getCommandQueueSettings(discordUserId);
  }

  const user = await prisma.discordUser.update({
    where: { id: discordUserId },
    data,
    select: QUEUE_SETTINGS_SELECT,
  });
  return mapQueueSettings(user);
}

export async function listQueueStars(ownerDiscordUserId: string): Promise<string[]> {
  const rows = await prisma.activityQueueStar.findMany({
    where: { ownerDiscordUserId },
    select: { starredDiscordUserId: true },
  });
  return rows.map((r) => r.starredDiscordUserId);
}

export async function isQueueStarred(
  ownerDiscordUserId: string,
  starredDiscordUserId: string,
): Promise<boolean> {
  const row = await prisma.activityQueueStar.findUnique({
    where: {
      ownerDiscordUserId_starredDiscordUserId: { ownerDiscordUserId, starredDiscordUserId },
    },
    select: { id: true },
  });
  return Boolean(row);
}

export async function setQueueStar(
  ownerDiscordUserId: string,
  starredDiscordUserId: string,
  starred: boolean,
): Promise<boolean> {
  if (ownerDiscordUserId === starredDiscordUserId) {
    return false;
  }
  if (starred) {
    await prisma.discordUser.upsert({
      where: { id: starredDiscordUserId },
      create: { id: starredDiscordUserId },
      update: {},
    });
    await prisma.activityQueueStar.upsert({
      where: {
        ownerDiscordUserId_starredDiscordUserId: { ownerDiscordUserId, starredDiscordUserId },
      },
      create: { ownerDiscordUserId, starredDiscordUserId },
      update: {},
    });
    return true;
  }
  await prisma.activityQueueStar.deleteMany({
    where: { ownerDiscordUserId, starredDiscordUserId },
  });
  return false;
}

export async function setPersonalActivityLimits(
  discordUserId: string,
  input: {
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
  },
) {
  const bands = personalBandsFromUser({
    activityMinIntensity: input.activityMinIntensity,
    activityMaxIntensity: input.activityMaxIntensity,
    activityMinDurationMs: input.activityMinDurationMs,
    activityMaxDurationMs: input.activityMaxDurationMs,
    activityVibMinIntensity: input.activityVibMinIntensity,
    activityVibMaxIntensity: input.activityVibMaxIntensity,
    activityVibMinDurationMs: input.activityVibMinDurationMs,
    activityVibMaxDurationMs: input.activityVibMaxDurationMs,
    activityBeepMinIntensity: input.activityBeepMinIntensity,
    activityBeepMaxIntensity: input.activityBeepMaxIntensity,
    activityBeepMinDurationMs: input.activityBeepMinDurationMs,
    activityBeepMaxDurationMs: input.activityBeepMaxDurationMs,
    activityRequiredWarningLevel: input.activityRequiredWarningLevel,
  });
  return prisma.discordUser.update({
    where: { id: discordUserId },
    data: {
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
  const rows = await prisma.commandLog.findMany({
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

  // Share codes are a capability — only the device owner's own log rows may see them.
  return rows.map((row) => {
    const deviceOwnerId = row.targetDiscordUserId ?? row.discordUserId;
    const canSeeShareCode =
      Boolean(row.shareCode) &&
      deviceOwnerId === discordUserId &&
      row.discordUserId === discordUserId;
    return {
      ...row,
      shareCode: canSeeShareCode ? row.shareCode : null,
      hasShareCode: Boolean(row.shareCode),
    };
  });
}

const PUBLIC_LOG_NOISE = new Set([
  'end',
  'stop',
  'participant_end',
  'emergency_stop_on',
  'emergency_stop_off',
  'pause_share',
  'pause_link',
]);

function isPublicLogAction(action: string): boolean {
  const a = action.toLowerCase();
  if (PUBLIC_LOG_NOISE.has(a)) return false;
  if (a.endsWith('_end')) return false;
  return true;
}

function discordAvatarUrl(id: string, avatar: string | null | undefined): string {
  if (avatar) {
    return `https://cdn.discordapp.com/avatars/${id}/${avatar}.png?size=64`;
  }
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return `https://cdn.discordapp.com/embed/avatars/${Math.abs(hash) % 6}.png`;
}

function publicLogPerson(user: {
  id: string;
  username: string | null;
  globalName: string | null;
  avatar: string | null;
} | undefined, fallbackId: string) {
  const id = user?.id ?? fallbackId;
  return {
    id,
    username: user?.username ?? null,
    globalName: user?.globalName ?? null,
    displayName: user?.globalName || user?.username || 'Unknown',
    avatar: user?.avatar ?? null,
    avatarUrl: discordAvatarUrl(id, user?.avatar),
  };
}

/**
 * Global recent feed: who shocked/vibed/beeped whom, across all instances.
 * Dedupes dual participant writes by keeping the target's copy only.
 * Never returns share codes.
 */
export async function listPublicCommandLogs(limit = 200) {
  const take = Math.max(1, Math.min(250, limit));
  const rows = await prisma.commandLog.findMany({
    where: {
      success: true,
      targetDiscordUserId: { not: null },
      OR: [{ executorDiscordUserId: { not: null } }, { executorLabel: { not: null } }],
    },
    orderBy: { createdAt: 'desc' },
    take: take * 3,
    select: {
      id: true,
      discordUserId: true,
      executorDiscordUserId: true,
      targetDiscordUserId: true,
      executorLabel: true,
      action: true,
      shockerId: true,
      intensity: true,
      durationMs: true,
      success: true,
      source: true,
      locationKind: true,
      locationName: true,
      locationIconUrl: true,
      guildId: true,
      channelId: true,
      createdAt: true,
    },
  });

  const deduped = rows
    .filter(
      (row) =>
        row.targetDiscordUserId &&
        row.discordUserId === row.targetDiscordUserId &&
        isPublicLogAction(row.action) &&
        (row.executorDiscordUserId || row.executorLabel),
    )
    .slice(0, take);

  const userIds = [
    ...new Set(
      deduped.flatMap((row) =>
        [row.executorDiscordUserId, row.targetDiscordUserId].filter(Boolean) as string[],
      ),
    ),
  ];
  const users = userIds.length
    ? await prisma.discordUser.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true, globalName: true, avatar: true },
      })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));

  return deduped.map((row) => {
    const targetId = row.targetDiscordUserId!;
    const executorId = row.executorDiscordUserId;
    const executor = executorId
      ? publicLogPerson(byId.get(executorId), executorId)
      : {
          id: `label:${row.executorLabel ?? 'website'}`,
          username: null,
          globalName: null,
          displayName: row.executorLabel || 'Website',
          avatar: null,
          avatarUrl: discordAvatarUrl('0', null),
        };
    return {
      id: row.id,
      action: row.action,
      shockerId: row.shockerId,
      intensity: row.intensity,
      durationMs: row.durationMs,
      success: row.success,
      createdAt: row.createdAt,
      source: row.source === 'website' ? 'website' : 'discord',
      location:
        row.locationName || row.locationIconUrl
          ? {
              kind: row.locationKind,
              name: row.locationName,
              iconUrl: row.locationIconUrl,
              guildId: row.guildId,
              channelId: row.channelId,
            }
          : null,
      executor,
      target: publicLogPerson(byId.get(targetId), targetId),
    };
  });
}

