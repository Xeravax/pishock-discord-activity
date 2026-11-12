import { getBootAppVersion, markClientOutdated } from './hooks/useAppHealth';

const urlParams = new URLSearchParams(window.location.search);
export const isEmbedded = urlParams.has('frame_id');

export function apiBase(): string {
  // Same-origin /api on <app-id>.discordsays.com. Discord's URL mapping
  // forwards that path and attaches the proxy signature headers.
  // The legacy /.proxy prefix is still routed, but those requests arrive
  // without X-Signature-Ed25519 / X-Discord-Proxy-Payload.
  return '/api';
}

export class ApiError extends Error {
  status: number;
  code?: string;
  body: unknown;

  constructor(status: number, body: unknown) {
    const message =
      typeof body === 'object' && body && 'error' in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${status}`;
    super(message);
    this.status = status;
    this.body = body;
    if (typeof body === 'object' && body && 'code' in body) {
      this.code = String((body as { code: unknown }).code);
    }
  }
}

export async function apiFetch<T>(
  path: string,
  accessToken: string | null,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type') && init?.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }
  headers.set('X-Client-Version', getBootAppVersion());
  const res = await fetch(`${apiBase()}${path}`, { ...init, headers });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (
    res.status === 426 ||
    (typeof body === 'object' && body && (body as { code?: string }).code === 'APP_OUTDATED')
  ) {
    const serverVersion =
      typeof body === 'object' && body && 'serverVersion' in body
        ? String((body as { serverVersion: unknown }).serverVersion)
        : res.headers.get('X-App-Version');
    markClientOutdated(serverVersion);
  }
  if (!res.ok) {
    throw new ApiError(res.status, body);
  }
  return body as T;
}
