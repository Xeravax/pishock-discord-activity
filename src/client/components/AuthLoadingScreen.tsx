import { AppVersionBadge } from './AppVersionBadge';

type Props = {
  progress: number;
  label: string;
  error?: string | null;
};

/** Full-viewport Discord auth / boot splash — centered to match the control experience */
export function AuthLoadingScreen({ progress, label, error }: Props) {
  const pct = Math.max(0, Math.min(100, Math.round(progress)));

  return (
    <div className="auth-boot" role="status" aria-live="polite" aria-busy={!error}>
      <div className="auth-boot__glow" aria-hidden />
      <div className="auth-boot__panel">
        <div className="auth-boot__mark" aria-hidden>
          <i className="q-icon mdi mdi-flash auth-boot__bolt" />
        </div>
        <h1 className="auth-boot__brand auth-boot__brand-row">
          <span className="auth-boot__brand-name">
            Pi<span>Shock</span>
          </span>
          <AppVersionBadge />
        </h1>
        <p className="auth-boot__sub">Discord Activity</p>

        {error ? (
          <div className="auth-boot__error">
            <div className="auth-boot__error-title">Couldn’t connect</div>
            <p>{error}</p>
          </div>
        ) : (
          <>
            <div className="auth-boot__bar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <div className="auth-boot__bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="auth-boot__meta">
              <span className="auth-boot__label">{label}</span>
              <span className="auth-boot__pct">{pct}%</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
