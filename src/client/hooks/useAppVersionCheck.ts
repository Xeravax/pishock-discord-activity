import { useEffect, useRef, useState } from 'react';
import { apiBase } from '../api';

export type ServerVersionInfo = {
  ok: boolean;
  version: string;
  sha?: string;
  shortSha?: string;
  ref?: string;
  refType?: string;
  builtAt?: string;
};

const BOOT_VERSION = String(import.meta.env.VITE_APP_VERSION || 'dev');
const POLL_MS = 60_000;
const RELOAD_DELAY_MS = 2_500;

async function fetchServerVersion(): Promise<ServerVersionInfo | null> {
  try {
    const base = apiBase(); // /api or /.proxy/api
    const res = await fetch(`${base}/health`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as ServerVersionInfo;
  } catch {
    return null;
  }
}

/**
 * Poll /api/health for deploy version. Reloads when the running server
 * no longer matches the JS bundle that was loaded at boot.
 */
export function useAppVersionCheck(opts?: { enabled?: boolean }) {
  const enabled = opts?.enabled !== false;
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  const [outdated, setOutdated] = useState(false);
  const reloadingRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let reloadTimer: number | null = null;

    const apply = (info: ServerVersionInfo | null) => {
      if (cancelled || !info?.version) return;
      setServerVersion(info.version);
      if (info.version !== BOOT_VERSION) {
        setOutdated(true);
        if (!reloadingRef.current) {
          reloadingRef.current = true;
          reloadTimer = window.setTimeout(() => {
            // Hard navigation + cache bust so Discord Embedded App re-runs full authorize.
            const next = new URL(window.location.href);
            next.searchParams.set('_v', info.version);
            next.searchParams.set('_r', String(Date.now()));
            window.location.replace(next.toString());
          }, RELOAD_DELAY_MS);
        }
      } else {
        setOutdated(false);
      }
    };

    const tick = () => {
      void fetchServerVersion().then(apply);
    };

    tick();
    const id = window.setInterval(tick, POLL_MS);

    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      if (reloadTimer != null) window.clearTimeout(reloadTimer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [enabled]);

  return {
    bootVersion: BOOT_VERSION,
    serverVersion,
    outdated,
  };
}

export function getBootAppVersion(): string {
  return BOOT_VERSION;
}
