import { useEffect, useState } from 'react';
import {
  OUTDATED_GRACE_MS,
  reloadApp,
  useAppHealth,
} from '../hooks/useAppHealth';

type BadgeProps = {
  /** Hide during PIP so the last-hit UI stays clean */
  hidden?: boolean;
};

/** Centered build identity + live health indicator. */
export function AppVersionBadge({ hidden }: BadgeProps) {
  const { bootVersion, status, serverVersion } = useAppHealth();

  if (hidden) return null;

  const label = serverVersion || bootVersion;
  const statusLabel =
    status === 'ok'
      ? 'Online'
      : status === 'outdated'
        ? 'Update available'
        : status === 'restarting'
          ? 'Restarting'
          : status === 'down'
            ? 'Unreachable'
            : 'Checking';

  return (
    <span
      className={`app-version-badge app-version-badge--${status}`}
      title={`Build ${label} · client ${bootVersion} · ${statusLabel}`}
    >
      <span className="app-version-badge__dot" aria-hidden />
      <span className="app-version-badge__text">{label}</span>
    </span>
  );
}

function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min <= 0) return `${sec}s`;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

/** Full-screen wait while the API is down, restarting, or the client build is stale. */
export function AppVersionWatch() {
  const {
    restarting,
    outdated,
    status,
    bootVersion,
    serverVersion,
    forceReloadAt,
  } = useAppHealth();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!outdated || forceReloadAt == null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [outdated, forceReloadAt]);

  if (!restarting && !outdated) return null;

  const remainingMs =
    outdated && forceReloadAt != null ? Math.max(0, forceReloadAt - now) : 0;

  return (
    <div
      className={`app-restart-overlay${outdated ? ' app-restart-overlay--outdated' : ''}`}
      role="alertdialog"
      aria-live="assertive"
      aria-busy={restarting || undefined}
      aria-modal="true"
    >
      <div className="app-restart-overlay__glow" aria-hidden />
      <div className="app-restart-overlay__panel">
        <div className="app-restart-overlay__spinner" aria-hidden />
        {outdated ? (
          <>
            <div className="app-restart-overlay__title">Update required</div>
            <p className="app-restart-overlay__hint">
              This activity is still running build <strong>{bootVersion}</strong>, but the server
              is on <strong>{serverVersion || 'a newer build'}</strong>. Reload to pick up the
              update. If you stay on this version, the activity will restart automatically
              {forceReloadAt != null ? (
                <>
                  {' '}
                  in <strong>{formatCountdown(remainingMs)}</strong>
                </>
              ) : (
                <> soon</>
              )}
              .
            </p>
            <p className="app-restart-overlay__meta">
              Grace period {Math.round(OUTDATED_GRACE_MS / 60_000)} minutes after a version mismatch
              is detected.
            </p>
            <button
              type="button"
              className="app-restart-overlay__reload"
              onClick={() => reloadApp('user-click')}
            >
              Reload now
            </button>
          </>
        ) : (
          <>
            <div className="app-restart-overlay__title">
              {status === 'restarting' ? 'App is restarting…' : 'Reconnecting…'}
            </div>
            <p className="app-restart-overlay__hint">
              Waiting for the server to come back online. Checking every 5 seconds. When a new
              version is detected, this activity will reload automatically.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
