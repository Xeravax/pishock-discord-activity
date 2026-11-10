import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { loadEnv } from './env.js';
import { authPlugin } from './auth-plugin.js';
import { authRoutes } from './routes/auth.js';
import { pishockSessionRoutes } from './routes/pishock-session.js';
import { controlRoutes } from './routes/control.js';
import { activityShareRoutes } from './routes/activity-share.js';
import { participantRoutes } from './routes/participants.js';
import { announcementRoutes } from './routes/announcements.js';
import { attachRealtime } from './realtime.js';
import { loadAppVersion } from './app-version.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const env = loadEnv();
  const appVersion = loadAppVersion();
  const app = Fastify({ logger: true });

  // Discord activity proxy prefix must rewrite before routing/auth
  app.addHook('onRequest', async (req) => {
    if (req.url.startsWith('/.proxy/')) {
      const next = req.url.slice('/.proxy'.length) || '/';
      (req as { url: string }).url = next;
      if (req.raw.url?.startsWith('/.proxy/')) {
        req.raw.url = req.raw.url.replace(/^\/\.proxy/, '') || '/';
      }
    }
  });

  const healthPayload = () => ({
    ok: true as const,
    version: appVersion.label,
    sha: appVersion.sha,
    shortSha: appVersion.shortSha,
    ref: appVersion.ref,
    refType: appVersion.refType,
    builtAt: appVersion.builtAt,
    now: new Date().toISOString(),
  });

  app.get('/api/health', async () => healthPayload());
  app.get('/api/version', async () => healthPayload());

  await app.register(authPlugin, { env });
  await app.register(authRoutes, { env });
  await app.register(pishockSessionRoutes, { env });
  await app.register(controlRoutes, { env });
  await app.register(activityShareRoutes, { env });
  await app.register(participantRoutes, { env });
  await app.register(announcementRoutes);


  const clientDist = resolveClientDist();
  if (clientDist) {
    app.log.info(`Serving UI from ${clientDist}`);
    await app.register(fastifyStatic, {
      root: clientDist,
      prefix: '/',
    });
    app.setNotFoundHandler(async (req, reply) => {
      const url = req.url.split('?')[0] ?? req.url;
      if (url.startsWith('/api/') || url.startsWith('/.proxy/') || url.startsWith('/assets/')) {
        return reply.code(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.log.warn('client-dist not found; API-only mode');
  }

  await app.listen({ port: env.port, host: '0.0.0.0' });
  attachRealtime(app.server);
  app.log.info(`Listening on ${env.publicUrl} (port ${env.port})`);
  app.log.info('Realtime WebSocket at /api/ws');
}

function resolveClientDist(): string | null {
  const candidates = [
    path.resolve(__dirname, '../../client-dist'),
    path.resolve(__dirname, '../client-dist'),
    path.resolve(process.cwd(), 'client-dist'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'index.html'))) {
      return candidate;
    }
  }
  return null;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
