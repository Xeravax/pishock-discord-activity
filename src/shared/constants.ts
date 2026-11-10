/** Fixed origin name shown in PiShock device logs */
export const AGENT_NAME = 'Discord PiShock Activity';

export const PISHOCK_API = 'https://api.pishock.com';
export const PISHOCK_AUTH = 'https://auth.pishock.com';
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

/** Named PiShock API key created for this activity (does not replace other named keys). */
export const PISHOCK_API_KEY_NAME = 'Discord Activity';
