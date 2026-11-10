import { PISHOCK_API_KEY_NAME, PISHOCK_AUTH } from '../../shared/constants.js';
import { PiShockApiError } from './client.js';

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

export async function createApiKey(
  creds: SessionCreds,
  opts: { name?: string; expiry?: Date },
): Promise<{ apiKey: string; apiKeyId: number | null }> {
  const name = opts.name?.trim() || PISHOCK_API_KEY_NAME;
  const bodyWithExpiry: Record<string, unknown> = { ApiKeyName: name };
  if (opts.expiry) {
    bodyWithExpiry.Expiry = opts.expiry.toISOString();
  }

  let created: { ApiKey?: string };
  try {
    created = await authRequest<{ ApiKey?: string }>(creds, 'POST', '/Api', bodyWithExpiry);
  } catch (err) {
    if (!opts.expiry || !(err instanceof PiShockApiError) || err.status === 401) {
      throw err;
    }
    // PiShock may reject Expiry — retry name-only and rely on our DB expiresAt.
    created = await authRequest<{ ApiKey?: string }>(creds, 'POST', '/Api', { ApiKeyName: name });
  }

  const apiKey = typeof created.ApiKey === 'string' ? created.ApiKey.trim() : '';
  if (!apiKey) {
    throw new PiShockApiError(502, 'PiShock did not return an API key');
  }

  let apiKeyId: number | null = null;
  try {
    const account = await getAccount(creds);
    const match = (account.APIKeys ?? [])
      .filter((k) => k.Name === name)
      .sort((a, b) => Date.parse(b.Generated) - Date.parse(a.Generated))[0];
    if (match && Number.isFinite(match.ApiKeyId)) {
      apiKeyId = match.ApiKeyId;
    }
  } catch {
    // Non-fatal — we still have the plaintext key to store.
  }

  return { apiKey, apiKeyId };
}
