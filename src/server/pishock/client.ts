import {
  AGENT_NAME,
  PISHOCK_API,
  ShockerOp,
} from '../../shared/constants.js';

/**
 * Stored day-to-day creds use `mode: 'apiKey'` (default): `X-PiShock-Api-Key`.
 * Short-lived website login uses `mode: 'session'`: UserId + Token (never persisted).
 */
export type PiShockCreds = {
  userId: number;
  username: string;
  token: string;
  mode?: 'apiKey' | 'session';
};

export class PiShockApiError extends Error {
  status: number;
  body: string;
  needsRelogin: boolean;

  constructor(status: number, body: string) {
    super(`PiShock API ${status}: ${body}`);
    this.status = status;
    this.body = body;
    this.needsRelogin = status === 401;
  }
}

type AuthStyle = 'session' | 'apiKeyHeader' | 'apiKeyAsToken';

function headers(
  creds: PiShockCreds,
  hasJsonBody: boolean,
  style: AuthStyle,
): HeadersInit {
  const h: Record<string, string> = {
    Accept: 'application/json',
  };
  if (style === 'session' || style === 'apiKeyAsToken') {
    // Session login, or API key presented as Token (older / dual-accepted form)
    h['X-PiShock-UserId'] = String(creds.userId);
    h['X-PiShock-Token'] = creds.token;
  } else {
    // Saerich: X-PiShock-Api-Key OR Token+UserId — not mixed with UserId alone
    h['X-PiShock-Api-Key'] = creds.token;
  }
  // Never send Content-Type on GETs — api.pishock.com rejects empty JSON bodies with 400 SerializerErrors
  if (hasJsonBody) h['Content-Type'] = 'application/json';
  return h;
}

function authStylesFor(creds: PiShockCreds): AuthStyle[] {
  if (creds.mode === 'session') return ['session'];
  // Prefer official Api-Key header; fall back to UserId+Token=<apiKey> if rejected
  return ['apiKeyHeader', 'apiKeyAsToken'];
}

async function requestOnce<T = unknown>(
  creds: PiShockCreds,
  method: string,
  url: string,
  style: AuthStyle,
  body?: unknown,
): Promise<{ status: number; data: T | null; raw: string }> {
  const hasJsonBody = body !== undefined;
  const res = await fetch(url, {
    method,
    headers: headers(creds, hasJsonBody, style),
    body: hasJsonBody ? JSON.stringify(body) : undefined,
  });
  const raw = await res.text();
  if (res.status === 401) {
    throw new PiShockApiError(401, raw || 'Unauthorized');
  }
  if (res.status === 404 || res.status === 405) {
    return { status: res.status, data: null, raw };
  }
  if (!res.ok && res.status !== 204) {
    throw new PiShockApiError(res.status, raw);
  }
  if (res.status === 204 || !raw) {
    return { status: res.status, data: null, raw };
  }
  try {
    return { status: res.status, data: JSON.parse(raw) as T, raw };
  } catch {
    return { status: res.status, data: raw as unknown as T, raw };
  }
}

async function request<T = unknown>(
  creds: PiShockCreds,
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; data: T | null; raw: string }> {
  const styles = authStylesFor(creds);
  let last401: PiShockApiError | null = null;
  for (let i = 0; i < styles.length; i++) {
    const style = styles[i]!;
    try {
      return await requestOnce<T>(creds, method, url, style, body);
    } catch (err) {
      if (err instanceof PiShockApiError && err.needsRelogin && i + 1 < styles.length) {
        last401 = err;
        console.warn(
          `[pishock] ${method} ${url} 401 with ${style}; retrying next auth style`,
        );
        continue;
      }
      throw err;
    }
  }
  throw last401 ?? new PiShockApiError(401, 'Unauthorized');
}

export async function getHubs(creds: PiShockCreds) {
  return request(creds, 'GET', `${PISHOCK_API}/Hub`);
}

export async function getShockers(creds: PiShockCreds) {
  return request(creds, 'GET', `${PISHOCK_API}/Shockers`);
}

export async function getShared(creds: PiShockCreds) {
  return request(creds, 'GET', `${PISHOCK_API}/Share/GetShared`);
}

export async function getLinks(creds: PiShockCreds) {
  return request(creds, 'GET', `${PISHOCK_API}/Links`);
}

export async function createLink(creds: PiShockCreds, payload: Record<string, unknown>) {
  return request(creds, 'POST', `${PISHOCK_API}/Links`, payload);
}

export async function pauseLink(creds: PiShockCreds, linkId: number, pauseState: boolean | null) {
  return request(creds, 'PATCH', `${PISHOCK_API}/Links/Pause/${linkId}`, {
    PauseState: pauseState,
  });
}

export async function deleteLink(creds: PiShockCreds, linkId: number) {
  return request(creds, 'DELETE', `${PISHOCK_API}/Links/${linkId}`);
}

export async function createShare(creds: PiShockCreds, payload: Record<string, unknown>) {
  return request(creds, 'POST', `${PISHOCK_API}/Share`, payload);
}

/** Claim / redeem share code(s) into the signed-in account (website Friends → Shared Code). */
export async function claimShareCodes(creds: PiShockCreds, codes: string[]) {
  const Shares = codes.map((c) => c.trim()).filter(Boolean);
  return request(creds, 'PUT', `${PISHOCK_API}/Share`, { Shares });
}

export async function pauseShare(creds: PiShockCreds, shareId: number, pauseState: boolean | null) {
  return request(creds, 'PATCH', `${PISHOCK_API}/Share/Pause`, {
    ShareId: shareId,
    PauseState: pauseState,
  });
}

export async function deleteShare(creds: PiShockCreds, shareId: number) {
  return request(creds, 'DELETE', `${PISHOCK_API}/Share/${shareId}`);
}

/** PiShock device-log origin; keep short so Discord executor id fits */
export function agentNameForExecutor(executorLabel?: string | null): string {
  const base = AGENT_NAME;
  const who = (executorLabel ?? '').trim();
  if (!who) return base;
  const combined = `${base} · ${who}`;
  return combined.length <= 48 ? combined : `${who.slice(0, 24)} · Discord`;
}

export async function operateById(
  creds: PiShockCreds,
  shockerId: number,
  operation: ShockerOp,
  intensity: number,
  durationMs: number,
  agentName: string = AGENT_NAME,
) {
  return request(creds, 'POST', `${PISHOCK_API}/Shockers/OperateById/${shockerId}`, {
    AgentName: agentName,
    Operation: operation,
    Intensity: intensity,
    Duration: durationMs,
    IntensityAsPercentage: true,
  });
}

export async function operateByShare(
  creds: PiShockCreds,
  shareCode: string,
  operation: ShockerOp,
  intensity: number,
  durationMs: number,
  agentName: string = AGENT_NAME,
) {
  return request(creds, 'POST', `${PISHOCK_API}/Shockers/OperateByShare/${encodeURIComponent(shareCode)}`, {
    AgentName: agentName,
    Operation: operation,
    Intensity: intensity,
    Duration: durationMs,
    IntensityAsPercentage: true,
  });
}

async function softList(
  label: string,
  call: () => ReturnType<typeof request>,
  attempts = 2,
): Promise<unknown[]> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await call();
      if (res.status === 404 || res.status === 405) return [];
      if (Array.isArray(res.data)) return res.data;
      if (res.data == null) return [];
      // Some endpoints wrap lists
      if (typeof res.data === 'object') {
        const obj = res.data as Record<string, unknown>;
        for (const key of ['items', 'Items', 'data', 'Data', 'shockers', 'Shockers']) {
          if (Array.isArray(obj[key])) return obj[key] as unknown[];
        }
      }
      return [];
    } catch (err) {
      lastErr = err;
      // Do not wipe the whole link from one soft list 401 (parallel Hub/Links races).
      // Hard auth failures are handled by operate routes / confirm-time validateApiKey.
      if (i + 1 < attempts) {
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
    }
  }
  // Prefer empty control UI over failing the whole activity after login
  console.warn(`[pishock] ${label} failed; returning []`, lastErr);
  return [];
}

export type ControlSnapshot = {
  hubs: unknown[];
  shockers: unknown[];
  shared: unknown[];
  links: unknown[];
};

export async function fetchControlSnapshot(creds: PiShockCreds): Promise<ControlSnapshot> {
  const [hubs, shockers, shared, links] = await Promise.all([
    softList('Hub', () => getHubs(creds)),
    softList('Shockers', () => getShockers(creds)),
    softList('Share/GetShared', () => getShared(creds)),
    softList('Links', () => getLinks(creds)),
  ]);

  return { hubs, shockers, shared, links };
}
