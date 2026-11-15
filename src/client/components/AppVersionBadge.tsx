import { useCallback, useEffect, useState } from 'react';
import {
  reloadApp,
  useAppHealth,
} from '../hooks/useAppHealth';
import { isEmbedded } from '../api';
import { PsDialog } from './PsDialog';
import { ChangelogView } from './ChangelogView';
import type { AppReleaseNotes } from '../../shared/app-version';

type BadgeProps = {
  /** Hide during PIP so the last-hit UI stays clean */
  hidden?: boolean;
};

type VersionApiResponse = {
  version?: string;
  sha?: string;
  shortSha?: string;
  ref?: string;
  refType?: string;
  builtAt?: string;
  release?: AppReleaseNotes | null;
};

/** Centered build identity + live health indicator; click opens latest-version / changelog. */
export function AppVersionBadge({ hidden }: BadgeProps) {
  const { bootVersion, status, serverVersion } = useAppHealth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<VersionApiResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  const loadVersion = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/version', { cache: 'no-store' });
      const body = (await res.json().catch(() => null)) as VersionApiResponse | null;
      if (!res.ok || !body) {
        setLoadError('Could not load version details.');
        setInfo(null);
        return;
      }
      setInfo(body);
    } catch {
      setLoadError('Could not load version details.');
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadVersion();
  }, [open, loadVersion]);

  if (hidden) return null;

  const release = info?.release;
  const latestLabel = release?.version || info?.version || label;
  const notes = release?.notes?.trim() || '';

  return (
    <>
      <button
        type="button"
        className={`app-version-badge app-version-badge--${status} app-version-badge--button`}
        title={`Build ${label} · client ${bootVersion} · ${statusLabel}. Click for changelog.`}
        aria-label={`Version ${label}. Open latest version and changelog.`}
        onClick={() => setOpen(true)}
      >
        <span className="app-version-badge__dot" aria-hidden />
        <span className="app-version-badge__text">{label}</span>
      </button>

      <PsDialog open={open} title="Latest version" onClose={() => setOpen(false)} wide>
        <div className="app-version-panel">
          <div className="app-version-panel__hero">
            <div className="app-version-panel__label">Running</div>
            <div className="app-version-panel__version">{latestLabel}</div>
            {info?.builtAt ? (
              <div className="app-version-panel__meta">
                Built {new Date(info.builtAt).toLocaleString()}
                {info.shortSha ? ` · ${info.shortSha}` : ''}
                {info.ref ? ` · ${info.ref}` : ''}
              </div>
            ) : null}
            {release?.publishedAt ? (
              <div className="app-version-panel__meta">
                Released {new Date(release.publishedAt).toLocaleString()}
              </div>
            ) : null}
          </div>

          {loading ? (
            <p className="app-version-panel__hint">Loading changelog…</p>
          ) : loadError ? (
            <p className="app-version-panel__hint app-version-panel__hint--error">{loadError}</p>
          ) : notes ? (
            <ChangelogView markdown={notes} />
          ) : (
            <p className="app-version-panel__hint">
              {info?.refType === 'tag'
                ? 'No release notes were baked into this build.'
                : 'Branch builds do not include a GitHub Release changelog. Push to release to cut a versioned release.'}
            </p>
          )}

          {release?.url ? (
            <a
              className="app-version-panel__link"
              href={release.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              View on GitHub
            </a>
          ) : null}
        </div>
      </PsDialog>
    </>
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
