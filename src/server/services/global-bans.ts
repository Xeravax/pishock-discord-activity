import { prisma } from '../db.js';

/**
 * App-wide bans (admin panel). A banned user cannot use the activity at all: the auth
 * hook only lets them read their ban and use their data rights, nobody can operate their
 * shockers and they cannot operate anyone's (folded into isExecutorBanned).
 */

export type GlobalBanView = {
  id: string;
  discordUserId: string;
  reason: string;
  createdAt: string;
  /** Null = permanent. */
  expiresAt: string | null;
};

export const BAN_REASON_MIN = 10;
export const BAN_REASON_MAX = 1000;
/** Allowed ban lengths in days; null = permanent. */
export const BAN_DURATION_DAYS = [1, 7, 30, 90, 365, null] as const;

type BanRow = {
  id: string;
  discordUserId: string;
  reason: string;
  createdAt: Date;
  expiresAt: Date | null;
  liftedAt: Date | null;
};

/** A ban counts while it is not lifted and not expired. */
export function isBanActive(row: Pick<BanRow, 'liftedAt' | 'expiresAt'>, now = Date.now()): boolean {
  if (row.liftedAt) return false;
  return !row.expiresAt || row.expiresAt.getTime() > now;
}

export function toBanView(row: BanRow): GlobalBanView {
  return {
    id: row.id,
    discordUserId: row.discordUserId,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
  };
}

export function normalizeBanReason(raw: unknown): string | null {
  const reason = typeof raw === 'string' ? raw.trim().replace(/\s+\n/g, '\n') : '';
  if (reason.length < BAN_REASON_MIN || reason.length > BAN_REASON_MAX) return null;
  return reason;
}

export function normalizeBanDuration(raw: unknown): number | null | undefined {
  if (raw === null || raw === undefined || raw === 'permanent') return null;
  const n = Math.floor(Number(raw));
  return (BAN_DURATION_DAYS as readonly (number | null)[]).includes(n) ? n : undefined;
}

/**
 * Paths a globally banned user may still call: their own profile (which carries the ban),
 * and their GDPR / AVG data rights (view, export, deletion). Everything else is refused.
 */
export function isAllowedWhileBanned(method: string, path: string): boolean {
  if (method === 'GET' && path === '/api/me') return true;
  if (path === '/api/me/data' || path.startsWith('/api/me/data/')) return true;
  if (path === '/api/me/export' || path.startsWith('/api/me/export/')) return true;
  if (path === '/api/me/deletion') return true;
  return false;
}

/** Short cache: the auth hook asks on every request. Bans/unbans invalidate it here. */
const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { at: number; ban: BanRow | null }>();

export function invalidateGlobalBanCache(discordUserId?: string) {
  if (discordUserId) cache.delete(discordUserId);
  else cache.clear();
}

export async function getActiveGlobalBan(discordUserId: string): Promise<GlobalBanView | null> {
  const now = Date.now();
  const hit = cache.get(discordUserId);
  let row: BanRow | null;
  if (hit && now - hit.at < CACHE_TTL_MS) {
    row = hit.ban;
  } else {
    row = await prisma.globalBan.findFirst({
      where: {
        discordUserId,
        liftedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(now) } }],
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, discordUserId: true, reason: true, createdAt: true, expiresAt: true, liftedAt: true },
    });
    cache.set(discordUserId, { at: now, ban: row });
    if (cache.size > 5_000) cache.delete(cache.keys().next().value!);
  }
  return row && isBanActive(row, now) ? toBanView(row) : null;
}

export async function isGloballyBanned(discordUserId: string): Promise<boolean> {
  return Boolean(await getActiveGlobalBan(discordUserId));
}

export async function createGlobalBan(input: {
  discordUserId: string;
  reason: string;
  bannedByDiscordUserId: string;
  durationDays: number | null;
}) {
  const row = await prisma.$transaction(async (tx) => {
    // One active ban at a time: a new ban replaces the old one (kept as history).
    await tx.globalBan.updateMany({
      where: { discordUserId: input.discordUserId, liftedAt: null },
      data: {
        liftedAt: new Date(),
        liftedByDiscordUserId: input.bannedByDiscordUserId,
        liftReason: 'Replaced by a new ban',
      },
    });
    return tx.globalBan.create({
      data: {
        discordUserId: input.discordUserId,
        reason: input.reason,
        bannedByDiscordUserId: input.bannedByDiscordUserId,
        expiresAt:
          input.durationDays == null ? null : new Date(Date.now() + input.durationDays * 24 * 60 * 60_000),
      },
    });
  });
  invalidateGlobalBanCache(input.discordUserId);
  return row;
}

export async function liftGlobalBan(input: {
  discordUserId: string;
  liftedByDiscordUserId: string;
  reason: string;
}): Promise<number> {
  const res = await prisma.globalBan.updateMany({
    where: { discordUserId: input.discordUserId, liftedAt: null },
    data: {
      liftedAt: new Date(),
      liftedByDiscordUserId: input.liftedByDiscordUserId,
      liftReason: input.reason,
    },
  });
  invalidateGlobalBanCache(input.discordUserId);
  return res.count;
}

export async function listGlobalBans(opts: { activeOnly: boolean; take?: number }) {
  const now = new Date();
  return prisma.globalBan.findMany({
    where: opts.activeOnly
      ? { liftedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }
      : undefined,
    orderBy: { createdAt: 'desc' },
    take: opts.take ?? 100,
  });
}

export async function globalBanHistory(discordUserId: string) {
  return prisma.globalBan.findMany({ where: { discordUserId }, orderBy: { createdAt: 'desc' } });
}

export async function recordAdminAction(input: {
  adminDiscordUserId: string;
  action: 'view_profile' | 'ban' | 'unban' | 'set_notice' | 'clear_notice';
  targetDiscordUserId?: string | null;
  detail?: Record<string, unknown> | null;
}) {
  await prisma.adminAuditLog.create({
    data: {
      adminDiscordUserId: input.adminDiscordUserId,
      action: input.action,
      targetDiscordUserId: input.targetDiscordUserId ?? null,
      detail: (input.detail ?? undefined) as never,
    },
  });
}
