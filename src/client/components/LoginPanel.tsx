import { PiShockAuthDisclaimer } from './PiShockAuthDisclaimer';

type Props = {
  linking: boolean;
  loginUrl: string | null;
  error: string | null;
  onStart: () => void;
  onOpen: () => void;
  onRefresh: () => void;
};

/** Compact start CTA for the link dialog (waiting state uses PiShockLinkingScreen). */
export function LoginPanel({ linking, loginUrl, error, onStart, onOpen, onRefresh }: Props) {
  return (
    <section className="pishock-link-panel">
      <PiShockAuthDisclaimer compact />
      <p className="text-grey-5 text-body2">
        Continue only if you accept that. Your password never enters this activity.
      </p>
      {error ? (
        <div className="auth-boot__error" style={{ marginBottom: 12 }}>
          <div className="auth-boot__error-title">Couldn’t start login</div>
          <p>{error}</p>
        </div>
      ) : null}
      <div className="row q-gutter-sm" style={{ flexWrap: 'wrap' }}>
        {!loginUrl ? (
          <button
            type="button"
            className="q-btn q-btn-item non-selectable no-outline bg-secondary text-dark q-btn--standard q-btn--rectangle q-btn--actionable"
            disabled={linking}
            onClick={onStart}
          >
            <span className="q-btn__wrapper col row q-anchor--skip">
              <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row no-wrap">
                {linking ? (
                  <i className="q-icon on-left mdi mdi-loading mdi-spin" aria-hidden />
                ) : (
                  <i className="q-icon on-left mdi mdi-open-in-new" aria-hidden />
                )}
                <span className="block">{linking ? 'Opening browser…' : 'Connect PiShock'}</span>
              </span>
            </span>
          </button>
        ) : (
          <>
            <button
              type="button"
              className="q-btn q-btn-item non-selectable no-outline bg-secondary text-dark q-btn--standard q-btn--rectangle q-btn--actionable"
              onClick={onOpen}
            >
              <span className="q-btn__wrapper col row q-anchor--skip">
                <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                  <span className="block">Open PiShock login</span>
                </span>
              </span>
            </button>
            <button
              type="button"
              className="q-btn q-btn-item non-selectable no-outline text-secondary bg-dark q-btn--outline q-btn--rectangle q-btn--actionable"
              onClick={onRefresh}
            >
              <span className="q-btn__wrapper col row q-anchor--skip">
                <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                  <span className="block">I finished logging in</span>
                </span>
              </span>
            </button>
          </>
        )}
      </div>
    </section>
  );
}
