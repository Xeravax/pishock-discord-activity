import { prisma } from '../db.js';
import { normalizeWarningLevel, type WarningLevel } from '../../shared/warning.js';
import { findActivityShareByShocker } from './activity-limits.js';
import {
  LOG_PRIVACY_SELECT,
  DEFAULT_LOG_PRIVACY,
  applyLogPrivacy,
  logPrivacyFromColumns,
  type LogViewer,
  type PublicLogRow,
} from '../log-privacy.js';

export type CommandLogSource = 'discord' | 'website';

function cleanLoggedName(value: string | null | undefined): string | null {
  const name = value?.trim();
  return name ? name.slice(0, 120) : null;
}

/** Persist only a warning that was actually sent. `none` and unknown values stay null. */
function storedWarningLevel(value: unknown): Exclude<WarningLevel, 'none'> | null {
  const level = normalizeWarningLevel(value, 'none');
  return level === 'none' ? null : level;
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
    if (!pair.ownerDiscordUserId || !Number.isFinite(pair.shockerId) || pair.shockerId <= 0)
      continue;
    unique.set(`${pair.ownerDiscordUserId}:${pair.shockerId}`, {
      discordUserId: pair.ownerDiscordUserId,
      shockerId: pair.shockerId,
    });
  }
  if (unique.size === 0) return new Map();
  const shares = await prisma.activityShare.findMany({
    where: { OR: [...unique.values()] },
    select: {
      discordUserId: true,
      shockerId: true,
      shockerName: true,
      hubClientId: true,
      hubName: true,
    },
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
  /** small | mid | long when a warning vibe was sent before this shock or hold. */
  warningLevel?: WarningLevel | null;
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
  /** Admin used bypass on this command. */
  adminBypass?: boolean;
  bypassedGates?: string[];
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
  const warningLevel = storedWarningLevel(input.warningLevel);

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
      warningLevel,
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
      adminBypass: Boolean(input.adminBypass),
      bypassedGates: input.bypassedGates ?? [],
    },
  });
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
      .filter((row) => row.shockerId && (!row.shockerName || !row.hubClientId || !row.hubName))
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

function publicLogPerson(
  user:
    | {
        id: string;
        username: string | null;
        globalName: string | null;
        avatar: string | null;
      }
    | undefined,
  fallbackId: string,
) {
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
export async function listPublicCommandLogs(limit = 200, viewer?: LogViewer | null) {
  const take = Math.max(1, Math.min(250, limit));
  const rows = await prisma.commandLog.findMany({
    where: {
      success: true,
      targetDiscordUserId: { not: null },
      OR: [{ executorDiscordUserId: { not: null } }, { executorLabel: { not: null } }],
    },
    orderBy: { createdAt: 'desc' },
    // Over-fetch: dual writes are deduped and privacy rules may hide rows.
    take: take * 4,
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
      warningLevel: true,
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
      adminBypass: true,
      bypassedGates: true,
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
    .slice(0, take * 2);

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
        select: { id: true, username: true, globalName: true, avatar: true, ...LOG_PRIVACY_SELECT },
      })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  const prefsById = new Map(users.map((u) => [u.id, logPrivacyFromColumns(u)]));

  const shaped = deduped.map((row) => {
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
      warningLevel: storedWarningLevel(row.warningLevel),
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
      adminBypass: row.adminBypass,
      bypassedGates: row.bypassedGates,
    } satisfies PublicLogRow;
  });

  const out: PublicLogRow[] = [];
  for (let i = 0; i < shaped.length && out.length < take; i++) {
    const row = shaped[i]!;
    const raw = deduped[i]!;
    if (!viewer) {
      out.push(row);
      continue;
    }
    const visible = applyLogPrivacy(
      row,
      { guildId: raw.guildId, channelId: raw.channelId },
      prefsById.get(raw.targetDiscordUserId!) ?? DEFAULT_LOG_PRIVACY,
      raw.executorDiscordUserId ? (prefsById.get(raw.executorDiscordUserId) ?? null) : null,
      viewer,
    );
    if (visible) out.push(visible);
  }
  return out;
}
