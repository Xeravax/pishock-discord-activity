import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { DiscordAuthError, resolveBearerUser, type DiscordUserInfo } from './discord.js';
import type { AppEnv } from './env.js';
import { getConsent, loadPiShockCreds } from './session.js';
import type { PiShockCreds } from './pishock/client.js';

declare module 'fastify' {
  interface FastifyRequest {
    discordUser: DiscordUserInfo;
    pishockCreds: PiShockCreds | null;
    hasConsent: boolean;
  }
}

function extractBearer(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

function apiPath(req: FastifyRequest): string {
  return (req.url.split('?')[0] ?? req.url);
}

const authPluginImpl: FastifyPluginAsync<{ env: AppEnv }> = async (app, opts) => {
  app.decorateRequest('discordUser', null as unknown as DiscordUserInfo);
  app.decorateRequest('pishockCreds', null);
  app.decorateRequest('hasConsent', false);

  app.addHook('preHandler', async (req, reply) => {
    const path = apiPath(req);
    if (!path.startsWith('/api/')) return;
    if (path === '/api/health' || path === '/api/version') return;
    // Public marketing banner from PiShock dashboard
    if (path === '/api/announcements' && req.method === 'GET') return;
    // WebSocket upgrade authenticates via query token in realtime.ts
    if (path === '/api/ws') return;
    // Discord code exchange has no bearer yet
    if (path === '/api/auth/discord' && req.method === 'POST') return;

    const token = extractBearer(req);
    if (!token) {
      return reply.code(401).send({ error: 'Missing Discord bearer token' });
    }

    try {
      const user = await resolveBearerUser(token);
      req.discordUser = user;
      req.hasConsent = await getConsent(user.id);
      req.pishockCreds = await loadPiShockCreds(opts.env, user.id);
    } catch (err) {
      if (err instanceof DiscordAuthError) {
        return reply.code(err.status).send({ error: err.message });
      }
      throw err;
    }
  });
};

// Break Fastify encapsulation so decorations + auth hook apply to all route plugins
export const authPlugin = fp(authPluginImpl, {
  name: 'pishock-auth',
});
