import crypto from 'node:crypto';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppEnv } from './env.js';

/**
 * Discord embeds Activities in an iframe, so `X-Frame-Options` (helmet's default) would
 * block the app entirely. Framing is controlled through CSP `frame-ancestors` instead.
 */
const DISCORD_FRAME_ANCESTORS = [
  "'self'",
  'https://discord.com',
  'https://*.discord.com',
  'https://*.discordsays.com',
];

/** Pino logger options: never write bearer tokens or signatures to the logs. */
export function buildLoggerOptions() {
  return {
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-signature-ed25519"]',
        'req.headers["x-signature-timestamp"]',
        'res.headers["set-cookie"]',
      ],
      censor: '[redacted]',
    },
    serializers: {
      // The realtime socket may carry a legacy `?token=` / `?access_token=` query string.
      req(req: { method?: string; url?: string; headers?: Record<string, unknown>; ip?: string }) {
        return {
          method: req.method,
          url: redactQueryTokens(req.url),
          host: typeof req.headers?.host === 'string' ? req.headers.host : undefined,
          remoteAddress: req.ip,
        };
      },
    },
  };
}

export function redactQueryTokens(url: string | undefined): string | undefined {
  if (!url) return url;
  return url.replace(/([?&](?:access_token|token)=)[^&]*/gi, '$1[redacted]');
}

function apiPathOf(req: FastifyRequest): string {
  return (req.raw.url ?? req.url).split('?')[0] ?? '';
}

/** Rate-limit bucket: the authenticated caller when a bearer is present, else the client IP. */
export function rateLimitKey(req: FastifyRequest): string {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.length > 7) {
    return `t:${crypto.createHash('sha256').update(auth).digest('hex').slice(0, 24)}`;
  }
  return `ip:${req.ip}`;
}

export async function registerSecurity(app: FastifyInstance, env: AppEnv) {
  await app.register(helmet, {
    frameguard: false,
    // COEP would block Discord avatars / cross-origin images in the iframe.
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      // Report-only by default so a missed origin cannot blank the Activity inside Discord.
      // Set CSP_ENFORCE=1 once the browser console shows no violations.
      reportOnly: !env.cspEnforce,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // React inline `style={...}` attributes and the small <style> block in index.html.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://cdn.discordapp.com'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'wss:', 'ws:', 'https://discord.com'],
        frameAncestors: DISCORD_FRAME_ANCESTORS,
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
  });

  await app.register(rateLimit, {
    global: true,
    max: env.rateLimitMax,
    timeWindow: '1 minute',
    keyGenerator: rateLimitKey,
    // Only throttle the API; never the health probe, the WebSocket upgrade or static files.
    allowList: (req) => {
      const path = apiPathOf(req);
      return (
        !path.startsWith('/api/') ||
        path === '/api/health' ||
        path === '/api/version' ||
        path === '/api/ws'
      );
    },
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: 'Too many requests',
      retryAfterMs: ctx.ttl,
    }),
  });
}

/** Stricter per-route limits for unauthenticated / credential-handling endpoints. */
export const strictRateLimit = (max: number) => ({
  config: { rateLimit: { max, timeWindow: '1 minute' } },
});
