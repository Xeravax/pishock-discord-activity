import {
  reloadApp,
  useAppHealth,
} from '../hooks/useAppHealth';
import { isEmbedded } from '../api';

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
        ? 'Update required'
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

/** Full-screen wait while the API is down, restarting, or the client build is stale. */
export function AppVersionWatch() {
  const { restarting, outdated, status, bootVersion, serverVersion } = useAppHealth();

  if (!restarting && !outdated) return null;

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
        {outdated ? null : <div className="app-restart-overlay__spinner" aria-hidden />}
        {outdated ? (
          <>
            <div className="app-restart-overlay__title">New version available</div>
            <p className="app-restart-overlay__hint">
              This activity is still running build <strong>{bootVersion}</strong>, but the server
              is on <strong>{serverVersion || 'a newer build'}</strong>. Older builds are blocked.
            </p>
            <p className="app-restart-overlay__hint">
              {isEmbedded ? (
                <>
                  Discord cannot fully refresh an already-open activity. Close this activity, then
                  launch it again from Discord to load the new version.
                </>
              ) : (
                <>
                  Reload the page to pick up the new build. If controls stay stuck, close the tab
                  and open the activity again.
                </>
              )}
            </p>
            {!isEmbedded ? (
              <button
                type="button"
                className="app-restart-overlay__reload"
                onClick={() => reloadApp('user-click')}
              >
                Reload now
              </button>
            ) : (
              <p className="app-restart-overlay__meta">
                Close the activity window / panel, then reopen PiShock from Discord.
              </p>
            )}
          </>
        ) : (
          <>
            <div className="app-restart-overlay__title">
              {status === 'restarting' ? 'App is restarting…' : 'Reconnecting…'}
            </div>
            <p className="app-restart-overlay__hint">
              Waiting for the server to come back online. Checking every few seconds. When a new
              version is detected, you must relaunch the activity.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
