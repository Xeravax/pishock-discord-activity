import nacl from 'tweetnacl';
import type { FastifyRequest } from 'fastify';
import type { AppEnv } from './env.js';

export class ProxyAuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

export type ProxyPayload = {
  created_at: number;
  expires_at: number;
  user_id?: string;
  application_id?: string;
  is_developer?: boolean;
  [key: string]: unknown;
};

/**
 * Validate Discord Activity proxy signatures when present.
 * - Invalid/expired signatures → 401
 * - Missing signatures → ok unless env.requireDiscordProxyAuth
 */
export function validateDiscordProxyHeaders(env: AppEnv, req: FastifyRequest): ProxyPayload | null {
  const signature = header(req, 'x-signature-ed25519');
  const timestamp = header(req, 'x-signature-timestamp');
  const payloadB64 = header(req, 'x-discord-proxy-payload');

  const anyPresent = Boolean(signature || timestamp || payloadB64);
  if (!anyPresent) {
    if (env.requireDiscordProxyAuth) {
      throw new ProxyAuthError('Missing Discord proxy authentication headers');
    }
    return null;
  }

  if (!signature || !timestamp || !payloadB64) {
    throw new ProxyAuthError('Incomplete Discord proxy authentication headers');
  }
  if (!env.discordPublicKey) {
    throw new ProxyAuthError('DISCORD_PUBLIC_KEY is not configured', 503);
  }

  let payloadBytes: Buffer;
  try {
    payloadBytes = Buffer.from(payloadB64, 'base64');
  } catch {
    throw new ProxyAuthError('Invalid Discord proxy payload encoding');
  }

  let payloadData: ProxyPayload;
  try {
    payloadData = JSON.parse(payloadBytes.toString('utf8')) as ProxyPayload;
  } catch {
    throw new ProxyAuthError('Invalid Discord proxy payload JSON');
  }

  if (String(payloadData.created_at) !== String(timestamp)) {
    throw new ProxyAuthError('invalid request timestamp');
  }
  if (Number(payloadData.expires_at) < Math.floor(Date.now() / 1000)) {
    throw new ProxyAuthError('expired proxy token');
  }

  // Discord docs JS example uses base64 signature; some samples use hex — try both
  const sigBuf = tryDecodeSignature(signature);
  const keyBuf = Buffer.from(env.discordPublicKey, 'hex');
  const ok = nacl.sign.detached.verify(
    new Uint8Array(payloadBytes),
    new Uint8Array(sigBuf),
    new Uint8Array(keyBuf),
  );
  if (!ok) {
    throw new ProxyAuthError('invalid request signature');
  }

  if (env.discordClientId && payloadData.application_id) {
    if (String(payloadData.application_id) !== String(env.discordClientId)) {
      throw new ProxyAuthError('Proxy payload application mismatch');
    }
  }

  return payloadData;
}

/** Bind a verified proxy payload to the Discord bearer user. */
export function assertProxyPayloadMatchesUser(
  payload: ProxyPayload | null,
  discordUserId: string,
): void {
  if (!payload) return;
  const proxyUserId = payload.user_id != null ? String(payload.user_id) : null;
  if (!proxyUserId) {
    throw new ProxyAuthError('Proxy payload missing user_id');
  }
  if (proxyUserId !== discordUserId) {
    throw new ProxyAuthError('Proxy payload user does not match bearer');
  }
}

function header(req: FastifyRequest, name: string): string | null {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function tryDecodeSignature(signature: string): Buffer {
  if (/^[0-9a-fA-F]+$/.test(signature) && signature.length % 2 === 0) {
    return Buffer.from(signature, 'hex');
  }
  return Buffer.from(signature, 'base64');
}
