import { randomBytes } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { AppEnv } from '../env.js';
import { prisma } from '../db.js';
import { broadcastRealtimeAll, broadcastToUsers } from '../realtime.js';
import { clearPiShockSession } from '../session.js';
import { clearPendingConfirm } from '../pishock/pending-confirm.js';
import { commandQueue } from '../pishock/command-queue-runtime.js';
import { approvals, checkIns } from '../wearer-safety-runtime.js';
import {
  buildUserDataSummary,
  buildUserExport,
  cancelDeletion,
  normalizeRetentionDays,
  pendingDeletion,
  requestDeletion,
} from '../data-registry.js';

const EXPORT_TTL_MS = 10 * 60_000;
const EXPORT_COOLDOWN_MS = 60 * 60_000;

/** One-time download tokens: the export opens in the user's browser, which has no bearer. */
const exportTokens = new Map<string, { discordUserId: string; expiresAt: number }>();
const lastExportAt = new Map<string, number>();

function pruneTokens(now: number) {
  for (const [token, entry] of exportTokens) if (entry.expiresAt < now) exportTokens.delete(token);
}

/** Data rights (GDPR / AVG): view, export, delete / anonymise, retention. */
export const dataRoutes: FastifyPluginAsync<{ env: AppEnv }> = async (app, opts) => {
  app.get('/api/me/data', async (req) => {
    return { ok: true, data: await buildUserDataSummary(req.discordUser.id) };
  });

  app.put('/api/me/data/retention', async (req, reply) => {
    const body = (req.body ?? {}) as { days?: unknown };
    const days = normalizeRetentionDays(body.days);
    if (days === undefined) {
      return reply.code(400).send({ error: 'Choose 30, 90, 180 or 365 days, or keep (null)' });
    }
    await prisma.discordUser.update({
      where: { id: req.discordUser.id },
      data: { logRetentionDays: days },
    });
    return { ok: true, data: await buildUserDataSummary(req.discordUser.id) };
  });

  /** Returns a single-use download link (valid 10 min). One export per hour. */
  app.post('/api/me/export', async (req, reply) => {
    const now = Date.now();
    pruneTokens(now);
    const last = lastExportAt.get(req.discordUser.id) ?? 0;
    if (now - last < EXPORT_COOLDOWN_MS) {
      return reply.code(429).send({
        error: 'You can download one export per hour',
        code: 'EXPORT_RATE_LIMIT',
        retryAfterMs: EXPORT_COOLDOWN_MS - (now - last),
      });
    }
    lastExportAt.set(req.discordUser.id, now);
    const token = randomBytes(32).toString('hex');
    exportTokens.set(token, { discordUserId: req.discordUser.id, expiresAt: now + EXPORT_TTL_MS });
    const base = opts.env.publicUrl.replace(/\/+$/, '');
    return { ok: true, url: `${base}/api/me/export/${token}`, expiresAt: now + EXPORT_TTL_MS };
  });

  /** Auth-exempt (see auth-plugin): the unguessable single-use token is the credential. */
  app.get('/api/me/export/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const entry = exportTokens.get(String(token));
    exportTokens.delete(String(token));
    if (!entry || entry.expiresAt < Date.now()) {
      return reply.code(404).type('text/plain').send('This download link has expired. Request a new export in the activity.');
    }
    const data = await buildUserExport(entry.discordUserId);
    const day = new Date().toISOString().slice(0, 10);
    return reply
      .header('Content-Disposition', `attachment; filename="pishock-activity-data-${day}.json"`)
      .header('Cache-Control', 'no-store')
      .type('application/json')
      .send(JSON.stringify(data, null, 2));
  });

  /**
   * Request deletion / anonymisation. Runs after a 7-day grace (cancellable). Takes effect
   * right away for safety: PiShock key removed, shares disabled, queue cleared.
   */
  app.post('/api/me/deletion', async (req, reply) => {
    const body = (req.body ?? {}) as { mode?: unknown };
    if (body.mode !== 'delete' && body.mode !== 'anonymise') {
      return reply.code(400).send({ error: 'mode must be "delete" or "anonymise"' });
    }
    const id = req.discordUser.id;
    const request = await requestDeletion(id, body.mode);

    clearPendingConfirm(id);
    await clearPiShockSession(id);
    await prisma.activityShare.updateMany({ where: { discordUserId: id }, data: { enabled: false } });
    await commandQueue.hardClear(id).catch(() => undefined);
    approvals.cancelAllFor(id);
    checkIns.stop(id);
    broadcastRealtimeAll({
      type: 'activity_share_changed',
      ownerDiscordUserId: id,
      reason: 'availability',
      at: Date.now(),
    });
    // Admins see requests (they may need to answer questions about them).
    broadcastToUsers(opts.env.adminDiscordUserIds, {
      type: 'participants_invalidate',
      reason: `data_deletion_requested:${body.mode}`,
      at: Date.now(),
    });
    console.info(`[data] ${body.mode} requested by ${id}; runs after ${request.executeAfter.toISOString()}`);
    return { ok: true, deletion: request };
  });

  app.delete('/api/me/deletion', async (req) => {
    const cancelled = await cancelDeletion(req.discordUser.id);
    if (cancelled) console.info(`[data] deletion cancelled by ${req.discordUser.id}`);
    return { ok: true, cancelled, deletion: await pendingDeletion(req.discordUser.id) };
  });
};
