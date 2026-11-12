import type { FastifyPluginAsync } from 'fastify';
import type { AppEnv } from '../env.js';
import {
  createApiKey,
  getAccount,
  profileFromAccount,
  softAccountProfile,
  softApiKeyProfile,
  validateApiKey,
} from '../pishock/auth-api.js';
import { getHubs, PiShockApiError, redactPiShockSecrets } from '../pishock/client.js';
import { ManualLinkRateError, assertManualApiKeyRateLimit } from '../pishock/manual-link-rate.js';
import {
  beginConfirmAttempt,
  clearPendingConfirm,
  confirmAttemptOwns,
  finishConfirmAttempt,
  getConfirmFlight,
  getPendingConfirm,
  isConfirmInFlight,
  restoreOwnedPendingConfirm,
  setPendingConfirm,
  type CreatedApiKeyDraft,
} from '../pishock/pending-confirm.js';
import {
  getStoredProfileImage,
  persistAccountImages,
  type ProfileImageKind,
} from '../pishock/profile-images.js';
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

function confirmPayload(
  discordUser: { id: string; username: string; global_name?: string | null },
  row: {
    userId: number;
    username: string;
    avatarUrl: string | null;
    bannerUrl: string | null;
    hubNames: string[];
  },
) {
  return {
    status: 'confirm' as const,
    pishockUserId: row.userId,
    pishockUsername: row.username || null,
    avatarUrl: row.avatarUrl,
    bannerUrl: row.bannerUrl,
    hubNames: row.hubNames,
    discordUser: {
      id: discordUser.id,
      username: discordUser.username,
      global_name: discordUser.global_name ?? null,
    },
  };
}

export const pishockSessionRoutes: FastifyPluginAsync<{ env: AppEnv }> = async (app, opts) => {
  /** Locally cached PiShock avatar/banner (public so <img> tags work without Bearer). */
  app.get('/api/pishock/media/:pishockUserId/:kind', async (req, reply) => {
    const params = req.params as { pishockUserId?: string; kind?: string };
    const pishockUserId = Number(params.pishockUserId);
    const kind = String(params.kind ?? '').trim() as ProfileImageKind;
    if (!Number.isFinite(pishockUserId) || pishockUserId <= 0 || (kind !== 'avatar' && kind !== 'banner')) {
      return reply.code(404).send({ error: 'Not found' });
    }
    const stored = await getStoredProfileImage(pishockUserId, kind);
    if (!stored) return reply.code(404).send({ error: 'Not found' });
    reply.header('Content-Type', stored.contentType);
    reply.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    reply.header('ETag', `"${stored.version}"`);
    const inm = req.headers['if-none-match'];
    if (typeof inm === 'string' && inm.replace(/W\//i, '').replaceAll('"', '') === stored.version) {
      return reply.code(304).send();
    }
    return reply.send(stored.buffer);
  });

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
          const [hubNames, profile] = await Promise.all([
            softHubNames(session),
            softAccountProfile(session),
          ]);
          setPendingConfirm(req.discordUser.id, creds, hubNames, profile);
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
    if (isConfirmInFlight(req.discordUser.id)) {
      const flight = getConfirmFlight(req.discordUser.id);
      if (flight) {
        return confirmPayload(req.discordUser, flight);
      }
    }

    const confirm = getPendingConfirm(req.discordUser.id);
    if (confirm) {
      return confirmPayload(req.discordUser, confirm);
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
        const [hubNames, profile] = await Promise.all([
          softHubNames(session),
          softAccountProfile(session),
        ]);
        setPendingConfirm(req.discordUser.id, creds, hubNames, profile);
        return confirmPayload(req.discordUser, {
          userId: creds.UserId,
          username: profile.username,
          avatarUrl: profile.avatarUrl,
          bannerUrl: profile.bannerUrl,
          hubNames,
        });
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
    const pending = beginConfirmAttempt(req.discordUser.id);
    if (pending === 'busy') {
      return reply.code(409).send({
        error: 'PiShock login confirmation is already in progress',
        code: 'CONFIRM_IN_PROGRESS',
      });
    }
    if (!pending) {
      return reply.code(404).send({
        error: 'No PiShock login waiting for confirmation',
        code: 'NO_PENDING_CONFIRM',
      });
    }

    const session = { userId: pending.userId, token: pending.token };
    const generation = pending.generation;
    const profile = {
      username: pending.username,
      avatarUrl: pending.avatarUrl,
      bannerUrl: pending.bannerUrl,
    };
    const restore = (created: CreatedApiKeyDraft | null) => {
      restoreOwnedPendingConfirm(
        req.discordUser.id,
        generation,
        { UserId: pending.userId, Token: pending.token },
        pending.hubNames,
        profile,
        created,
      );
    };
    // Reuse a key minted by an earlier confirm so a failed save does not
    // leave another orphan on the PiShock account.
    let created: CreatedApiKeyDraft | null = pending.createdApiKey
      ? {
          apiKey: pending.createdApiKey,
          apiKeyId: pending.createdApiKeyId,
          expiry: pending.createdExpiry,
          name: pending.createdApiKeyName,
        }
      : null;

    try {
      let username = pending.username.trim();
      if (!username || (!profile.avatarUrl && !profile.bannerUrl)) {
        try {
          const account = await getAccount(session);
          const refreshed = await persistAccountImages(
            pending.userId,
            profileFromAccount(account),
          );
          if (!username) username = refreshed.username;
          if (!profile.avatarUrl) profile.avatarUrl = refreshed.avatarUrl;
          if (!profile.bannerUrl) profile.bannerUrl = refreshed.bannerUrl;
        } catch {
          // Username may already be present from the pending row.
        }
      } else {
        const stored = await persistAccountImages(pending.userId, profile);
        profile.avatarUrl = stored.avatarUrl;
        profile.bannerUrl = stored.bannerUrl;
      }
      if (!username) {
        restore(created);
        return reply.code(502).send({ error: 'PiShock account username unavailable' });
      }
      profile.username = username;

      if (!created) {
        const minted = await createApiKey(session);
        created = {
          apiKey: minted.apiKey,
          apiKeyId: minted.apiKeyId,
          expiry: minted.expiry,
          name: minted.name,
        };
      }

      const account = await validateApiKey({
        userId: pending.userId,
        username,
        apiKey: created.apiKey,
      });

      if (!confirmAttemptOwns(req.discordUser.id, generation)) {
        return reply.code(409).send({
          error: 'PiShock login confirmation was cancelled',
          code: 'CONFIRM_CANCELLED',
        });
      }
      await savePiShockSession(opts.env, req.discordUser.id, {
        userId: account.userId,
        username: account.username,
        apiKey: created.apiKey,
        expiresAt: created.expiry,
        apiKeyId: created.apiKeyId,
      });
      if (!confirmAttemptOwns(req.discordUser.id, generation)) {
        // Cancel/manual link won during save — do not hand the key to this confirm.
        return reply.code(409).send({
          error: 'PiShock login confirmation was cancelled',
          code: 'CONFIRM_CANCELLED',
        });
      }

      return {
        ok: true,
        pishockUserId: account.userId,
        pishockUsername: account.username,
        avatarUrl: profile.avatarUrl,
        bannerUrl: profile.bannerUrl,
        hubNames: pending.hubNames,
        apiKey: created.apiKey,
        apiKeyName: created.name,
        expiresAt: created.expiry ? created.expiry.toISOString() : null,
      };
    } catch (err) {
      restore(created);
      if (err instanceof PiShockApiError) {
        return sendPiShockFailure(reply, err, 'PISHOCK_API_KEY_CREATE_FAILED');
      }
      return reply.code(502).send({
        error: 'Failed to create PiShock API key',
        code: 'PISHOCK_API_KEY_CREATE_FAILED',
      });
    } finally {
      finishConfirmAttempt(req.discordUser.id, generation);
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
    try {
      assertManualApiKeyRateLimit(req.discordUser.id);
    } catch (err) {
      if (err instanceof ManualLinkRateError) {
        return reply.code(err.status).send({ error: err.message, code: err.code });
      }
      throw err;
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

      const profile = await softApiKeyProfile(parsed.apiKey, account.userId);

      return {
        ok: true,
        pishockUserId: account.userId,
        pishockUsername: account.username,
        avatarUrl: profile?.avatarUrl ?? null,
        bannerUrl: profile?.bannerUrl ?? null,
        expiresAt: null,
        manual: true,
      };
    } catch (err) {
      if (err instanceof PiShockApiError) {
        return sendPiShockFailure(reply, err, 'PISHOCK_API_KEY_INVALID');
      }
      return reply.code(502).send({
        error: 'Failed to validate PiShock API key',
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

const SAFE_LINK_ERRORS = new Set([
  'API key required',
  'API key does not belong to that username',
  'API key does not belong to that PiShock account',
  'PiShock Account response missing UserId/Username',
]);

function sendPiShockFailure(
  reply: { code: (status: number) => { send: (body: unknown) => unknown } },
  err: PiShockApiError,
  code: string,
) {
  console.warn(
    `[pishock] ${code} ${err.status}: ${redactPiShockSecrets(err.body).slice(0, 200)}`,
  );
  const status = err.status >= 400 && err.status < 600 ? err.status : 502;
  const safeBody = SAFE_LINK_ERRORS.has(err.body) ? err.body : null;
  const error =
    safeBody ??
    (status === 401
      ? 'PiShock rejected that API key'
      : status === 502
        ? 'PiShock Account response could not be verified'
        : 'PiShock rejected the request');
  return reply.code(status).send({
    error,
    code: err.needsRelogin ? 'PISHOCK_RELOGIN' : code,
  });
}

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
