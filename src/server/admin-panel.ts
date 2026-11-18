/**
 * Admin panel data. Admins can look into people's profiles, but never at sensitive data:
 * no PiShock account name / id, keys, share codes, device names, limits, who someone
 * shocked or was shocked by, or session recaps — only counts and on/off flags.
 * Every profile view is written to the admin audit log.
 */
import { prisma } from './db.js';
import { isBanActive } from './services/global-bans.js';

const DAY_MS = 24 * 60 * 60_000;
const STATS_WINDOW_DAYS = 30;

/** Fields an admin profile may contain. Anything else is dropped by toAdminProfile. */
export type AdminProfile = {
  id: string;
  username: string | null;
  globalName: string | null;
  avatar: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  online: boolean;
  isAdmin: boolean;
  consented: boolean;
  pishockLinked: boolean;
  shares: { total: number; enabled: number; paused: number };
  features: Record<
    | 'commandQueue'
    | 'favoritesOnly'
    | 'approveEach'
    | 'budget'
    | 'checkIns'
    | 'perPersonLimits'
    | 'roulette'
    | 'recapDms'
    | 'adminLimitConsent',
    boolean
  >;
  emergencyStopEngaged: boolean;
  stats: {
    windowDays: number;
    sent: Record<string, number>;
    received: Record<string, number>;
    adminBypassesReceived: number;
  };
  blockedByCount: number;
  blocksSetCount: number;
  deletionPending: boolean;
  bans: Array<{
    id: string;
    reason: string;
    createdAt: string;
    expiresAt: string | null;
    active: boolean;
    bannedBy: string;
    liftedAt: string | null;
    liftedBy: string | null;
    liftReason: string | null;
  }>;
};

type UserRow = {
  id: string;
  username: string | null;
  globalName: string | null;
  avatar: string | null;
  consentAt: Date | null;
  createdAt: Date;
  lastSeenAt: Date | null;
  emergencyStopShockerIds: number[];
  commandQueueEnabled: boolean;
  favoritesOnly: boolean;
  approveEachCommand: boolean;
  budgetEnabled: boolean;
  checkInEnabled: boolean;
  perPersonLimitsEnabled: boolean;
  rouletteAllowed: boolean;
  recapDmEnabled: boolean;
  adminLimitOverrideConsentAt: Date | null;
};

type BanRow = {
  id: string;
  reason: string;
  createdAt: Date;
  expiresAt: Date | null;
  liftedAt: Date | null;
  bannedByDiscordUserId: string;
  liftedByDiscordUserId: string | null;
  liftReason: string | null;
};

export type AdminProfileInput = {
  id: string;
  user: UserRow | null;
  online: boolean;
  isAdmin: boolean;
  pishockLinked: boolean;
  shares: Array<{ enabled: boolean; paused: boolean }>;
  sent: Array<{ action: string; count: number }>;
  received: Array<{ action: string; count: number }>;
  adminBypassesReceived: number;
  blockedByCount: number;
  blocksSetCount: number;
  deletionPending: boolean;
  bans: BanRow[];
  now?: number;
};

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const tally = (rows: Array<{ action: string; count: number }>) =>
  Object.fromEntries(rows.map((r) => [r.action, r.count]));

/** Pure: builds the admin view from explicit picks only (see the test for the deny list). */
export function toAdminProfile(input: AdminProfileInput): AdminProfile {
  const u = input.user;
  const now = input.now ?? Date.now();
  return {
    id: input.id,
    username: u?.username ?? null,
    globalName: u?.globalName ?? null,
    avatar: u?.avatar ?? null,
    firstSeenAt: iso(u?.createdAt),
    lastSeenAt: iso(u?.lastSeenAt),
    online: input.online,
    isAdmin: input.isAdmin,
    consented: Boolean(u?.consentAt),
    pishockLinked: input.pishockLinked,
    shares: {
      total: input.shares.length,
      enabled: input.shares.filter((s) => s.enabled).length,
      paused: input.shares.filter((s) => s.paused).length,
    },
    features: {
      commandQueue: Boolean(u?.commandQueueEnabled),
      favoritesOnly: Boolean(u?.favoritesOnly),
      approveEach: Boolean(u?.approveEachCommand),
      budget: Boolean(u?.budgetEnabled),
      checkIns: Boolean(u?.checkInEnabled),
      perPersonLimits: Boolean(u?.perPersonLimitsEnabled),
      roulette: Boolean(u?.rouletteAllowed),
      recapDms: Boolean(u?.recapDmEnabled),
      adminLimitConsent: Boolean(u?.adminLimitOverrideConsentAt),
    },
    emergencyStopEngaged: (u?.emergencyStopShockerIds.length ?? 0) > 0,
    stats: {
      windowDays: STATS_WINDOW_DAYS,
      sent: tally(input.sent),
      received: tally(input.received),
      adminBypassesReceived: input.adminBypassesReceived,
    },
    blockedByCount: input.blockedByCount,
    blocksSetCount: input.blocksSetCount,
    deletionPending: input.deletionPending,
    bans: input.bans.map((b) => ({
      id: b.id,
      reason: b.reason,
      createdAt: b.createdAt.toISOString(),
      expiresAt: iso(b.expiresAt),
      active: isBanActive(b, now),
      bannedBy: b.bannedByDiscordUserId,
      liftedAt: iso(b.liftedAt),
      liftedBy: b.liftedByDiscordUserId,
      liftReason: b.liftReason,
    })),
  };
}

const USER_SELECT = {
  id: true,
  username: true,
  globalName: true,
  avatar: true,
  consentAt: true,
  createdAt: true,
  lastSeenAt: true,
  emergencyStopShockerIds: true,
  commandQueueEnabled: true,
  favoritesOnly: true,
  approveEachCommand: true,
  budgetEnabled: true,
  checkInEnabled: true,
  perPersonLimitsEnabled: true,
  rouletteAllowed: true,
  recapDmEnabled: true,
  adminLimitOverrideConsentAt: true,
} as const;

async function actionCounts(where: Record<string, unknown>) {
  const rows = await prisma.commandLog.groupBy({
    by: ['action'],
    where: where as never,
    _count: { _all: true },
  });
  return rows.map((r) => ({ action: r.action, count: r._count._all }));
}

export async function loadAdminProfile(
  id: string,
  ctx: { online: boolean; isAdmin: boolean },
): Promise<AdminProfile> {
  const since = new Date(Date.now() - STATS_WINDOW_DAYS * DAY_MS);
  // Each command is logged once per party; count from this user's own copy.
  const [user, pishock, shares, sent, received, bypasses, blockedBy, blocksSet, deletion, bans] =
    await Promise.all([
      prisma.discordUser.findUnique({ where: { id }, select: USER_SELECT }),
      prisma.piShockSession.count({ where: { discordUserId: id } }),
      prisma.activityShare.findMany({ where: { discordUserId: id }, select: { enabled: true, paused: true } }),
      actionCounts({ discordUserId: id, executorDiscordUserId: id, createdAt: { gte: since } }),
      actionCounts({
        discordUserId: id,
        targetDiscordUserId: id,
        NOT: { executorDiscordUserId: id },
        createdAt: { gte: since },
      }),
      prisma.commandLog.count({
        where: { discordUserId: id, targetDiscordUserId: id, adminBypass: true, createdAt: { gte: since } },
      }),
      prisma.activityBan.count({ where: { bannedDiscordUserId: id } }),
      prisma.activityBan.count({ where: { ownerDiscordUserId: id } }),
      prisma.dataDeletionRequest.count({ where: { discordUserId: id, cancelledAt: null, completedAt: null } }),
      prisma.globalBan.findMany({ where: { discordUserId: id }, orderBy: { createdAt: 'desc' } }),
    ]);
  return toAdminProfile({
    id,
    user,
    online: ctx.online,
    isAdmin: ctx.isAdmin,
    pishockLinked: pishock > 0,
    shares,
    sent,
    received,
    adminBypassesReceived: bypasses,
    blockedByCount: blockedBy,
    blocksSetCount: blocksSet,
    deletionPending: deletion > 0,
    bans,
  });
}

export type AdminUserRow = {
  id: string;
  username: string | null;
  globalName: string | null;
  avatar: string | null;
  lastSeenAt: string | null;
  banned: boolean;
};

/** Search by Discord id (prefix) or name (contains). Tombstones of erased accounts are hidden. */
export async function searchAdminUsers(query: string): Promise<AdminUserRow[]> {
  const q = query.trim().slice(0, 64);
  const where = !q
    ? { NOT: { id: { startsWith: 'anon_' } } }
    : /^\d+$/.test(q)
      ? { id: { startsWith: q } }
      : {
          NOT: { id: { startsWith: 'anon_' } },
          OR: [
            { username: { contains: q, mode: 'insensitive' as const } },
            { globalName: { contains: q, mode: 'insensitive' as const } },
          ],
        };
  const users = await prisma.discordUser.findMany({
    where,
    select: { id: true, username: true, globalName: true, avatar: true, lastSeenAt: true },
    orderBy: [{ lastSeenAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    take: 30,
  });
  const now = new Date();
  const banned = new Set(
    (
      await prisma.globalBan.findMany({
        where: {
          discordUserId: { in: users.map((u) => u.id) },
          liftedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { discordUserId: true },
      })
    ).map((b) => b.discordUserId),
  );
  return users.map((u) => ({
    id: u.id,
    username: u.username,
    globalName: u.globalName,
    avatar: u.avatar,
    lastSeenAt: iso(u.lastSeenAt),
    banned: banned.has(u.id),
  }));
}

/** App-wide numbers for the overview tab. */
export async function loadAdminOverview() {
  const now = Date.now();
  const day = new Date(now - DAY_MS);
  const week = new Date(now - 7 * DAY_MS);
  const [users, consented, linked, sharing, activeBans, commands24h, bypasses7d, estops, deletions] =
    await Promise.all([
      prisma.discordUser.count({ where: { NOT: { id: { startsWith: 'anon_' } } } }),
      prisma.discordUser.count({ where: { consentAt: { not: null } } }),
      prisma.piShockSession.count(),
      prisma.activityShare.groupBy({ by: ['discordUserId'], where: { enabled: true } }),
      prisma.globalBan.count({
        where: { liftedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(now) } }] },
      }),
      // The sender's own copy = one row per command.
      prisma.$queryRaw<Array<{ action: string; n: bigint }>>`
        SELECT "action", COUNT(*)::bigint AS n FROM "CommandLog"
        WHERE "createdAt" >= ${day} AND "discordUserId" = "executorDiscordUserId"
        GROUP BY "action"`,
      prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT COUNT(*)::bigint AS n FROM "CommandLog"
        WHERE "adminBypass" = true AND "createdAt" >= ${week} AND "discordUserId" = "executorDiscordUserId"`,
      prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT COUNT(*)::bigint AS n FROM "DiscordUser" WHERE cardinality("emergencyStopShockerIds") > 0`,
      prisma.dataDeletionRequest.count({ where: { cancelledAt: null, completedAt: null } }),
    ]);
  return {
    users,
    consented,
    pishockLinked: linked,
    sharing: sharing.length,
    activeBans,
    commands24h: Object.fromEntries(commands24h.map((r) => [r.action, Number(r.n)])),
    adminBypasses7d: Number(bypasses7d[0]?.n ?? 0),
    emergencyStopsEngaged: Number(estops[0]?.n ?? 0),
    pendingDeletions: deletions,
  };
}

export async function listAdminAudit(take = 100) {
  const rows = await prisma.adminAuditLog.findMany({ orderBy: { createdAt: 'desc' }, take });
  return rows.map((r) => ({
    id: r.id,
    adminDiscordUserId: r.adminDiscordUserId,
    action: r.action,
    targetDiscordUserId: r.targetDiscordUserId,
    detail: r.detail,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Display names for ids shown in the panel (admins, ban targets). */
export async function namesFor(ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const rows = await prisma.discordUser.findMany({
    where: { id: { in: unique } },
    select: { id: true, username: true, globalName: true },
  });
  return Object.fromEntries(rows.map((r) => [r.id, r.globalName || r.username || r.id]));
}
