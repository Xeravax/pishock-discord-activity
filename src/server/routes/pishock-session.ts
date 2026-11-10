import type { FastifyPluginAsync } from 'fastify';
import { PISHOCK_API_KEY_NAME } from '../../shared/constants.js';
import type { AppEnv } from '../env.js';
import { createApiKey, getAccount, validateApiKey } from '../pishock/auth-api.js';
import { getHubs, PiShockApiError } from '../pishock/client.js';
import {
  clearPendingConfirm,
  getPendingConfirm,
  setPendingConfirm,
  takePendingConfirm,
} from '../pishock/pending-confirm.js';
import { awaitRelayLogin, getPendingLogin, startRelayLogin } from '../pishock/relay.js';
import { clearPiShockSession, savePiShockSession } from '../session.js';

function parseManualApiKeyBody(body: unknown): { username: string; apiKey: string } | null {
  if (!body || typeof body !== 'object') return null;
  const row = body as Record<string, unknown>;
  const username = String(row.username ?? row.Username ?? '').trim();
  const apiKey = String(row.apiKey ?? row.ApiKey ?? row.token ?? row.Token ?? '').trim();
  if (!username || !apiKey) return null;
  return { username, apiKey };
}

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
          const session = { userId: creds.UserId, token: creds.Token };
          const [hubNames, username] = await Promise.all([
            softHubNames(session),
            softUsername(session),
          ]);
          setPendingConfirm(req.discordUser.id, creds, hubNames, username);
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
        pishockUsername: confirm.username || null,
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
        const session = { userId: creds.UserId, token: creds.Token };
        const [hubNames, username] = await Promise.all([
          softHubNames(session),
          softUsername(session),
        ]);
        setPendingConfirm(req.discordUser.id, creds, hubNames, username);
        return {
          status: 'confirm' as const,
          pishockUserId: creds.UserId,
          pishockUsername: username || null,
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

    const session = { userId: pending.userId, token: pending.token };

    try {
      let username = pending.username.trim();
      if (!username) {
        username = (await getAccount(session)).Username;
      }
      if (!username) {
        return reply.code(502).send({ error: 'PiShock account username unavailable' });
      }

      // No forced Expiry — key lasts until revoked or PiShock rejects it.
      const created = await createApiKey(session, { name: PISHOCK_API_KEY_NAME });

      await validateApiKey({
        userId: pending.userId,
        username,
        apiKey: created.apiKey,
      });

      await savePiShockSession(opts.env, req.discordUser.id, {
        userId: pending.userId,
        username,
        apiKey: created.apiKey,
        expiresAt: created.expiry,
        apiKeyId: created.apiKeyId,
      });

      return {
        ok: true,
        pishockUserId: pending.userId,
        pishockUsername: username,
        hubNames: pending.hubNames,
        apiKey: created.apiKey,
        apiKeyName: PISHOCK_API_KEY_NAME,
        expiresAt: created.expiry ? created.expiry.toISOString() : null,
      };
    } catch (err) {
      // Put pending back so the user can retry confirm without re-logging in.
      setPendingConfirm(
        req.discordUser.id,
        { UserId: pending.userId, Token: pending.token },
        pending.hubNames,
        pending.username,
      );
      if (err instanceof PiShockApiError) {
        return reply.code(err.status >= 400 && err.status < 600 ? err.status : 502).send({
          error: err.body || err.message,
          code: err.needsRelogin ? 'PISHOCK_RELOGIN' : 'PISHOCK_API_KEY_CREATE_FAILED',
        });
      }
      return reply.code(502).send({
        error: err instanceof Error ? err.message : 'Failed to create PiShock API key',
        code: 'PISHOCK_API_KEY_CREATE_FAILED',
      });
    }
  });

  app.post('/api/pishock/login/cancel', async (req) => {
    clearPendingConfirm(req.discordUser.id);
    return { ok: true };
  });

  /** Manual link with an existing PiShock username + API key (no browser login). */
  app.post('/api/pishock/session/api-key', async (req, reply) => {
    if (!req.hasConsent) {
      return reply.code(403).send({ error: 'Consent required' });
    }
    const parsed = parseManualApiKeyBody(req.body);
    if (!parsed) {
      return reply.code(400).send({
        error: 'username and apiKey are required',
        code: 'PISHOCK_API_KEY_REQUIRED',
      });
    }

    try {
      const account = await validateApiKey({
        username: parsed.username,
        apiKey: parsed.apiKey,
      });

      clearPendingConfirm(req.discordUser.id);
      await savePiShockSession(opts.env, req.discordUser.id, {
        userId: account.userId,
        username: account.username,
        apiKey: parsed.apiKey,
        expiresAt: null,
        apiKeyId: null,
      });

      return {
        ok: true,
        pishockUserId: account.userId,
        pishockUsername: account.username,
        expiresAt: null,
        manual: true,
      };
    } catch (err) {
      if (err instanceof PiShockApiError) {
        return reply.code(err.status >= 400 && err.status < 600 ? err.status : 502).send({
          error: err.body || err.message,
          code: err.needsRelogin ? 'PISHOCK_RELOGIN' : 'PISHOCK_API_KEY_INVALID',
        });
      }
      return reply.code(502).send({
        error: err instanceof Error ? err.message : 'Failed to validate PiShock API key',
        code: 'PISHOCK_API_KEY_INVALID',
      });
    }
  });

  app.delete('/api/pishock/session', async (req) => {
    clearPendingConfirm(req.discordUser.id);
    await clearPiShockSession(req.discordUser.id);
    return { ok: true };
  });
};

async function softHubNames(creds: { userId: number; token: string }): Promise<string[]> {
  try {
    // Ephemeral website session — never use API-key headers here.
    const result = await getHubs({
      userId: creds.userId,
      username: '',
      token: creds.token,
      mode: 'session',
    });
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

async function softUsername(creds: { userId: number; token: string }): Promise<string> {
  try {
    const account = await getAccount(creds);
    return String(account.Username ?? '').trim();
  } catch {
    return '';
  }
}
