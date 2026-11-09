import type { FastifyPluginAsync } from 'fastify';
import type { AppEnv } from '../env.js';
import { getHubs } from '../pishock/client.js';
import {
  clearPendingConfirm,
  getPendingConfirm,
  setPendingConfirm,
  takePendingConfirm,
} from '../pishock/pending-confirm.js';
import { awaitRelayLogin, getPendingLogin, startRelayLogin } from '../pishock/relay.js';
import { clearPiShockSession, savePiShockSession } from '../session.js';

export const pishockSessionRoutes: FastifyPluginAsync<{ env: AppEnv }> = async (app, opts) => {
  app.post('/api/pishock/login/start', async (req, reply) => {
    if (!req.hasConsent) {
      return reply.code(403).send({ error: 'Consent required' });
    }
    try {
      clearPendingConfirm(req.discordUser.id);
      const { loginUrl, channel } = await startRelayLogin(req.discordUser.id);

      // Wait for relay credentials in the background, but do NOT save until the user confirms.
      void (async () => {
        try {
          const creds = await awaitRelayLogin(req.discordUser.id);
          const hubNames = await softHubNames({ userId: creds.UserId, token: creds.Token });
          setPendingConfirm(req.discordUser.id, creds, hubNames);
        } catch {
          // Status endpoint / poll will surface failure
        }
      })();

      return { loginUrl, channel };
    } catch (err) {
      return reply.code(502).send({
        error: err instanceof Error ? err.message : 'Failed to start PiShock login',
      });
    }
  });

  app.get('/api/pishock/login/status', async (req) => {
    const confirm = getPendingConfirm(req.discordUser.id);
    if (confirm) {
      return {
        status: 'confirm' as const,
        pishockUserId: confirm.userId,
        hubNames: confirm.hubNames,
        discordUser: {
          id: req.discordUser.id,
          username: req.discordUser.username,
          global_name: req.discordUser.global_name ?? null,
        },
      };
    }

    const pending = getPendingLogin(req.discordUser.id);
    if (req.pishockCreds && (!pending || pending.settled)) {
      return { status: 'linked' as const, pishockUserId: req.pishockCreds.userId };
    }
    if (!pending) {
      return { status: 'idle' as const };
    }
    if (pending.settled) {
      try {
        const creds = await pending.promise;
        const hubNames = await softHubNames({ userId: creds.UserId, token: creds.Token });
        setPendingConfirm(req.discordUser.id, creds, hubNames);
        return {
          status: 'confirm' as const,
          pishockUserId: creds.UserId,
          hubNames,
          discordUser: {
            id: req.discordUser.id,
            username: req.discordUser.username,
            global_name: req.discordUser.global_name ?? null,
          },
        };
      } catch (err) {
        return {
          status: 'error' as const,
          error: err instanceof Error ? err.message : 'Login failed',
        };
      }
    }
    return { status: 'waiting' as const, loginUrl: pending.loginUrl };
  });

  app.post('/api/pishock/login/confirm', async (req, reply) => {
    if (!req.hasConsent) {
      return reply.code(403).send({ error: 'Consent required' });
    }
    const pending = takePendingConfirm(req.discordUser.id);
    if (!pending) {
      return reply.code(404).send({
        error: 'No PiShock login waiting for confirmation',
        code: 'NO_PENDING_CONFIRM',
      });
    }
    await savePiShockSession(opts.env, req.discordUser.id, pending.userId, pending.token);
    return {
      ok: true,
      pishockUserId: pending.userId,
      hubNames: pending.hubNames,
    };
  });

  app.post('/api/pishock/login/cancel', async (req) => {
    clearPendingConfirm(req.discordUser.id);
    return { ok: true };
  });

  app.delete('/api/pishock/session', async (req) => {
    clearPendingConfirm(req.discordUser.id);
    await clearPiShockSession(req.discordUser.id);
    return { ok: true };
  });
};

async function softHubNames(creds: { userId: number; token: string }): Promise<string[]> {
  try {
    const result = await getHubs(creds);
    const rows = Array.isArray(result.data) ? result.data : [];
    return rows
      .map((row) => {
        const r = row as Record<string, unknown>;
        return String(r.Name ?? r.name ?? '').trim();
      })
      .filter(Boolean)
      .slice(0, 5);
  } catch {
    return [];
  }
}
