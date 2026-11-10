import { useSyncExternalStore } from 'react';
import { apiBase } from '../api';

export type ServerHealthInfo = {
  ok: boolean;
  version?: string;
  shuttingDown?: boolean;
  sha?: string;
  shortSha?: string;
  ref?: string;
  refType?: string;
  builtAt?: string;
};

export type AppHealthStatus = 'unknown' | 'ok' | 'down' | 'restarting' | 'outdated';

type HealthState = {
  status: AppHealthStatus;
  serverVersion: string | null;
  lastOkAt: number | null;
  /** When the client first noticed serverVersion !== bootVersion while healthy. */
  outdatedSince: number | null;
  /** Epoch ms when a forced reload will fire (outdated grace end). */
  forceReloadAt: number | null;
};

const BOOT_VERSION = String(import.meta.env.VITE_APP_VERSION || 'dev');
const POLL_ONLINE_MS = 60_000;
const POLL_OFFLINE_MS = 5_000;
const POLL_OUTDATED_MS = 10_000;
/** How long a stale client may keep running before a forced reload. */
export const OUTDATED_GRACE_MS = 3 * 60_000;
const RELOAD_COOLDOWN_MS = 20_000;
const RELOAD_FLAG_KEY = 'pishock.forcedReloadAt';

let state: HealthState = {
  status: 'unknown',
  serverVersion: null,
  lastOkAt: null,
  outdatedSince: null,
  forceReloadAt: null,
};

const listeners = new Set<() => void>();
let pollTimer: number | null = null;
let forceReloadTimer: number | null = null;
let inFlight = false;
let started = false;
let reloadArmed = false;

function emit() {
  for (const listener of listeners) listener();
}

function versionsDiffer(serverVersion: string | null | undefined): boolean {
  if (!serverVersion) return false;
  if (BOOT_VERSION === 'dev' && serverVersion === 'dev') return false;
  return serverVersion !== BOOT_VERSION;
}

function recentlyForcedReload(): boolean {
  try {
    const at = Number(sessionStorage.getItem(RELOAD_FLAG_KEY) || 0);
    return Number.isFinite(at) && Date.now() - at < RELOAD_COOLDOWN_MS;
  } catch {
    return false;
  }
}

/** Hard refresh so Discord Activity / browser pick up the new bundle. */
export function reloadApp(_reason = 'version'): void {
  if (reloadArmed) return;
  reloadArmed = true;
  try {
    sessionStorage.setItem(RELOAD_FLAG_KEY, String(Date.now()));
  } catch {
    // ignore
  }
  window.location.reload();
}

function clearForceReloadTimer() {
  if (forceReloadTimer != null) {
    window.clearTimeout(forceReloadTimer);
    forceReloadTimer = null;
  }
}

function scheduleForceReload(at: number) {
  clearForceReloadTimer();
  const delay = Math.max(0, at - Date.now());
  forceReloadTimer = window.setTimeout(() => {
    forceReloadTimer = null;
    if (state.status !== 'outdated') return;
    if (recentlyForcedReload()) return;
    reloadApp('outdated-grace');
  }, delay);
}

function setState(patch: Partial<HealthState>) {
  state = { ...state, ...patch };
  emit();
  restartPollLoop();
}

async function fetchHealth(): Promise<ServerHealthInfo | null> {
  try {
    const res = await fetch(`${apiBase()}/health`, { cache: 'no-store' });
    const body = (await res.json().catch(() => null)) as ServerHealthInfo | null;
    if (!body) return null;
    if (!res.ok) return { ...body, ok: false };
    return body;
  } catch {
    return null;
  }
}

async function tick() {
  if (inFlight) return;
  inFlight = true;
  try {
    const info = await fetchHealth();
    if (!info) {
      clearForceReloadTimer();
      setState({
        status: state.status === 'restarting' ? 'restarting' : 'down',
        outdatedSince: null,
        forceReloadAt: null,
      });
      return;
    }

    if (info.shuttingDown || info.ok === false) {
      clearForceReloadTimer();
      setState({
        status: 'restarting',
        serverVersion: info.version ?? state.serverVersion,
        outdatedSince: null,
        forceReloadAt: null,
      });
      return;
    }

    const serverVersion = info.version ?? null;
    const wasRestarting = state.status === 'restarting' || state.status === 'down';
    const mismatch = versionsDiffer(serverVersion);

    // Server came back on a different build — reload immediately so the iframe gets new assets.
    if (wasRestarting && mismatch && !recentlyForcedReload()) {
      setState({
        status: 'outdated',
        serverVersion,
        lastOkAt: Date.now(),
        outdatedSince: Date.now(),
        forceReloadAt: Date.now(),
      });
      reloadApp('post-restart-version-bump');
      return;
    }

    if (mismatch) {
      const since = state.outdatedSince ?? Date.now();
      const forceAt = since + OUTDATED_GRACE_MS;
      setState({
        status: 'outdated',
        serverVersion,
        lastOkAt: Date.now(),
        outdatedSince: since,
        forceReloadAt: forceAt,
      });
      if (Date.now() >= forceAt && !recentlyForcedReload()) {
        reloadApp('outdated-grace');
        return;
      }
      scheduleForceReload(forceAt);
      return;
    }

    clearForceReloadTimer();
    setState({
      status: 'ok',
      serverVersion,
      lastOkAt: Date.now(),
      outdatedSince: null,
      forceReloadAt: null,
    });
  } finally {
    inFlight = false;
  }
}

function pollDelayMs() {
  if (state.status === 'outdated') return POLL_OUTDATED_MS;
  return state.status === 'ok' ? POLL_ONLINE_MS : POLL_OFFLINE_MS;
}

function restartPollLoop() {
  if (!started) return;
  if (pollTimer != null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
  pollTimer = window.setInterval(() => {
    void tick();
  }, pollDelayMs());
}

function start() {
  if (started) return;
  started = true;
  void tick();
  restartPollLoop();

  const onVisible = () => {
    if (document.visibilityState === 'visible') void tick();
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return state;
}

/** Called when the realtime channel reports the server is going down. */
export function markServerShuttingDown() {
  clearForceReloadTimer();
  setState({
    status: 'restarting',
    outdatedSince: null,
    forceReloadAt: null,
  });
  void tick();
}

export function useAppHealth() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    ...snapshot,
    bootVersion: BOOT_VERSION,
    online: snapshot.status === 'ok',
    restarting: snapshot.status === 'restarting' || snapshot.status === 'down',
    outdated: snapshot.status === 'outdated',
  };
}

export function getBootAppVersion(): string {
  return BOOT_VERSION;
}
