import { AppVersionBadge } from './AppVersionBadge';

type Props = {
  label?: string;
  error?: string | null;
  canReopen?: boolean;
  onReopen?: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
};

/** Full-bleed PiShock login wait — same visual language as Discord boot. */
export function PiShockLinkingScreen({
  label = 'Waiting for PiShock login…',
  error,
  canReopen,
  onReopen,
  onCancel,
  onRetry,
}: Props) {
  return (
    <div className="auth-boot" role="status" aria-live="polite" aria-busy={!error}>
      <div className="auth-boot__glow" aria-hidden />
      <div className="auth-boot__panel">
        <div className={`auth-boot__mark${error ? '' : ' auth-boot__mark--pulse'}`} aria-hidden>
          <i className="q-icon mdi mdi-flash auth-boot__bolt" />
        </div>
        <h1 className="auth-boot__brand auth-boot__brand-row">
          <span className="auth-boot__brand-name">
            Pi<span>Shock</span>
          </span>
          <AppVersionBadge />
        </h1>
        <p className="auth-boot__sub">Link account</p>

        {error ? (
          <div className="auth-boot__error">
            <div className="auth-boot__error-title">Login failed</div>
            <p>{error}</p>
          </div>
        ) : (
          <>
            <div className="auth-boot__bar auth-boot__bar--indeterminate" aria-hidden>
              <div className="auth-boot__bar-fill" />
            </div>
            <div className="auth-boot__meta auth-boot__meta--center">
              <span className="auth-boot__label">{label}</span>
            </div>
            <p className="auth-boot__hint">
              Finish signing in in your browser, then return here — we&apos;ll detect it
              automatically. After you confirm the account, we create a <strong>7-day API key</strong>{' '}
              (shown once) and store it encrypted.
            </p>
          </>
        )}

        <div className="auth-boot__actions">
          {error ? (
            <>
              {onRetry ? (
                <button
                  type="button"
                  className="q-btn q-btn-item non-selectable no-outline bg-secondary text-dark q-btn--standard q-btn--rectangle q-btn--actionable"
                  onClick={onRetry}
                >
                  <span className="q-btn__wrapper col row q-anchor--skip">
                    <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                      <span className="block">Try again</span>
                    </span>
                  </span>
                </button>
              ) : null}
              {onCancel ? (
                <button
                  type="button"
                  className="q-btn q-btn-item non-selectable no-outline text-secondary bg-dark q-btn--outline q-btn--rectangle q-btn--actionable"
                  onClick={onCancel}
                >
                  <span className="q-btn__wrapper col row q-anchor--skip">
                    <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                      <span className="block">Cancel</span>
                    </span>
                  </span>
                </button>
              ) : null}
            </>
          ) : (
            <>
              {canReopen && onReopen ? (
                <button
                  type="button"
                  className="q-btn q-btn-item non-selectable no-outline bg-secondary text-dark q-btn--standard q-btn--rectangle q-btn--actionable"
                  onClick={onReopen}
                >
                  <span className="q-btn__wrapper col row q-anchor--skip">
                    <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                      <span className="block">Reopen login</span>
                    </span>
                  </span>
                </button>
              ) : null}
              {onCancel ? (
                <button
                  type="button"
                  className="q-btn q-btn-item non-selectable no-outline text-secondary bg-dark q-btn--outline q-btn--rectangle q-btn--actionable"
                  onClick={onCancel}
                >
                  <span className="q-btn__wrapper col row q-anchor--skip">
                    <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                      <span className="block">Cancel</span>
                    </span>
                  </span>
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
