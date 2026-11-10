import { useAppHealth } from '../hooks/useAppHealth';

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
      : status === 'restarting'
        ? 'Restarting'
        : status === 'down'
          ? 'Unreachable'
          : 'Checking';

  return (
    <span
      className={`app-version-badge app-version-badge--${status}`}
      title={`Build ${label} · ${statusLabel}`}
    >
      <span className="app-version-badge__dot" aria-hidden />
      <span className="app-version-badge__text">{label}</span>
    </span>
  );
}

/** Full-screen wait while the API is down or the server announced shutdown. */
export function AppVersionWatch() {
  const { restarting, status } = useAppHealth();

  if (!restarting) return null;

  return (
    <div className="app-restart-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="app-restart-overlay__glow" aria-hidden />
      <div className="app-restart-overlay__panel">
        <div className="app-restart-overlay__spinner" aria-hidden />
        <div className="app-restart-overlay__title">
          {status === 'restarting' ? 'App is restarting…' : 'Reconnecting…'}
        </div>
        <p className="app-restart-overlay__hint">
          Waiting for the server to come back online. Checking every 5 seconds.
        </p>
      </div>
    </div>
  );
}
