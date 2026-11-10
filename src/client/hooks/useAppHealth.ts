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

export type AppHealthStatus = 'unknown' | 'ok' | 'down' | 'restarting';

type HealthState = {
  status: AppHealthStatus;
  serverVersion: string | null;
  lastOkAt: number | null;
};

const BOOT_VERSION = String(import.meta.env.VITE_APP_VERSION || 'dev');
const POLL_ONLINE_MS = 60_000;
const POLL_OFFLINE_MS = 5_000;

let state: HealthState = {
  status: 'unknown',
  serverVersion: null,
  lastOkAt: null,
};

const listeners = new Set<() => void>();
let pollTimer: number | null = null;
let inFlight = false;
let started = false;

function emit() {
  for (const listener of listeners) listener();
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
      setState({
        status: state.status === 'restarting' ? 'restarting' : 'down',
      });
      return;
    }
    if (info.shuttingDown || info.ok === false) {
      setState({
        status: 'restarting',
        serverVersion: info.version ?? state.serverVersion,
      });
      return;
    }
    setState({
      status: 'ok',
      serverVersion: info.version ?? null,
      lastOkAt: Date.now(),
    });
  } finally {
    inFlight = false;
  }
}

function pollDelayMs() {
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
  setState({ status: 'restarting' });
  void tick();
}

export function useAppHealth() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    ...snapshot,
    bootVersion: BOOT_VERSION,
    online: snapshot.status === 'ok',
    restarting: snapshot.status === 'restarting' || snapshot.status === 'down',
  };
}

export function getBootAppVersion(): string {
  return BOOT_VERSION;
}
