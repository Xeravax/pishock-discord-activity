import type { FastifyPluginAsync } from 'fastify';
import type { Prisma } from '@prisma/client';
import type { AppEnv } from '../env.js';
import { prisma } from '../db.js';
import { CommunityJoinError, joinCommunityGuild } from '../discord-dm.js';

const PAGE_SIZE = 50;

function parseCursor(raw: unknown): { at: Date; id: string } | null {
  if (typeof raw !== 'string' || !raw.includes('_')) return null;
  const [ms, id] = [raw.slice(0, raw.indexOf('_')), raw.slice(raw.indexOf('_') + 1)];
  const at = new Date(Number(ms));
  return Number.isFinite(at.getTime()) && id ? { at, id } : null;
}

/** Profile: full history of commands done to you, session recaps, community join. */
export const profileRoutes: FastifyPluginAsync<{ env: AppEnv }> = async (app, opts) => {
  /**
   * Every command executed on you (your own log copies — full detail, no privacy redaction).
   * Query: cursor, action (shock|vibrate|beep), sender (discord id), from, to (ISO dates).
   */
  app.get('/api/me/history', async (req) => {
    const q = req.query as { cursor?: string; action?: string; sender?: string; from?: string; to?: string };
    const me = req.discordUser.id;
    const where: Prisma.CommandLogWhereInput = { discordUserId: me, targetDiscordUserId: me };
    if (q.action === 'shock') where.OR = [{ action: { contains: 'shock' } }, { action: { contains: 'hold' } }];
    else if (q.action === 'vibrate') where.action = { contains: 'vibrate' };
    else if (q.action === 'beep') where.action = { contains: 'beep' };
    if (q.sender && /^\d{1,25}$/.test(q.sender)) where.executorDiscordUserId = q.sender;
    const createdAt: Prisma.DateTimeFilter = {};
    if (q.from && Number.isFinite(Date.parse(q.from))) createdAt.gte = new Date(q.from);
    if (q.to && Number.isFinite(Date.parse(q.to))) createdAt.lte = new Date(q.to);
    const cursor = parseCursor(q.cursor);
    const and: Prisma.CommandLogWhereInput[] = [];
    if (Object.keys(createdAt).length) and.push({ createdAt });
    if (cursor) {
      and.push({
        OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }],
      });
    }
    if (and.length) where.AND = and;

    const rows = await prisma.commandLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE_SIZE + 1,
      select: {
        id: true,
        action: true,
        shockerId: true,
        shockerName: true,
        hubName: true,
        intensity: true,
        durationMs: true,
        warningLevel: true,
        success: true,
        source: true,
        detail: true,
        locationName: true,
        createdAt: true,
        executorDiscordUserId: true,
        executorLabel: true,
        adminBypass: true,
        bypassedGates: true,
      },
    });
    const page = rows.slice(0, PAGE_SIZE);
    const ids = [...new Set(page.map((r) => r.executorDiscordUserId).filter(Boolean) as string[])];
    const people = ids.length
      ? await prisma.discordUser.findMany({
          where: { id: { in: ids } },
          select: { id: true, username: true, globalName: true, avatar: true },
        })
      : [];
    const byId = new Map(people.map((p) => [p.id, p]));
    const last = page.at(-1);
    return {
      ok: true,
      entries: page.map((r) => ({
        ...r,
        detail: undefined,
        refusedReason: !r.success ? safeReason(r.detail) : null,
        executor: r.executorDiscordUserId
          ? byId.get(r.executorDiscordUserId) ?? { id: r.executorDiscordUserId }
          : { id: null, label: r.executorLabel ?? 'Website' },
      })),
      nextCursor: rows.length > PAGE_SIZE && last ? `${last.createdAt.getTime()}_${last.id}` : null,
    };
  });

  app.get('/api/me/sessions', async (req) => {
    const sessions = await prisma.activitySession.findMany({
      where: { discordUserId: req.discordUser.id, endedAt: { not: null } },
      orderBy: { startedAt: 'desc' },
      take: 30,
    });
    const unread = sessions.filter((s) => !s.seenAt && s.dmStatus !== 'empty').length;
    const dmFailed = sessions.some((s) => s.dmStatus === 'failed' && !s.seenAt);
    return { ok: true, sessions, unread, dmFailed };
  });

  app.post('/api/me/sessions/seen', async (req) => {
    await prisma.activitySession.updateMany({
      where: { discordUserId: req.discordUser.id, seenAt: null, endedAt: { not: null } },
      data: { seenAt: new Date() },
    });
    return { ok: true };
  });

  app.get('/api/community', async () => ({
    ok: true,
    enabled: Boolean(opts.env.communityGuildId && opts.env.discordBotToken),
    inviteUrl: opts.env.communityInviteUrl,
  }));

  /** Body: { code } from a separate authorize with scope guilds.join. */
  app.post('/api/community/join', async (req, reply) => {
    const body = (req.body ?? {}) as { code?: unknown };
    if (!opts.env.communityGuildId) {
      return reply.code(404).send({ error: 'No community server configured' });
    }
    if (typeof body.code !== 'string' || !body.code) {
      return reply.code(400).send({ error: 'Missing approval code' });
    }
    try {
      const result = await joinCommunityGuild({
        clientId: opts.env.discordClientId,
        clientSecret: opts.env.discordClientSecret,
        botToken: opts.env.discordBotToken,
        guildId: opts.env.communityGuildId,
        code: body.code,
        expectedUserId: req.discordUser.id,
      });
      return { ok: true, result };
    } catch (err) {
      if (err instanceof CommunityJoinError) {
        return reply.code(err.status).send({ error: err.message, code: err.code, inviteUrl: opts.env.communityInviteUrl });
      }
      throw err;
    }
  });
};

/** Only expose the refusal code / status, never raw PiShock errors. */
function safeReason(detail: string | null): string | null {
  if (!detail) return null;
  try {
    const d = JSON.parse(detail) as { adminBypass?: string; status?: number; error?: unknown };
    if (d.adminBypass === 'refused') return `Admin bypass refused (${d.status ?? 'error'})`;
    return 'Not delivered';
  } catch {
    return 'Not delivered';
  }
}
