import type { FastifyPluginAsync } from 'fastify';
import type { AppEnv } from '../env.js';
import { broadcastRealtime } from '../realtime.js';
import { commandQueue } from '../pishock/command-queue-runtime.js';
import { CommandQueueError } from '../pishock/command-queue.js';
import {
  getCommandQueueEnabled,
  listQueueStars,
  setCommandQueueEnabled,
  setQueueStar,
} from '../session.js';

function requireConsent(req: { hasConsent?: boolean }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
  if (!req.hasConsent) {
    return reply.code(403).send({ error: 'Consent required', code: 'CONSENT_REQUIRED' });
  }
  return null;
}

export const queueRoutes: FastifyPluginAsync<{ env: AppEnv }> = async (app) => {
  app.get('/api/queue', async (req, reply) => {
    const blocked = requireConsent(req, reply);
    if (blocked) return blocked;

    const enabled = await getCommandQueueEnabled(req.discordUser.id);
    const state = await commandQueue.snapshot(req.discordUser.id);
    const stars = await listQueueStars(req.discordUser.id);
    return {
      enabled,
      paused: state.paused,
      active: state.active,
      waiting: state.waiting,
      stars,
    };
  });

  app.post('/api/queue/enabled', async (req, reply) => {
    const blocked = requireConsent(req, reply);
    if (blocked) return blocked;

    const body = req.body as { enabled?: boolean };
    if (typeof body.enabled !== 'boolean') {
      return reply.code(400).send({ error: 'enabled boolean required' });
    }

    const enabled = await setCommandQueueEnabled(req.discordUser.id, body.enabled);
    if (!enabled) {
      // Clear waiting; let the active command finish on its own.
      await commandQueue.clearWaiting(req.discordUser.id);
      await commandQueue.setPaused(req.discordUser.id, false);
    }

    const state = await commandQueue.snapshot(req.discordUser.id);
    broadcastRealtime(
      {
        type: 'queue_state',
        ownerDiscordUserId: req.discordUser.id,
        enabled,
        paused: state.paused,
        active: state.active,
        waiting: state.waiting,
        at: Date.now(),
      },
      { discordUserId: req.discordUser.id },
    );

    return {
      ok: true,
      enabled,
      paused: state.paused,
      active: state.active,
      waiting: state.waiting,
    };
  });

  app.post('/api/queue/pause', async (req, reply) => {
    const blocked = requireConsent(req, reply);
    if (blocked) return blocked;

    if (!(await getCommandQueueEnabled(req.discordUser.id))) {
      return reply.code(409).send({ error: 'Command queue is disabled', code: 'QUEUE_DISABLED' });
    }

    const body = req.body as { paused?: boolean };
    if (typeof body.paused !== 'boolean') {
      return reply.code(400).send({ error: 'paused boolean required' });
    }

    const state = await commandQueue.setPaused(req.discordUser.id, body.paused);
    return { ok: true, enabled: true, ...state };
  });

  app.post('/api/queue/skip', async (req, reply) => {
    const blocked = requireConsent(req, reply);
    if (blocked) return blocked;

    if (!(await getCommandQueueEnabled(req.discordUser.id))) {
      return reply.code(409).send({ error: 'Command queue is disabled', code: 'QUEUE_DISABLED' });
    }

    const state = await commandQueue.skipActive(req.discordUser.id);
    return { ok: true, enabled: true, ...state };
  });

  app.post('/api/queue/clear', async (req, reply) => {
    const blocked = requireConsent(req, reply);
    if (blocked) return blocked;

    if (!(await getCommandQueueEnabled(req.discordUser.id))) {
      return reply.code(409).send({ error: 'Command queue is disabled', code: 'QUEUE_DISABLED' });
    }

    const state = await commandQueue.clearWaiting(req.discordUser.id);
    return { ok: true, enabled: true, ...state };
  });

  app.delete('/api/queue/items/:itemId', async (req, reply) => {
    const blocked = requireConsent(req, reply);
    if (blocked) return blocked;

    if (!(await getCommandQueueEnabled(req.discordUser.id))) {
      return reply.code(409).send({ error: 'Command queue is disabled', code: 'QUEUE_DISABLED' });
    }

    const itemId = String((req.params as { itemId: string }).itemId);
    try {
      const state = await commandQueue.removeItem(req.discordUser.id, itemId);
      return { ok: true, enabled: true, ...state };
    } catch (err) {
      if (err instanceof CommandQueueError) {
        return reply.code(err.status).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  });

  app.put('/api/queue/stars/:discordUserId', async (req, reply) => {
    const blocked = requireConsent(req, reply);
    if (blocked) return blocked;

    const starredDiscordUserId = String(
      (req.params as { discordUserId: string }).discordUserId,
    );
    const body = req.body as { starred?: boolean };
    if (typeof body.starred !== 'boolean') {
      return reply.code(400).send({ error: 'starred boolean required' });
    }
    if (starredDiscordUserId === req.discordUser.id) {
      return reply.code(400).send({ error: 'Cannot star yourself' });
    }

    const starred = await setQueueStar(req.discordUser.id, starredDiscordUserId, body.starred);
    // Re-broadcast queue so priority flags on waiting items refresh.
    if (await getCommandQueueEnabled(req.discordUser.id)) {
      const state = await commandQueue.snapshot(req.discordUser.id);
      broadcastRealtime(
        {
          type: 'queue_state',
          ownerDiscordUserId: req.discordUser.id,
          enabled: true,
          paused: state.paused,
          active: state.active,
          waiting: state.waiting,
          at: Date.now(),
        },
        { discordUserId: req.discordUser.id },
      );
    }

    return { ok: true, starred, discordUserId: starredDiscordUserId };
  });
};
