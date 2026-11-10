import { useSyncExternalStore } from 'react';

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
  /** Kept for badge/UI compatibility — outdated blocks immediately (no grace). */
  forceReloadAt: number | null;
};

const BOOT_VERSION = String(import.meta.env.VITE_APP_VERSION || 'dev');
const POLL_ONLINE_MS = 30_000;
const POLL_OFFLINE_MS = 5_000;
const POLL_OUTDATED_MS = 15_000;

function healthUrl(): string {
  const embedded = new URLSearchParams(window.location.search).has('frame_id');
  return `${embedded ? '/.proxy/api' : '/api'}/health`;
}

let state: HealthState = {
  status: 'unknown',
  serverVersion: null,
  lastOkAt: null,
  outdatedSince: null,
  forceReloadAt: null,
};

const listeners = new Set<() => void>();
let pollTimer: number | null = null;
let inFlight = false;
let started = false;

function emit() {
  for (const listener of listeners) listener();
}

function versionsDiffer(serverVersion: string | null | undefined): boolean {
  if (!serverVersion) return false;
  if (BOOT_VERSION === 'dev' && serverVersion === 'dev') return false;
  return serverVersion !== BOOT_VERSION;
}

/**
 * Soft reload only helps for non-embedded browsers. Discord Activities often cannot
 * re-auth after reload — prefer closing and relaunching the activity.
 */
export function reloadApp(_reason = 'version'): void {
  window.location.reload();
}

function setState(patch: Partial<HealthState>) {
  state = { ...state, ...patch };
  emit();
  restartPollLoop();
}

/** Mark the client outdated immediately (e.g. API returned 426). */
export function markClientOutdated(serverVersion?: string | null) {
  const now = Date.now();
  setState({
    status: 'outdated',
    serverVersion: serverVersion ?? state.serverVersion,
    lastOkAt: now,
    outdatedSince: state.outdatedSince ?? now,
    forceReloadAt: now,
  });
}

async function fetchHealth(): Promise<ServerHealthInfo | null> {
  try {
    const res = await fetch(healthUrl(), {
      cache: 'no-store',
      headers: { 'X-Client-Version': BOOT_VERSION },
    });
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
      setState({
        status: state.status === 'restarting' ? 'restarting' : 'down',
        outdatedSince: null,
        forceReloadAt: null,
      });
      return;
    }

    if (info.shuttingDown || info.ok === false) {
      setState({
        status: 'restarting',
        serverVersion: info.version ?? state.serverVersion,
        outdatedSince: null,
        forceReloadAt: null,
      });
      return;
    }

    const serverVersion = info.version ?? null;
    const mismatch = versionsDiffer(serverVersion);

    if (mismatch) {
      const now = Date.now();
      setState({
        status: 'outdated',
        serverVersion,
        lastOkAt: now,
        outdatedSince: state.outdatedSince ?? now,
        forceReloadAt: now,
      });
      return;
    }

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
