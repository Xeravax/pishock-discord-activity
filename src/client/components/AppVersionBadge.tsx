import { getBootAppVersion, useAppVersionCheck } from '../hooks/useAppVersionCheck';

type BadgeProps = {
  /** Hide during PIP so the last-hit UI stays clean */
  hidden?: boolean;
};

/** Inline build identity — place next to the app name in headers / brand blocks. */
export function AppVersionBadge({ hidden }: BadgeProps) {
  if (hidden) return null;
  const version = getBootAppVersion();
  return (
    <span className="app-version-badge" title={`Build ${version}`}>
      {version}
    </span>
  );
}

/** Single root mount: poll deploy version and reload when the running server changes. */
export function AppVersionWatch() {
  const { outdated } = useAppVersionCheck();
  if (!outdated) return null;
  return (
    <div className="app-version-outdated" role="status">
      New version available — reloading…
    </div>
  );
}
