import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { AppEnv } from '../env.js';
import { broadcastRealtimeAll } from '../realtime.js';
import {
  deletePersonLimit,
  getBudgetState,
  getWearerSafety,
  listPersonLimits,
  resetBudget,
  resumeShares,
  setPersonLimit,
  setWearerSafety,
} from '../session.js';
import {
  BUDGET_MAX_SHOCK_MS,
  BUDGET_MAX_SHOCKS,
} from '../wearer-safety-settings.js';
import { approvals, checkIns, takeCheckInPausedIds } from '../wearer-safety-runtime.js';

const SNOWFLAKE = /^\d{1,25}$/;

function requireConsent(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!req.hasConsent) {
    void reply.code(403).send({ error: 'Consent required', code: 'CONSENT_REQUIRED' });
    return false;
  }
  return true;
}

function invalidateParticipants(reason: string) {
  broadcastRealtimeAll({ type: 'participants_invalidate', reason, at: Date.now() });
}

/** Extra features: wearer safety settings, approvals, check-ins, budget, per-person limits. */
export const safetyRoutes: FastifyPluginAsync<{ env: AppEnv }> = async (app) => {
  async function snapshot(ownerId: string) {
    const settings = await getWearerSafety(ownerId);
    return {
      ok: true,
      settings,
      budget: await getBudgetState(ownerId, settings),
      pendingApprovals: approvals.listFor(ownerId),
      checkInDeadline: checkIns.pendingDeadline(ownerId),
    };
  }

  app.get('/api/safety/settings', async (req, reply) => {
    if (!requireConsent(req, reply)) return;
    return snapshot(req.discordUser.id);
  });

  app.put('/api/safety/settings', async (req, reply) => {
    if (!requireConsent(req, reply)) return;
    if (!req.body || typeof req.body !== 'object') {
      return reply.code(400).send({ error: 'Expected a JSON object of safety settings' });
    }
    const ownerId = req.discordUser.id;
    const before = await getWearerSafety(ownerId);
    const settings = await setWearerSafety(ownerId, req.body);
    if (before.approveEachCommand && !settings.approveEachCommand) {
      // Turning approve-each off closes open prompts (never auto-accepts); senders can resend.
      approvals.cancelAllFor(ownerId, 'canceled');
    }
    if (!before.budgetEnabled && settings.budgetEnabled) await resetBudget(ownerId);
    await checkIns.refresh(ownerId);
    invalidateParticipants('safety');
    return snapshot(ownerId);
  });

  app.post('/api/safety/approvals/:approvalId', async (req, reply) => {
    if (!requireConsent(req, reply)) return;
    const { approvalId } = req.params as { approvalId: string };
    const body = (req.body ?? {}) as { accept?: unknown };
    if (typeof body.accept !== 'boolean') {
      return reply.code(400).send({ error: 'accept must be true or false' });
    }
    if (!approvals.resolve(req.discordUser.id, String(approvalId), body.accept)) {
      return reply.code(404).send({ error: 'This request is no longer waiting', code: 'APPROVAL_GONE' });
    }
    return { ok: true };
  });

  app.post('/api/safety/checkin', async (req, reply) => {
    if (!requireConsent(req, reply)) return;
    const wasPending = await checkIns.ack(req.discordUser.id);
    return { ok: true, wasPending, checkInDeadline: checkIns.pendingDeadline(req.discordUser.id) };
  });

  /** Undo a missed-check-in pause (only the shares that pause touched). */
  app.post('/api/safety/resume', async (req, reply) => {
    if (!requireConsent(req, reply)) return;
    const ownerId = req.discordUser.id;
    const ids = takeCheckInPausedIds(ownerId);
    const resumed = await resumeShares(ownerId, ids);
    await checkIns.refresh(ownerId);
    broadcastRealtimeAll({
      type: 'activity_share_changed',
      ownerDiscordUserId: ownerId,
      reason: 'availability',
      at: Date.now(),
    });
    return { ok: true, resumed };
  });

  app.post('/api/safety/budget/reset', async (req, reply) => {
    if (!requireConsent(req, reply)) return;
    const budget = await resetBudget(req.discordUser.id);
    invalidateParticipants('budget');
    return { ok: true, budget };
  });

  /** Raise the current caps by a few (PIP "+5 shocks" / "+30s"). */
  app.post('/api/safety/budget/raise', async (req, reply) => {
    if (!requireConsent(req, reply)) return;
    const body = (req.body ?? {}) as { shocks?: unknown; shockMs?: unknown };
    const addShocks = Math.max(0, Math.floor(Number(body.shocks) || 0));
    const addMs = Math.max(0, Math.floor(Number(body.shockMs) || 0));
    if (!addShocks && !addMs) return reply.code(400).send({ error: 'Nothing to add' });
    const current = await getWearerSafety(req.discordUser.id);
    const patch: Record<string, number> = {};
    if (addShocks && current.budgetMaxShocks != null) {
      patch.budgetMaxShocks = Math.min(BUDGET_MAX_SHOCKS, current.budgetMaxShocks + addShocks);
    }
    if (addMs && current.budgetMaxShockMs != null) {
      patch.budgetMaxShockMs = Math.min(BUDGET_MAX_SHOCK_MS, current.budgetMaxShockMs + addMs);
    }
    await setWearerSafety(req.discordUser.id, patch);
    invalidateParticipants('budget');
    return snapshot(req.discordUser.id);
  });

  app.get('/api/safety/person-limits', async (req, reply) => {
    if (!requireConsent(req, reply)) return;
    return { ok: true, limits: await listPersonLimits(req.discordUser.id) };
  });

  app.put('/api/safety/person-limits/:discordUserId', async (req, reply) => {
    if (!requireConsent(req, reply)) return;
    const { discordUserId } = req.params as { discordUserId: string };
    if (!SNOWFLAKE.test(discordUserId)) return reply.code(400).send({ error: 'Invalid user id' });
    if (discordUserId === req.discordUser.id) {
      return reply.code(400).send({ error: 'You cannot set limits for yourself' });
    }
    if (!req.body || typeof req.body !== 'object') {
      return reply.code(400).send({ error: 'Expected a JSON object of limits' });
    }
    const limit = await setPersonLimit(req.discordUser.id, discordUserId, req.body);
    invalidateParticipants('person_limits');
    return { ok: true, limit };
  });

  app.delete('/api/safety/person-limits/:discordUserId', async (req, reply) => {
    if (!requireConsent(req, reply)) return;
    const { discordUserId } = req.params as { discordUserId: string };
    if (!SNOWFLAKE.test(discordUserId)) return reply.code(400).send({ error: 'Invalid user id' });
    await deletePersonLimit(req.discordUser.id, discordUserId);
    invalidateParticipants('person_limits');
    return { ok: true };
  });
};
