import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { AppEnv } from '../env.js';
import { isAdmin } from '../admin-bypass.js';
import {
  listAdminAudit,
  loadAdminOverview,
  loadAdminProfile,
  namesFor,
  searchAdminUsers,
} from '../admin-panel.js';
import {
  BAN_REASON_MAX,
  BAN_REASON_MIN,
  createGlobalBan,
  getAppNotice,
  liftGlobalBan,
  listGlobalBans,
  normalizeBanDuration,
  normalizeBanReason,
  normalizeNotice,
  pauseAllActiveShares,
  recordAdminAction,
  setAppNotice,
} from '../session.js';
import {
  broadcastRealtimeAll,
  disconnectUser,
  isUserOnline,
  realtimeStats,
} from '../realtime.js';
import { onWearerEmergencyStop } from '../wearer-safety-runtime.js';
import { commandQueue } from '../pishock/command-queue-runtime.js';
import { loadAppVersion } from '../app-version.js';

const SNOWFLAKE = /^\d{5,25}$/;
const startedAt = Date.now();

export const adminRoutes: FastifyPluginAsync<{ env: AppEnv }> = async (app, opts) => {
  const admins = opts.env.adminDiscordUserIds;

  /** Admin-only: the server re-checks the env list on every call; others get a plain 404. */
  const guard = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (isAdmin(admins, req.discordUser.id)) return true;
    void reply.code(404).send({ error: 'Not found' });
    return false;
  };

  app.get('/api/admin/overview', async (req, reply) => {
    if (!guard(req, reply)) return;
    const version = loadAppVersion();
    return {
      ...(await loadAdminOverview()),
      live: realtimeStats(),
      version: version.label,
      uptimeMs: Date.now() - startedAt,
      admins: Object.entries(await namesFor([...admins])).map(([id, name]) => ({ id, name })),
      notice: await getAppNotice(),
    };
  });

  app.get('/api/admin/users', async (req, reply) => {
    if (!guard(req, reply)) return;
    const rawQ = (req.query as { q?: unknown }).q;
    const q = typeof rawQ === 'string' ? rawQ : '';
    const users = await searchAdminUsers(q);
    return {
      users: users.map((u) => ({ ...u, online: isUserOnline(u.id), isAdmin: isAdmin(admins, u.id) })),
    };
  });

  app.get('/api/admin/users/:id', async (req, reply) => {
    if (!guard(req, reply)) return;
    const { id } = req.params as { id: string };
    if (!SNOWFLAKE.test(id)) return reply.code(400).send({ error: 'Invalid user id' });
    const profile = await loadAdminProfile(id, { online: isUserOnline(id), isAdmin: isAdmin(admins, id) });
    // Looking into someone's profile is itself recorded.
    await recordAdminAction({ adminDiscordUserId: req.discordUser.id, action: 'view_profile', targetDiscordUserId: id });
    const names = await namesFor(profile.bans.flatMap((b) => [b.bannedBy, b.liftedBy ?? '']));
    return { profile, names };
  });

  app.post('/api/admin/users/:id/ban', async (req, reply) => {
    if (!guard(req, reply)) return;
    const { id } = req.params as { id: string };
    if (!SNOWFLAKE.test(id)) return reply.code(400).send({ error: 'Invalid user id' });
    if (id === req.discordUser.id) return reply.code(400).send({ error: 'You cannot ban yourself' });
    if (isAdmin(admins, id)) {
      return reply.code(400).send({ error: 'Admins cannot be banned here — remove them from ADMIN_DISCORD_USER_IDS first' });
    }
    const body = (req.body ?? {}) as { reason?: unknown; durationDays?: unknown };
    const reason = normalizeBanReason(body.reason);
    if (!reason) {
      return reply
        .code(400)
        .send({ error: `Write a reason of ${BAN_REASON_MIN}–${BAN_REASON_MAX} characters; the user will see it` });
    }
    const durationDays = normalizeBanDuration(body.durationDays);
    if (durationDays === undefined) return reply.code(400).send({ error: 'Invalid ban length' });

    const ban = await createGlobalBan({
      discordUserId: id,
      reason,
      bannedByDiscordUserId: req.discordUser.id,
      durationDays,
    });
    await recordAdminAction({
      adminDiscordUserId: req.discordUser.id,
      action: 'ban',
      targetDiscordUserId: id,
      detail: { banId: ban.id, reason, durationDays },
    });

    // Fail safe: nobody can operate them and their pending work is dropped. Queued items
    // they sent to others are refused at execution (isExecutorBanned covers global bans).
    const paused = await pauseAllActiveShares(id).catch(() => [] as number[]);
    onWearerEmergencyStop(id);
    await commandQueue.hardClear(id).catch(() => undefined);
    disconnectUser(id, {
      type: 'global_ban',
      ban: {
        id: ban.id,
        reason: ban.reason,
        createdAt: ban.createdAt.toISOString(),
        expiresAt: ban.expiresAt ? ban.expiresAt.toISOString() : null,
      },
      at: Date.now(),
    });
    broadcastRealtimeAll({
      type: 'activity_share_changed',
      ownerDiscordUserId: id,
      reason: 'availability',
      at: Date.now(),
    });
    return { ok: true, banId: ban.id, pausedShares: paused.length };
  });

  app.post('/api/admin/users/:id/unban', async (req, reply) => {
    if (!guard(req, reply)) return;
    const { id } = req.params as { id: string };
    if (!SNOWFLAKE.test(id)) return reply.code(400).send({ error: 'Invalid user id' });
    const body = (req.body ?? {}) as { reason?: unknown };
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, BAN_REASON_MAX) : '';
    if (reason.length < 3) return reply.code(400).send({ error: 'Add a short reason for lifting the ban' });
    const lifted = await liftGlobalBan({ discordUserId: id, liftedByDiscordUserId: req.discordUser.id, reason });
    if (!lifted) return reply.code(404).send({ error: 'This user has no active ban' });
    await recordAdminAction({
      adminDiscordUserId: req.discordUser.id,
      action: 'unban',
      targetDiscordUserId: id,
      detail: { reason },
    });
    // Their shares stay paused until they turn them back on themselves.
    return { ok: true };
  });

  app.get('/api/admin/bans', async (req, reply) => {
    if (!guard(req, reply)) return;
    const all = (req.query as { all?: unknown }).all === '1';
    const rows = await listGlobalBans({ activeOnly: !all });
    const names = await namesFor(rows.flatMap((r) => [r.discordUserId, r.bannedByDiscordUserId, r.liftedByDiscordUserId ?? '']));
    const now = Date.now();
    return {
      bans: rows.map((r) => ({
        id: r.id,
        discordUserId: r.discordUserId,
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt?.toISOString() ?? null,
        liftedAt: r.liftedAt?.toISOString() ?? null,
        liftReason: r.liftReason,
        bannedBy: r.bannedByDiscordUserId,
        liftedBy: r.liftedByDiscordUserId,
        active: !r.liftedAt && (!r.expiresAt || r.expiresAt.getTime() > now),
      })),
      names,
    };
  });

  app.get('/api/admin/audit', async (req, reply) => {
    if (!guard(req, reply)) return;
    const entries = await listAdminAudit(150);
    const names = await namesFor(entries.flatMap((e) => [e.adminDiscordUserId, e.targetDiscordUserId ?? '']));
    return { entries, names };
  });

  app.put('/api/admin/notice', async (req, reply) => {
    if (!guard(req, reply)) return;
    const body = req.body as { text?: unknown } | null;
    const clearing = !body || body.text === '' || body.text === null;
    const notice = clearing ? null : normalizeNotice(body);
    if (!clearing && !notice) return reply.code(400).send({ error: 'Notice text is required (max 500 characters)' });
    const saved = await setAppNotice(notice, req.discordUser.id);
    await recordAdminAction({
      adminDiscordUserId: req.discordUser.id,
      action: saved ? 'set_notice' : 'clear_notice',
      detail: saved ? { text: saved.text, level: saved.level, expiresAt: saved.expiresAt } : null,
    });
    broadcastRealtimeAll({ type: 'app_notice', notice: saved, at: Date.now() });
    return { ok: true, notice: saved };
  });
};
