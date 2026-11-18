/**
 * Data rights (GDPR / Dutch AVG): one place that knows every table holding personal
 * data, so view / export / delete / anonymise / retention stay complete.
 *
 * A unit test parses prisma/schema.prisma and fails when a model that references a
 * Discord user is missing from USER_DATA_MODELS — new tables must be registered here.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';

/** Every model that stores data about a Discord user, and how it is handled. */
export const USER_DATA_MODELS = {
  DiscordUser: 'profile, settings and consents — wiped on delete / anonymise',
  PiShockSession: 'linked PiShock account (encrypted key) — revoked immediately on request',
  ActivityShare: 'your shared shockers and their limits — deleted',
  ActivityBan: 'people you blocked (deleted); blocks others set on you are kept as their safety data',
  ActivityQueueStar: 'your favorites (deleted); others favoriting you is removed',
  ActivityPersonLimit: 'limits you set (deleted); limits others set for you are kept as their safety data',
  CommandLog: 'your log copies (deleted or anonymised); you are replaced by "Deleted user" in others’ logs',
  DataDeletionRequest: 'the request itself; your id is cleared once it has run',
  ActivitySession: 'your sessions and their recaps — deleted (follows your log retention)',
  GlobalBan: 'app bans on your account and their reasons — kept after deletion so a ban cannot be undone by deleting (legitimate interest); included in your export',
  AdminAuditLog: 'admin actions concerning you (profile views, bans) — profile views are unlinked on deletion, ban records are kept with the ban',
  AppSetting: 'app-wide settings; only stores which admin last changed one',
} as const;

export type UserDataModel = keyof typeof USER_DATA_MODELS;

export const DELETION_GRACE_MS = 7 * 24 * 60 * 60_000;
export const DELETED_USER_LABEL = 'Deleted user';
export const RETENTION_CHOICES = [30, 90, 180, 365, null] as const;

/** Columns never included in an export (secrets), only mentioned as present. */
const SECRET_COLUMNS = new Set(['encryptedToken', 'tokenIv', 'tokenAuthTag', 'apiKeyHash']);

export function stripSecrets<T extends Record<string, unknown>>(row: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!SECRET_COLUMNS.has(k)) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

export function normalizeRetentionDays(raw: unknown): number | null | undefined {
  if (raw === null) return null;
  const n = Math.floor(Number(raw));
  return (RETENTION_CHOICES as readonly (number | null)[]).includes(n) ? n : undefined;
}

/** Everything we hold about one user, ready to download (JSON). */
export async function buildUserExport(discordUserId: string) {
  const [user, pishock, shares, blocksByYou, blocksOfYou, favByYou, favOfYou, limitsByYou, limitsForYou, logs, requests] =
    await Promise.all([
      prisma.discordUser.findUnique({ where: { id: discordUserId } }),
      prisma.piShockSession.findUnique({ where: { discordUserId } }),
      prisma.activityShare.findMany({ where: { discordUserId } }),
      prisma.activityBan.findMany({
        where: { ownerDiscordUserId: discordUserId },
        select: { bannedDiscordUserId: true, createdAt: true },
      }),
      prisma.activityBan.count({ where: { bannedDiscordUserId: discordUserId } }),
      prisma.activityQueueStar.findMany({
        where: { ownerDiscordUserId: discordUserId },
        select: { starredDiscordUserId: true, createdAt: true },
      }),
      prisma.activityQueueStar.count({ where: { starredDiscordUserId: discordUserId } }),
      prisma.activityPersonLimit.findMany({ where: { ownerDiscordUserId: discordUserId } }),
      prisma.activityPersonLimit.count({ where: { controllerDiscordUserId: discordUserId } }),
      prisma.commandLog.findMany({ where: { discordUserId }, orderBy: { createdAt: 'desc' } }),
      prisma.dataDeletionRequest.findMany({ where: { discordUserId } }),
    ]);
  const sessions = await prisma.activitySession.findMany({
    where: { discordUserId },
    orderBy: { startedAt: 'desc' },
  });
  const appBans = await prisma.globalBan.findMany({
    where: { discordUserId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, reason: true, createdAt: true, expiresAt: true, liftedAt: true, liftReason: true },
  });
  // Which admin did it is their accountability data; you see what happened and when.
  const adminActions = await prisma.adminAuditLog.findMany({
    where: { targetDiscordUserId: discordUserId },
    orderBy: { createdAt: 'desc' },
    select: { action: true, createdAt: true },
  });
  return {
    sessions,
    format: 'pishock-activity-export/1',
    exportedAt: new Date().toISOString(),
    note:
      'Everything this activity stores about you. Secrets (your encrypted PiShock key) are never exported; their presence is listed. ' +
      'Data other people set about you (blocks, favorites, limits) is shown as counts only.',
    user: user ? stripSecrets(user as unknown as Record<string, unknown>) : null,
    pishock: pishock
      ? {
          ...stripSecrets(pishock as unknown as Record<string, unknown>),
          encryptedApiKeyStored: true,
        }
      : null,
    shares,
    blocks: { byYou: blocksByYou, othersBlockingYou: blocksOfYou },
    favorites: { byYou: favByYou, othersFavoritingYou: favOfYou },
    personLimits: { setByYou: limitsByYou, othersLimitingYou: limitsForYou },
    commandLogs: logs,
    deletionRequests: requests,
    appBans,
    adminActionsAboutYou: adminActions,
  };
}

/** Counts + key values for the in-app "My data" view. */
export async function buildUserDataSummary(discordUserId: string) {
  const [user, pishock, shares, blocks, favorites, limits, logsOwned, logsAbout, logsBy, oldest, request] =
    await Promise.all([
      prisma.discordUser.findUnique({
        where: { id: discordUserId },
        select: {
          id: true,
          username: true,
          globalName: true,
          consentAt: true,
          createdAt: true,
          lastSeenAt: true,
          logRetentionDays: true,
          adminLimitOverrideConsentAt: true,
        },
      }),
      prisma.piShockSession.findUnique({
        where: { discordUserId },
        select: { pishockUsername: true, pishockUserId: true, createdAt: true },
      }),
      prisma.activityShare.count({ where: { discordUserId } }),
      prisma.activityBan.count({ where: { ownerDiscordUserId: discordUserId } }),
      prisma.activityQueueStar.count({ where: { ownerDiscordUserId: discordUserId } }),
      prisma.activityPersonLimit.count({ where: { ownerDiscordUserId: discordUserId } }),
      prisma.commandLog.count({ where: { discordUserId } }),
      prisma.commandLog.count({ where: { discordUserId, targetDiscordUserId: discordUserId } }),
      prisma.commandLog.count({ where: { discordUserId, executorDiscordUserId: discordUserId } }),
      prisma.commandLog.findFirst({
        where: { discordUserId },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      pendingDeletion(discordUserId),
    ]);
  return {
    profile: user,
    pishock: pishock ? { ...pishock, apiKey: 'stored, encrypted' } : null,
    counts: { shares, blocks, favorites, personLimits: limits, logsOwned, logsAboutYou: logsAbout, logsByYou: logsBy },
    oldestLogAt: oldest?.createdAt ?? null,
    retentionDays: user?.logRetentionDays ?? null,
    deletion: request,
  };
}

export async function pendingDeletion(discordUserId: string) {
  return prisma.dataDeletionRequest.findFirst({
    where: { discordUserId, cancelledAt: null, completedAt: null },
    select: { id: true, mode: true, requestedAt: true, executeAfter: true },
  });
}

export async function requestDeletion(discordUserId: string, mode: 'delete' | 'anonymise') {
  const existing = await pendingDeletion(discordUserId);
  if (existing) return existing;
  return prisma.dataDeletionRequest.create({
    data: { discordUserId, mode, executeAfter: new Date(Date.now() + DELETION_GRACE_MS) },
    select: { id: true, mode: true, requestedAt: true, executeAfter: true },
  });
}

export async function cancelDeletion(discordUserId: string): Promise<boolean> {
  const res = await prisma.dataDeletionRequest.updateMany({
    where: { discordUserId, cancelledAt: null, completedAt: null },
    data: { cancelledAt: new Date() },
  });
  return res.count > 0;
}

/**
 * Remove a user. `anonymise` keeps their log copies under an unlinkable tombstone id;
 * `delete` removes them. Either way the person is replaced by "Deleted user" in other
 * people's logs, and safety data others set about them (blocks, limits) survives on a
 * bare id-only row so a returning account is still blocked / limited.
 */
export async function eraseUser(discordUserId: string, mode: 'delete' | 'anonymise'): Promise<void> {
  const keptBans = await prisma.activityBan.findMany({
    where: { bannedDiscordUserId: discordUserId },
    select: { ownerDiscordUserId: true, createdAt: true },
  });
  const keptLimits = await prisma.activityPersonLimit.findMany({
    where: { controllerDiscordUserId: discordUserId },
  });

  await prisma.$transaction(async (tx) => {
    if (mode === 'anonymise') {
      const tombstone = `anon_${randomUUID()}`;
      await tx.discordUser.create({ data: { id: tombstone, logRetentionDays: 365 } });
      await tx.commandLog.updateMany({ where: { discordUserId }, data: { discordUserId: tombstone } });
      await tx.commandLog.updateMany({
        where: { executorDiscordUserId: discordUserId },
        data: { executorDiscordUserId: tombstone, executorLabel: DELETED_USER_LABEL },
      });
      await tx.commandLog.updateMany({
        where: { targetDiscordUserId: discordUserId },
        data: { targetDiscordUserId: tombstone },
      });
    } else {
      await tx.commandLog.deleteMany({ where: { discordUserId } });
      await tx.commandLog.updateMany({
        where: { executorDiscordUserId: discordUserId },
        data: { executorDiscordUserId: null, executorLabel: DELETED_USER_LABEL },
      });
      await tx.commandLog.updateMany({
        where: { targetDiscordUserId: discordUserId },
        data: { targetDiscordUserId: null },
      });
    }
    // Admin profile views are unlinked; ban / unban records stay with the GlobalBan.
    await tx.adminAuditLog.updateMany({
      where: { targetDiscordUserId: discordUserId, action: 'view_profile' },
      data: { targetDiscordUserId: null },
    });
    // Cascades: PiShockSession, shares, own bans / stars / limits, others' stars of them.
    await tx.discordUser.deleteMany({ where: { id: discordUserId } });

    if (keptBans.length || keptLimits.length) {
      await tx.discordUser.create({ data: { id: discordUserId } });
      for (const ban of keptBans) {
        await tx.activityBan.create({
          data: {
            ownerDiscordUserId: ban.ownerDiscordUserId,
            bannedDiscordUserId: discordUserId,
            createdAt: ban.createdAt,
          },
        });
      }
      for (const limit of keptLimits) {
        const { id: _id, ...rest } = limit;
        await tx.activityPersonLimit.create({ data: rest });
      }
    }
    await tx.dataDeletionRequest.updateMany({
      where: { discordUserId, completedAt: null, cancelledAt: null },
      data: { completedAt: new Date(), discordUserId: null },
    });
  });
}

/** Run deletion requests whose grace period has passed. */
export async function runDueDeletions(
  onErase?: (discordUserId: string, mode: 'delete' | 'anonymise') => Promise<void>,
): Promise<number> {
  const due = await prisma.dataDeletionRequest.findMany({
    where: { executeAfter: { lte: new Date() }, cancelledAt: null, completedAt: null },
    select: { discordUserId: true, mode: true },
  });
  let n = 0;
  for (const req of due) {
    if (!req.discordUserId) continue;
    const mode = req.mode === 'anonymise' ? 'anonymise' : 'delete';
    await onErase?.(req.discordUserId, mode);
    await eraseUser(req.discordUserId, mode);
    n += 1;
  }
  return n;
}

/** Delete log copies (and session recaps) older than each owner's retention setting. */
export async function applyLogRetention(): Promise<number> {
  await prisma.$executeRaw`
    DELETE FROM "ActivitySession" s
    USING "DiscordUser" u
    WHERE s."discordUserId" = u."id"
      AND u."logRetentionDays" IS NOT NULL
      AND s."startedAt" < NOW() - (u."logRetentionDays" * INTERVAL '1 day')`;
  return prisma.$executeRaw`
    DELETE FROM "CommandLog" c
    USING "DiscordUser" u
    WHERE c."discordUserId" = u."id"
      AND u."logRetentionDays" IS NOT NULL
      AND c."createdAt" < NOW() - (u."logRetentionDays" * INTERVAL '1 day')`;
}
