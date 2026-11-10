import { prisma } from './db.js';
import { decryptToken, encryptToken } from './crypto.js';
import type { AppEnv } from './env.js';
import { loadLogs, type PiShockCreds } from './pishock/client.js';
import { AGENT_NAME } from '../shared/constants.js';

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

function pickDeviceLogString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = row[key];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

function pickDeviceLogNumber(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const v = row[key];
    if (v == null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseDeviceLogTime(row: Record<string, unknown>): Date {
  const raw = pickDeviceLogString(row, [
    'Time',
    'time',
    'Timestamp',
    'timestamp',
    'Date',
    'date',
    'Created',
    'created',
    'CreatedAt',
    'createdAt',
    'LogTime',
    'logTime',
  ]);
  if (!raw) return new Date();
  const msMatch = /\/Date\((\d+)/.exec(raw);
  if (msMatch) return new Date(Number(msMatch[1]));
  const asNum = Number(raw);
  if (Number.isFinite(asNum) && asNum > 1_000_000_000) {
    return new Date(asNum < 1e12 ? asNum * 1000 : asNum);
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed) : new Date();
}

function normalizeDeviceLogAction(raw: string | null): string {
  const a = (raw ?? '').toLowerCase();
  if (a.includes('vib') || a === 'v' || a === '1') return 'vibrate';
  if (a.includes('beep') || a === 'b' || a === '2') return 'beep';
  if (a.includes('shock') || a === 's' || a === '0' || a.includes('hold')) return 'shock';
  return 'shock';
}

function durationMsFromDeviceLog(row: Record<string, unknown>): number | null {
  const ms = pickDeviceLogNumber(row, ['DurationMs', 'durationMs', 'duration_ms']);
  if (ms != null) return Math.round(ms);
  const dur = pickDeviceLogNumber(row, ['Duration', 'duration', 'Dur', 'dur', 'd']);
  if (dur == null) return null;
  if (dur > 30) return Math.round(dur);
  return Math.round(dur * 1000);
}

function isDiscordAppAgent(agent: string | null): boolean {
  if (!agent) return false;
  const a = agent.toLowerCase();
  return a.includes('discord pishock activity') || a.includes('discord ·');
}

/**
 * Pull PiShock website/device logs for this account into CommandLog (source=website).
 * Skips rows that already look like Discord Activity commands (those live in our DB).
 */
export async function syncWebsiteDeviceLogs(
  ownerDiscordUserId: string,
  creds: PiShockCreds,
): Promise<number> {
  let raw: unknown = null;
  try {
    const result = await loadLogs(creds);
    if (result.status === 404 || result.status === 405) return 0;
    raw = result.data;
  } catch {
    return 0;
  }

  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? (() => {
          const obj = raw as Record<string, unknown>;
          for (const key of ['Logs', 'logs', 'Items', 'items', 'Data', 'data', 'Entries', 'entries']) {
            if (Array.isArray(obj[key])) return obj[key] as unknown[];
          }
          return [];
        })()
      : [];

  let inserted = 0;
  for (const [idx, item] of list.slice(0, 100).entries()) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const agent =
      pickDeviceLogString(row, [
        'AgentName',
        'agentName',
        'Username',
        'UserName',
        'username',
        'From',
        'from',
        'Name',
        'name',
        'Origin',
        'origin',
      ]) ?? 'Website';
    if (isDiscordAppAgent(agent) || agent === AGENT_NAME) continue;

    const action = normalizeDeviceLogAction(
      pickDeviceLogString(row, ['Type', 'type', 'Mode', 'mode', 'Op', 'op', 'Operation', 'operation']),
    );
    if (!isPublicLogAction(action)) continue;

    const intensity = pickDeviceLogNumber(row, ['Intensity', 'intensity', 'Int', 'int', 'i']);
    const durationMs = durationMsFromDeviceLog(row);
    const shockerId = pickDeviceLogNumber(row, ['ShockerId', 'shockerId', 'Id', 'id']);
    const at = parseDeviceLogTime(row);
    const externalId =
      pickDeviceLogString(row, ['Id', 'id', 'LogId', 'logId']) ??
      `${at.toISOString()}:${agent}:${action}:${intensity ?? ''}:${durationMs ?? ''}:${shockerId ?? idx}`;
    const externalLogKey = `website:${ownerDiscordUserId}:${externalId}`;

    try {
      await prisma.commandLog.create({
        data: {
          discordUserId: ownerDiscordUserId,
          executorDiscordUserId: null,
          targetDiscordUserId: ownerDiscordUserId,
          executorLabel: agent.slice(0, 80),
          action,
          shockerId: shockerId != null && shockerId > 0 ? Math.round(shockerId) : null,
          intensity: intensity != null ? Math.round(intensity) : null,
          durationMs: durationMs != null ? Math.round(durationMs) : null,
          success: true,
          source: 'website',
          externalLogKey,
          createdAt: at,
          detail: JSON.stringify({ via: 'pishock_load_logs', agent }),
        },
      });
      inserted += 1;
    } catch {
      // unique externalLogKey → already synced
    }
  }
  return inserted;
}
