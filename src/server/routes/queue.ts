import type { FastifyPluginAsync } from 'fastify';
import type { AppEnv } from '../env.js';
import { broadcastRealtime } from '../realtime.js';
import { commandQueue } from '../pishock/command-queue-runtime.js';
import { CommandQueueError } from '../pishock/command-queue.js';
import {
  getCommandQueueSettings,
  listQueueStars,
  setCommandQueueSettings,
  setQueueStar,
  type CommandQueueSettings,
} from '../session.js';

function requireConsent(
  req: { hasConsent?: boolean },
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
) {
  if (!req.hasConsent) {
    return reply.code(403).send({ error: 'Consent required', code: 'CONSENT_REQUIRED' });
  }
  return null;
}

async function broadcastOwnerQueueState(
  ownerDiscordUserId: string,
  settings: CommandQueueSettings,
) {
  const state = await commandQueue.snapshot(ownerDiscordUserId);
  broadcastRealtime(
    {
      type: 'queue_state',
      ownerDiscordUserId,
      enabled: settings.enabled,
      progressMs: settings.progressMs,
      maxPerSender: settings.maxPerSender,
      starOnly: settings.starOnly,
      paused: state.paused,
      active: state.active,
      waiting: state.waiting,
      at: Date.now(),
    },
    { discordUserId: ownerDiscordUserId },
  );
  return state;
}

export const queueRoutes: FastifyPluginAsync<{ env: AppEnv }> = async (app) => {
  app.get('/api/queue', async (req, reply) => {
    const blocked = requireConsent(req, reply);
    if (blocked) return blocked;

    const [settings, state, stars] = await Promise.all([
      getCommandQueueSettings(req.discordUser.id),
      commandQueue.snapshot(req.discordUser.id),
      listQueueStars(req.discordUser.id),
    ]);
    return {
      ...settings,
      paused: state.paused,
      active: state.active,
      waiting: state.waiting,
      stars,
    };
  });

  app.post('/api/queue/settings', async (req, reply) => {
    const blocked = requireConsent(req, reply);
    if (blocked) return blocked;

    const body = req.body as Partial<{
      enabled: boolean;
      progressMs: number;
      maxPerSender: number;
      starOnly: boolean;
    }>;

    const before = await getCommandQueueSettings(req.discordUser.id);
    const settings = await setCommandQueueSettings(req.discordUser.id, body);

    if (before.enabled && !settings.enabled) {
      await commandQueue.clearWaiting(req.discordUser.id);
      await commandQueue.setPaused(req.discordUser.id, false);
    }

    const state = await broadcastOwnerQueueState(req.discordUser.id, settings);
    return {
      ok: true,
      ...settings,
      paused: state.paused,
      active: state.active,
      waiting: state.waiting,
    };
  });

  app.post('/api/queue/enabled', async (req, reply) => {
    const blocked = requireConsent(req, reply);
    if (blocked) return blocked;

    const body = req.body as { enabled?: boolean };
    if (typeof body.enabled !== 'boolean') {
      return reply.code(400).send({ error: 'enabled boolean required' });
    }

    const settings = await setCommandQueueSettings(req.discordUser.id, {
      enabled: body.enabled,
    });
    if (!settings.enabled) {
      await commandQueue.clearWaiting(req.discordUser.id);
      await commandQueue.setPaused(req.discordUser.id, false);
    }

    const state = await broadcastOwnerQueueState(req.discordUser.id, settings);
    return {
      ok: true,
      ...settings,
      paused: state.paused,
      active: state.active,
      waiting: state.waiting,
    };
  });

  app.post('/api/queue/progress', async (req, reply) => {
    const blocked = requireConsent(req, reply);
    if (blocked) return blocked;

    const body = req.body as { progressMs?: number };
    if (typeof body.progressMs !== 'number' || !Number.isFinite(body.progressMs)) {
      return reply.code(400).send({ error: 'progressMs number required' });
    }

    const settings = await setCommandQueueSettings(req.discordUser.id, {
      progressMs: body.progressMs,
    });
    const state = await broadcastOwnerQueueState(req.discordUser.id, settings);
    return {
      ok: true,
      ...settings,
      paused: state.paused,
      active: state.active,
      waiting: state.waiting,
    };
  });

  app.post('/api/queue/pause', async (req, reply) => {
    const blocked = requireConsent(req, reply);
    if (blocked) return blocked;

    const settings = await getCommandQueueSettings(req.discordUser.id);
    if (!settings.enabled) {
      return reply.code(409).send({ error: 'Command queue is disabled', code: 'QUEUE_DISABLED' });
    }

    const body = req.body as { paused?: boolean };
    if (typeof body.paused !== 'boolean') {
      return reply.code(400).send({ error: 'paused boolean required' });
    }

    const state = await commandQueue.setPaused(req.discordUser.id, body.paused);
    return { ok: true, ...settings, ...state };
  });

  app.post('/api/queue/skip', async (req, reply) => {
    const blocked = requireConsent(req, reply);
    if (blocked) return blocked;

    const settings = await getCommandQueueSettings(req.discordUser.id);
    if (!settings.enabled) {
      return reply.code(409).send({ error: 'Command queue is disabled', code: 'QUEUE_DISABLED' });
    }

    const state = await commandQueue.skipActive(req.discordUser.id);
    return { ok: true, ...settings, ...state };
  });

  app.post('/api/queue/clear', async (req, reply) => {
    const blocked = requireConsent(req, reply);
    if (blocked) return blocked;

    const settings = await getCommandQueueSettings(req.discordUser.id);
    if (!settings.enabled) {
      return reply.code(409).send({ error: 'Command queue is disabled', code: 'QUEUE_DISABLED' });
    }

    const state = await commandQueue.clearWaiting(req.discordUser.id);
    return { ok: true, ...settings, ...state };
  });

  app.delete('/api/queue/items/:itemId', async (req, reply) => {
    const blocked = requireConsent(req, reply);
    if (blocked) return blocked;

    const settings = await getCommandQueueSettings(req.discordUser.id);
    if (!settings.enabled) {
      return reply.code(409).send({ error: 'Command queue is disabled', code: 'QUEUE_DISABLED' });
    }

    const itemId = String((req.params as { itemId: string }).itemId);
    try {
      const state = await commandQueue.removeItem(req.discordUser.id, itemId);
      return { ok: true, ...settings, ...state };
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
    const settings = await getCommandQueueSettings(req.discordUser.id);
    if (settings.enabled) {
      await broadcastOwnerQueueState(req.discordUser.id, settings);
    }

    return { ok: true, starred, discordUserId: starredDiscordUserId };
  });
};
