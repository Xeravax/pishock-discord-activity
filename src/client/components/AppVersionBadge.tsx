import { useAppVersionCheck } from '../hooks/useAppVersionCheck';

type Props = {
  /** Hide during PIP so the last-hit UI stays clean */
  hidden?: boolean;
};

/** Always-visible build identity + auto-reload when the server deploy changes. */
export function AppVersionBadge({ hidden }: Props) {
  const { bootVersion, outdated } = useAppVersionCheck({ enabled: !hidden });

  if (hidden) return null;

  return (
    <>
      <div className="app-version-badge" title={`Build ${bootVersion}`}>
        {bootVersion}
      </div>
      {outdated ? (
        <div className="app-version-outdated" role="status">
          New version available — reloading…
        </div>
      ) : null}
    </>
  );
}
