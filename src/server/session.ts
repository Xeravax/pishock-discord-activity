import { prisma } from './db.js';
import { decryptToken, encryptToken, hashApiKey } from './crypto.js';
import type { AppEnv } from './env.js';
import {
  allowPiShockApiKey,
  invalidateControlSnapshot,
  isPiShockApiKeyRejected,
  onPiShockApiKeyRejected,
  type PiShockCreds,
} from './pishock/client.js';
import { disconnectBroker, disconnectBrokerSessionsForToken } from './pishock/broker.js';
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
  const apiKeyHash = hashApiKey(input.apiKey);
  allowPiShockApiKey(input.apiKey);
  const displaced = await prisma.$transaction(async (tx) => {
    const conflicts = await tx.piShockSession.findMany({
      where: {
        discordUserId: { not: discordUserId },
        OR: [{ pishockUserId: input.userId }, { apiKeyHash }],
      },
      select: { discordUserId: true },
    });
    if (conflicts.length > 0) {
      await tx.piShockSession.deleteMany({
        where: { discordUserId: { in: conflicts.map((row) => row.discordUserId) } },
      });
    }
    await tx.piShockSession.upsert({
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
        apiKeyHash,
      },
      update: {
        pishockUserId: input.userId,
        pishockUsername: input.username,
        encryptedToken: enc.encryptedToken,
        tokenIv: enc.tokenIv,
        tokenAuthTag: enc.tokenAuthTag,
        expiresAt: input.expiresAt ?? null,
        apiKeyId: input.apiKeyId ?? null,
        apiKeyHash,
      },
    });
    return conflicts.map((row) => row.discordUserId);
  });
  for (const otherId of displaced) {
    console.warn(`[pishock] unlinked ${otherId} because PiShock account ${input.userId} was linked elsewhere`);
    disconnectBroker(otherId);
  }
}

export async function loadPiShockCreds(
  env: AppEnv,
  discordUserId: string,
): Promise<PiShockCreds | null> {
  const row = await prisma.piShockSession.findUnique({ where: { discordUserId } });
  if (!row) return null;
  // No clock wipe — keys stay until PiShock rejects them (401 → clearPiShockSession).
  const token = decryptToken(env.tokenKey, row.encryptedToken, row.tokenIv, row.tokenAuthTag);
  if (isPiShockApiKeyRejected(token)) {
    // Compare-and-delete so a replacement key linked meanwhile is preserved.
    const deleted = await prisma.piShockSession.deleteMany({
      where: {
        discordUserId,
        encryptedToken: row.encryptedToken,
        tokenIv: row.tokenIv,
        tokenAuthTag: row.tokenAuthTag,
      },
    });
    if (deleted.count > 0) disconnectBroker(discordUserId);
    return null;
  }
  const apiKeyHash = hashApiKey(token);
  if (row.apiKeyHash !== apiKeyHash) {
    const displaced = await prisma.piShockSession.findMany({
      where: { apiKeyHash, discordUserId: { not: discordUserId } },
      select: { discordUserId: true },
    });
    if (displaced.length > 0) {
      await prisma.piShockSession.deleteMany({
        where: { discordUserId: { in: displaced.map((other) => other.discordUserId) } },
      });
      for (const other of displaced) disconnectBroker(other.discordUserId);
    }
    // Only stamp the hash if this ciphertext is still the stored session.
    await prisma.piShockSession.updateMany({
      where: {
        discordUserId,
        encryptedToken: row.encryptedToken,
        tokenIv: row.tokenIv,
        tokenAuthTag: row.tokenAuthTag,
        OR: [{ apiKeyHash: null }, { apiKeyHash: { not: apiKeyHash } }],
      },
      data: { apiKeyHash },
    });
  }
  return {
    userId: row.pishockUserId,
    username: row.pishockUsername,
    token,
  };
}

export async function clearPiShockSession(discordUserId: string) {
  const row = await prisma.piShockSession.findUnique({
    where: { discordUserId },
    select: { pishockUserId: true },
  });
  if (row) invalidateControlSnapshot(row.pishockUserId);
  disconnectBroker(discordUserId);
  await prisma.piShockSession.deleteMany({ where: { discordUserId } });
}

let rejectionHandlerInstalled = false;

/** Drop stored keys and broker sockets after PiShock confirms a 401. */
export function installPiShockKeyRejectionHandler(env: AppEnv) {
  if (rejectionHandlerInstalled) return;
  rejectionHandlerInstalled = true;
  onPiShockApiKeyRejected((token) => {
    disconnectBrokerSessionsForToken(token);
    void purgePiShockSessionsForRejectedKey(env, token).catch((err) => {
      console.warn(
        '[pishock] failed to clear rejected API key session',
        err instanceof Error ? err.message : err,
      );
    });
  });
}

async function deleteRejectedKeySession(
  discordUserId: string,
  where: {
    apiKeyHash: string | null;
    encryptedToken?: string;
    tokenIv?: string;
    tokenAuthTag?: string;
  },
) {
  const removed = await prisma.piShockSession.deleteMany({
    where: { discordUserId, ...where },
  });
  if (removed.count < 1) return;
  console.warn(`[pishock] clearing session for ${discordUserId} after API key 401`);
  disconnectBroker(discordUserId);
}

async function purgePiShockSessionsForRejectedKey(env: AppEnv, token: string) {
  const hash = hashApiKey(token);
  const rows = await prisma.piShockSession.findMany({
    where: { OR: [{ apiKeyHash: hash }, { apiKeyHash: null }] },
    select: {
      discordUserId: true,
      encryptedToken: true,
      tokenIv: true,
      tokenAuthTag: true,
      apiKeyHash: true,
    },
  });
  for (const row of rows) {
    if (row.apiKeyHash === hash) {
      await deleteRejectedKeySession(row.discordUserId, { apiKeyHash: hash });
      continue;
    }
    let stored = '';
    try {
      stored = decryptToken(env.tokenKey, row.encryptedToken, row.tokenIv, row.tokenAuthTag);
    } catch {
      continue;
    }
    if (stored === token) {
      await deleteRejectedKeySession(row.discordUserId, {
        apiKeyHash: null,
        encryptedToken: row.encryptedToken,
        tokenIv: row.tokenIv,
        tokenAuthTag: row.tokenAuthTag,
      });
      continue;
    }
    await prisma.piShockSession
      .updateMany({
        where: {
          discordUserId: row.discordUserId,
          apiKeyHash: null,
          encryptedToken: row.encryptedToken,
          tokenIv: row.tokenIv,
          tokenAuthTag: row.tokenAuthTag,
        },
        data: { apiKeyHash: hashApiKey(stored) },
      })
      .catch(() => {
        // Another row already owns this hash.
      });
  }
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

function cleanLoggedName(value: string | null | undefined): string | null {
  const name = value?.trim();
  return name ? name.slice(0, 120) : null;
}

/** @deprecated use cleanLoggedName */
function cleanLoggedShockerName(value: string | null | undefined): string | null {
  return cleanLoggedName(value);
}

type ActivityShareLogMeta = {
  shockerName: string | null;
  hubClientId: string | null;
  hubName: string | null;
};

/** Activity share device/hub labels for a wearer's shocker, when registered. */
export async function lookupActivityShockerName(
  ownerDiscordUserId: string,
  shockerId: number,
): Promise<string | null> {
  const meta = await lookupActivityShareLogMeta(ownerDiscordUserId, shockerId);
  return meta?.shockerName ?? null;
}

async function lookupActivityShareLogMeta(
  ownerDiscordUserId: string,
  shockerId: number,
): Promise<ActivityShareLogMeta | null> {
  if (!ownerDiscordUserId || !Number.isFinite(shockerId) || shockerId <= 0) return null;
  const share = await findActivityShareByShocker(ownerDiscordUserId, Math.round(shockerId));
  if (!share) return null;
  return {
    shockerName: cleanLoggedName(share.shockerName),
    hubClientId: share.hubClientId ? String(share.hubClientId).trim() || null : null,
    hubName: cleanLoggedName(share.hubName),
  };
}

async function activityShareLogMetaMap(
  pairs: Array<{ ownerDiscordUserId: string; shockerId: number }>,
): Promise<Map<string, ActivityShareLogMeta>> {
  const unique = new Map<string, { discordUserId: string; shockerId: number }>();
  for (const pair of pairs) {
    if (!pair.ownerDiscordUserId || !Number.isFinite(pair.shockerId) || pair.shockerId <= 0) continue;
    unique.set(`${pair.ownerDiscordUserId}:${pair.shockerId}`, {
      discordUserId: pair.ownerDiscordUserId,
      shockerId: pair.shockerId,
    });
  }
  if (unique.size === 0) return new Map();
  const shares = await prisma.activityShare.findMany({
    where: { OR: [...unique.values()] },
    select: { discordUserId: true, shockerId: true, shockerName: true, hubClientId: true, hubName: true },
  });
  const out = new Map<string, ActivityShareLogMeta>();
  for (const share of shares) {
    out.set(`${share.discordUserId}:${share.shockerId}`, {
      shockerName: cleanLoggedName(share.shockerName),
      hubClientId: share.hubClientId ? String(share.hubClientId).trim() || null : null,
      hubName: cleanLoggedName(share.hubName),
    });
  }
  return out;
}

export async function logCommand(input: {
  discordUserId: string;
  executorDiscordUserId?: string;
  targetDiscordUserId?: string;
  executorLabel?: string;
  action: string;
  shockerId?: number;
  shockerName?: string | null;
  hubClientId?: string | null;
  hubName?: string | null;
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
  const ownerId = input.targetDiscordUserId || input.discordUserId;
  const needsShareLookup =
    input.shockerId != null &&
    (!cleanLoggedName(input.shockerName) ||
      !String(input.hubClientId ?? '').trim() ||
      !cleanLoggedName(input.hubName));
  const shareMeta =
    needsShareLookup && input.shockerId != null
      ? await lookupActivityShareLogMeta(ownerId, input.shockerId)
      : null;

  const shockerName = cleanLoggedName(input.shockerName) ?? shareMeta?.shockerName ?? null;
  const hubClientId =
    (input.hubClientId != null && String(input.hubClientId).trim()) ||
    shareMeta?.hubClientId ||
    null;
  const hubName = cleanLoggedName(input.hubName) ?? shareMeta?.hubName ?? null;

  await prisma.commandLog.create({
    data: {
      discordUserId: input.discordUserId,
      executorDiscordUserId: input.executorDiscordUserId,
      targetDiscordUserId: input.targetDiscordUserId,
      executorLabel: input.executorLabel,
      action: input.action,
      shockerId: input.shockerId,
      shockerName,
      hubClientId,
      hubName,
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

export async function getEmergencyStopShockerIds(discordUserId: string): Promise<number[]> {
  const user = await prisma.discordUser.findUnique({
    where: { id: discordUserId },
    select: { emergencyStopShockerIds: true },
  });
  return user?.emergencyStopShockerIds ?? [];
}

const pendingEmergencyStops = new Set<string>();

/** Keep admission closed while the durable emergency-stop latch is being written. */
export function gateEmergencyStops(discordUserId: string, shockerIds: number[], engaged: boolean): void {
  for (const id of shockerIds) {
    const key = `${discordUserId}:${id}`;
    if (engaged) pendingEmergencyStops.add(key);
    else pendingEmergencyStops.delete(key);
  }
}

export async function isEmergencyStopped(discordUserId: string, shockerId: number): Promise<boolean> {
  const key = `${discordUserId}:${shockerId}`;
  if (pendingEmergencyStops.has(key)) return true;
  const ids = await getEmergencyStopShockerIds(discordUserId);
  return pendingEmergencyStops.has(key) || ids.includes(shockerId);
}

/** Latch or release owner emergency stop for one or more shockers. */
export async function setEmergencyStops(
  discordUserId: string,
  shockerIds: number[],
  engaged: boolean,
): Promise<{ engagedIds: number[]; emergencyStopShockerIds: number[] }> {
  const unique = [
    ...new Set(shockerIds.filter((id) => Number.isFinite(id) && id > 0).map((id) => Math.floor(id))),
  ];
  const current = await getEmergencyStopShockerIds(discordUserId);
  const drop = new Set(unique);
  const next = engaged
    ? [...new Set([...current, ...unique])]
    : current.filter((id) => !drop.has(id));
  const user = await prisma.discordUser.update({
    where: { id: discordUserId },
    data: { emergencyStopShockerIds: next },
    select: { emergencyStopShockerIds: true },
  });
  return {
    engagedIds: unique.filter((id) => user.emergencyStopShockerIds.includes(id)),
    emergencyStopShockerIds: user.emergencyStopShockerIds,
  };
}

/** Latch or release owner emergency stop for a shocker. Returns the new engaged state. */
export async function setEmergencyStop(
  discordUserId: string,
  shockerId: number,
  engaged: boolean,
): Promise<{ engaged: boolean; emergencyStopShockerIds: number[] }> {
  const result = await setEmergencyStops(discordUserId, [shockerId], engaged);
  return {
    engaged: result.emergencyStopShockerIds.includes(shockerId),
    emergencyStopShockerIds: result.emergencyStopShockerIds,
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
    activityMinDurationMs: definedNumber(input.activityMinDurationMs ?? stored?.activityMinDurationMs),
    activityMaxDurationMs: definedNumber(input.activityMaxDurationMs ?? stored?.activityMaxDurationMs),
    activityVibMinIntensity: definedNumber(input.activityVibMinIntensity ?? stored?.activityVibMinIntensity),
    activityVibMaxIntensity: definedNumber(input.activityVibMaxIntensity ?? stored?.activityVibMaxIntensity),
    activityVibMinDurationMs: definedNumber(input.activityVibMinDurationMs ?? stored?.activityVibMinDurationMs),
    activityVibMaxDurationMs: definedNumber(input.activityVibMaxDurationMs ?? stored?.activityVibMaxDurationMs),
    activityBeepMinIntensity: definedNumber(input.activityBeepMinIntensity ?? stored?.activityBeepMinIntensity),
    activityBeepMaxIntensity: definedNumber(input.activityBeepMaxIntensity ?? stored?.activityBeepMaxIntensity),
    activityBeepMinDurationMs: definedNumber(input.activityBeepMinDurationMs ?? stored?.activityBeepMinDurationMs),
    activityBeepMaxDurationMs: definedNumber(input.activityBeepMaxDurationMs ?? stored?.activityBeepMaxDurationMs),
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

  const metaByKey = await activityShareLogMetaMap(
    rows
      .filter(
        (row) =>
          row.shockerId &&
          (!row.shockerName || !row.hubClientId || !row.hubName),
      )
      .map((row) => ({
        ownerDiscordUserId: row.targetDiscordUserId ?? row.discordUserId,
        shockerId: row.shockerId!,
      })),
  );

  // Share codes are a capability — only the device owner's own log rows may see them.
  return rows.map((row) => {
    const deviceOwnerId = row.targetDiscordUserId ?? row.discordUserId;
    const canSeeShareCode =
      Boolean(row.shareCode) &&
      deviceOwnerId === discordUserId &&
      row.discordUserId === discordUserId;
    const meta = row.shockerId ? metaByKey.get(`${deviceOwnerId}:${row.shockerId}`) : undefined;
    const shockerName = cleanLoggedName(row.shockerName) ?? meta?.shockerName ?? null;
    const hubClientId = row.hubClientId ?? meta?.hubClientId ?? null;
    const hubName = cleanLoggedName(row.hubName) ?? meta?.hubName ?? null;
    return {
      ...row,
      shockerName,
      hubClientId,
      hubName,
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
      shockerName: true,
      hubClientId: true,
      hubName: true,
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

  const metaByKey = await activityShareLogMetaMap(
    deduped
      .filter(
        (row) =>
          row.shockerId &&
          row.targetDiscordUserId &&
          (!row.shockerName || !row.hubClientId || !row.hubName),
      )
      .map((row) => ({
        ownerDiscordUserId: row.targetDiscordUserId!,
        shockerId: row.shockerId!,
      })),
  );

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
    const meta =
      row.shockerId && row.targetDiscordUserId
        ? metaByKey.get(`${row.targetDiscordUserId}:${row.shockerId}`)
        : undefined;
    return {
      id: row.id,
      action: row.action,
      shockerId: row.shockerId,
      shockerName: cleanLoggedName(row.shockerName) ?? meta?.shockerName ?? null,
      hubClientId: row.hubClientId ?? meta?.hubClientId ?? null,
      hubName: cleanLoggedName(row.hubName) ?? meta?.hubName ?? null,
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

