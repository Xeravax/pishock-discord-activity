import {
  PISHOCK_API,
  PISHOCK_API_KEY_NAME,
  PISHOCK_AUTH,
} from '../../shared/constants.js';
import { PiShockApiError, type PiShockCreds } from './client.js';

export type SessionCreds = { userId: number; token: string };

export type PiShockAccountApiKey = {
  ApiKeyId: number;
  Name: string;
  Expiry: string | null;
  Generated: string;
};

export type PiShockAccount = {
  UserId: number;
  Username: string;
  APIKeys?: PiShockAccountApiKey[];
};

function sessionHeaders(creds: SessionCreds, hasJsonBody: boolean): HeadersInit {
  const h: Record<string, string> = {
    Accept: 'application/json',
    'X-PiShock-UserId': String(creds.userId),
    'X-PiShock-Token': creds.token,
  };
  if (hasJsonBody) h['Content-Type'] = 'application/json';
  return h;
}

async function authRequest<T>(
  creds: SessionCreds,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const hasJsonBody = body !== undefined;
  const res = await fetch(`${PISHOCK_AUTH}${path}`, {
    method,
    headers: sessionHeaders(creds, hasJsonBody),
    body: hasJsonBody ? JSON.stringify(body) : undefined,
  });
  const raw = await res.text();
  if (res.status === 401) {
    throw new PiShockApiError(401, raw || 'Unauthorized');
  }
  if (!res.ok) {
    throw new PiShockApiError(res.status, raw || res.statusText);
  }
  if (!raw) {
    throw new PiShockApiError(res.status, 'Empty response from PiShock auth');
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new PiShockApiError(res.status, `Invalid JSON from PiShock auth: ${raw.slice(0, 200)}`);
  }
}

export async function getAccount(creds: SessionCreds): Promise<PiShockAccount> {
  return authRequest<PiShockAccount>(creds, 'GET', '/Account');
}

function parseAccountJson(raw: string): { userId: number; username: string } | null {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const userId = Number(data.UserId ?? data.userId);
    const username = String(data.Username ?? data.username ?? '').trim();
    if (!Number.isFinite(userId) || userId <= 0 || !username) return null;
    return { userId, username };
  } catch {
    return null;
  }
}

function accountFromResponse(
  raw: string,
  style: 'apiKeyHeader' | 'apiKeyAsToken',
  usernameHint: string,
  expectedUserId?: number,
): {
  userId: number;
  username: string;
  style: 'apiKeyHeader' | 'apiKeyAsToken';
} {
  const account = parseAccountJson(raw);
  if (!account) {
    throw new PiShockApiError(502, 'PiShock Account response missing UserId/Username');
  }
  if (expectedUserId && expectedUserId > 0 && expectedUserId !== account.userId) {
    throw new PiShockApiError(401, 'API key does not belong to that PiShock account', false);
  }
  if (usernameHint && usernameHint.toLowerCase() !== account.username.toLowerCase()) {
    throw new PiShockApiError(401, 'API key does not belong to that username', false);
  }
  console.info(`[pishock] API key validated via ${style}`);
  return { userId: account.userId, username: account.username, style };
}

async function readAccount(
  headers: Record<string, string>,
): Promise<{ ok: boolean; status: number; raw: string }> {
  const res = await fetch(`${PISHOCK_API}/Account`, { method: 'GET', headers });
  const raw = await res.text();
  return { ok: res.ok, status: res.status, raw };
}

/**
 * PiShock documents this lookup as a query string only. Used after header
 * auth fails, so a successful link never puts the key in a URL.
 */
async function probeUserId(
  apiKey: string,
  username: string,
): Promise<{ userId: number; status: number }> {
  const probe = new URL(`${PISHOCK_AUTH}/Auth/GetUserIfAPIKeyValid`);
  probe.searchParams.set('apikey', apiKey);
  probe.searchParams.set('username', username);
  const probeRes = await fetch(probe);
  const probeRaw = await probeRes.text();
  if (!probeRes.ok) {
    console.warn(`[pishock] GetUserIfAPIKeyValid → ${probeRes.status}`);
    return { userId: 0, status: probeRes.status };
  }
  const asNum = Number(probeRaw.trim());
  if (Number.isFinite(asNum) && asNum > 0) return { userId: asNum, status: probeRes.status };
  try {
    const parsed = JSON.parse(probeRaw) as Record<string, unknown>;
    const id = Number(parsed.UserId ?? parsed.userId ?? parsed.UserID ?? parsed);
    if (Number.isFinite(id) && id > 0) return { userId: id, status: probeRes.status };
  } catch {
    // opaque body
  }
  return { userId: 0, status: probeRes.status };
}

function validationFailure(statuses: number[]): PiShockApiError {
  const non401 = statuses.find((status) => status !== 401);
  if (non401 != null) {
    return new PiShockApiError(non401, 'PiShock API key validation failed');
  }
  return new PiShockApiError(401, 'API key was rejected by api.pishock.com');
}

/**
 * Prove an API key works against api.pishock.com and return the owning account.
 * Header auth is tried first. The query-string user lookup runs only if that
 * fails and a UserId is still required for the Token fallback.
 * The Account username must match the caller's username; a client-supplied
 * name is never stored when the Account payload cannot be parsed.
 */
export async function validateApiKey(input: {
  apiKey: string;
  username: string;
  userId?: number;
}): Promise<{
  userId: number;
  username: string;
  style: 'apiKeyHeader' | 'apiKeyAsToken';
}> {
  const apiKey = input.apiKey.trim();
  const usernameHint = input.username.trim();
  if (!apiKey) {
    throw new PiShockApiError(400, 'API key required');
  }

  const failures: number[] = [];
  const headerRes = await readAccount({
    Accept: 'application/json',
    'X-PiShock-Api-Key': apiKey,
  });
  if (headerRes.ok) {
    return accountFromResponse(headerRes.raw, 'apiKeyHeader', usernameHint, input.userId);
  }
  failures.push(headerRes.status);
  if (headerRes.status !== 401) {
    console.warn(`[pishock] API key validate apiKeyHeader → ${headerRes.status}`);
  }

  let userId = input.userId && Number.isFinite(input.userId) && input.userId > 0 ? input.userId : 0;
  if (!(userId > 0) && usernameHint) {
    const probed = await probeUserId(apiKey, usernameHint);
    if (probed.userId > 0) userId = probed.userId;
    else if (probed.status !== 200) failures.push(probed.status);
  }
  if (userId > 0) {
    const tokenRes = await readAccount({
      Accept: 'application/json',
      'X-PiShock-UserId': String(userId),
      'X-PiShock-Token': apiKey,
    });
    if (tokenRes.ok) {
      return accountFromResponse(tokenRes.raw, 'apiKeyAsToken', usernameHint, input.userId);
    }
    failures.push(tokenRes.status);
    console.warn(`[pishock] API key validate apiKeyAsToken → ${tokenRes.status}`);
  }
  throw validationFailure(failures);
}

/**
 * Create a named API key with no forced Expiry (lasts until revoked / rejected).
 * Optional expiry is only sent when the caller explicitly requests it.
 */
export async function createApiKey(
  creds: SessionCreds,
  opts: { name?: string; expiry?: Date | null } = {},
): Promise<{ apiKey: string; apiKeyId: number | null; expiry: Date | null }> {
  const name = opts.name?.trim() || PISHOCK_API_KEY_NAME;
  const expiryIso = opts.expiry ? opts.expiry.toISOString() : null;

  const created = await authRequest<{ ApiKey?: string }>(creds, 'POST', '/Api', {
    ApiKeyName: name,
    ...(expiryIso ? { Expiry: expiryIso } : {}),
  });

  const apiKey = typeof created.ApiKey === 'string' ? created.ApiKey.trim() : '';
  if (!apiKey) {
    throw new PiShockApiError(502, 'PiShock did not return an API key');
  }

  let apiKeyId: number | null = null;
  let expiry: Date | null = opts.expiry ?? null;
  try {
    const account = await getAccount(creds);
    const match = (account.APIKeys ?? [])
      .filter((k) => k.Name === name)
      .sort((a, b) => Date.parse(b.Generated) - Date.parse(a.Generated))[0];
    if (match && Number.isFinite(match.ApiKeyId)) {
      apiKeyId = match.ApiKeyId;
      if (match.Expiry) {
        const parsed = new Date(match.Expiry);
        if (Number.isFinite(parsed.getTime())) expiry = parsed;
      }
      console.info(
        `[pishock] created API key id=${apiKeyId} name=${name} expiry=${match.Expiry ?? 'null'}`,
      );
    }
  } catch {
    // Non-fatal — we still have the plaintext key to store.
  }

  return { apiKey, apiKeyId, expiry };
}

export function apiKeyCreds(
  userId: number,
  username: string,
  apiKey: string,
): PiShockCreds {
  return { userId, username, token: apiKey, mode: 'apiKey' };
}
