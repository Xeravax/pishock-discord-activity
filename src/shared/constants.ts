/** Fixed origin name shown in PiShock device logs */
export const AGENT_NAME = 'Discord PiShock Activity';

export const PISHOCK_API = 'https://api.pishock.com';
export const PISHOCK_AUTH = 'https://auth.pishock.com';
/** Legacy host. POST /Share on the new API often 401s an API key that Hub/Shockers accept. */
export const PISHOCK_LEGACY_API = 'https://ps.pishock.com';
/** Legacy operate host (do.pishock.com apioperate / share helpers). */
export const PISHOCK_DO_API = 'https://do.pishock.com/api';
export const PISHOCK_RELAY = 'wss://relay.pishock.com';
export const PISHOCK_BROKER = 'wss://broker.pishock.com/v2';
export const PISHOCK_LOGIN = 'https://login.pishock.com';
export const PISHOCK_DASHBOARD_API = 'https://dashboard.api.k8s.pishock.com';
export const PISHOCK_ANNOUNCEMENTS_LIVE = `${PISHOCK_DASHBOARD_API}/Announcements/Live`;

export enum ShockerOp {
  Shock = 0,
  Vibrate = 1,
  Beep = 2,
}

export const RELAY_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

/** Suffix for named PiShock API keys created by this activity. */
export const PISHOCK_API_KEY_NAME_SUFFIX = 'Discord PiShock Controller';

/** Created activity keys expire after 7 days (PiShock Expiry). */
export const PISHOCK_API_KEY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** @deprecated Use formatPiShockApiKeyName() — kept for older copy/tests. */
export const PISHOCK_API_KEY_NAME = PISHOCK_API_KEY_NAME_SUFFIX;

/** UTC stamp + controller suffix, e.g. `2026-11-12 14:16:32 UTC - Discord PiShock Controller`. */
export function formatPiShockApiKeyName(at = new Date()): string {
  const y = at.getUTCFullYear();
  const mo = String(at.getUTCMonth() + 1).padStart(2, '0');
  const d = String(at.getUTCDate()).padStart(2, '0');
  const h = String(at.getUTCHours()).padStart(2, '0');
  const mi = String(at.getUTCMinutes()).padStart(2, '0');
  const s = String(at.getUTCSeconds()).padStart(2, '0');
  return `${y}-${mo}-${d} ${h}:${mi}:${s} UTC - ${PISHOCK_API_KEY_NAME_SUFFIX}`;
}

export function defaultPiShockApiKeyExpiry(at = new Date()): Date {
  return new Date(at.getTime() + PISHOCK_API_KEY_TTL_MS);
}
