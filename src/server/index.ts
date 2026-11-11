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
import { queueRoutes } from './routes/queue.js';
import { announcementRoutes } from './routes/announcements.js';
import { attachRealtime, broadcastRealtimeAll } from './realtime.js';
import { loadAppVersion } from './app-version.js';
import { prisma } from './db.js';
import { closeAllBrokerSessions } from './pishock/broker.js';
import { installPiShockKeyRejectionHandler } from './session.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Docker stop grace is typically 10s — exit well before SIGKILL. */
const SHUTDOWN_FORCE_MS = 8_000;
/** Brief window so clients can receive the WS shutdown signal before listen closes. */
const SHUTDOWN_NOTIFY_MS = 250;

async function main() {
  const env = loadEnv();
  installPiShockKeyRejectionHandler(env);
  const appVersion = loadAppVersion();
  const app = Fastify({ logger: true });
  let shuttingDown = false;

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
    ok: !shuttingDown,
    shuttingDown,
    version: appVersion.label,
    sha: appVersion.sha,
    shortSha: appVersion.shortSha,
    ref: appVersion.ref,
    refType: appVersion.refType,
    builtAt: appVersion.builtAt,
    now: new Date().toISOString(),
  });

  app.get('/api/health', async (_req, reply) => {
    const payload = healthPayload();
    if (shuttingDown) return reply.code(503).send(payload);
    return payload;
  });
  app.get('/api/version', async (_req, reply) => {
    const payload = healthPayload();
    if (shuttingDown) return reply.code(503).send(payload);
    return payload;
  });

  await app.register(authPlugin, { env });
  await app.register(authRoutes, { env });
  await app.register(pishockSessionRoutes, { env });
  await app.register(controlRoutes, { env });
  await app.register(activityShareRoutes, { env });
  await app.register(participantRoutes, { env });
  await app.register(queueRoutes, { env });
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
  const disposeRealtime = attachRealtime(app.server);
  app.log.info(`Listening on ${env.publicUrl} (port ${env.port})`);
  app.log.info('Realtime WebSocket at /api/ws');

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'Shutting down…');

    const forceTimer = setTimeout(() => {
      app.log.warn('Shutdown timed out — forcing exit');
      process.exit(1);
    }, SHUTDOWN_FORCE_MS);
    forceTimer.unref?.();

    try {
      broadcastRealtimeAll({ type: 'server_shutting_down', at: Date.now() });
      await new Promise((resolve) => setTimeout(resolve, SHUTDOWN_NOTIFY_MS));
      disposeRealtime();
      closeAllBrokerSessions();
      await app.close();
      await prisma.$disconnect();
      clearTimeout(forceTimer);
      app.log.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Error during shutdown');
      clearTimeout(forceTimer);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
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
