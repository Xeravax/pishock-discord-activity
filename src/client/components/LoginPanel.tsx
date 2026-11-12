import { useState, type CSSProperties } from 'react';
import { PiShockAuthDisclaimer } from './PiShockAuthDisclaimer';

type Props = {
  linking: boolean;
  loginUrl: string | null;
  error: string | null;
  onStart: () => void;
  onOpen: () => void;
  onRefresh: () => void;
  onManualSubmit?: (input: { username: string; apiKey: string }) => void | Promise<void>;
  /** Clears a failed manual-link message as the user edits either field. */
  onClearManualError?: () => void;
  manualBusy?: boolean;
  manualError?: string | null;
};

const fieldStyle: CSSProperties = {
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 8,
  padding: '10px 12px',
  outline: 'none',
  width: '100%',
};

/** Compact start CTA for the link dialog (waiting state uses PiShockLinkingScreen). */
export function LoginPanel({
  linking,
  loginUrl,
  error,
  onStart,
  onOpen,
  onRefresh,
  onManualSubmit,
  onClearManualError,
  manualBusy,
  manualError,
}: Props) {
  const [username, setUsername] = useState('');
  const [apiKey, setApiKey] = useState('');
  const canManual =
    Boolean(onManualSubmit) && username.trim().length > 0 && apiKey.trim().length > 0;

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
            disabled={linking || manualBusy}
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

      {onManualSubmit ? (
        <div className="pishock-link-panel__manual">
          <div className="text-secondary text-subtitle2">Or paste an existing API key</div>
          <p className="text-grey-5 text-body2" style={{ marginTop: 4, marginBottom: 10 }}>
            Use your PiShock username and a named API key from the website. We store it encrypted
            until it stops working (same as auto-created keys).
          </p>
          {manualError ? (
            <div className="auth-boot__error" style={{ marginBottom: 12 }}>
              <div className="auth-boot__error-title">Couldn’t link key</div>
              <p>{manualError}</p>
            </div>
          ) : null}
          <form
            className="column q-gutter-sm"
            onSubmit={(e) => {
              e.preventDefault();
              if (!canManual || linking || manualBusy || !onManualSubmit) return;
              void onManualSubmit({
                username: username.trim(),
                apiKey: apiKey.trim(),
              });
            }}
          >
            <input
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                onClearManualError?.();
              }}
              placeholder="PiShock username"
              autoComplete="username"
              className="bg-dark text-grey-3"
              style={fieldStyle}
              disabled={linking || manualBusy}
            />
            <input
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                onClearManualError?.();
              }}
              placeholder="API key"
              autoComplete="off"
              spellCheck={false}
              className="bg-dark text-grey-3"
              style={fieldStyle}
              disabled={linking || manualBusy}
            />
            <button
              type="submit"
              className="q-btn q-btn-item non-selectable no-outline text-secondary bg-dark q-btn--outline q-btn--rectangle q-btn--actionable"
              disabled={!canManual || linking || manualBusy}
            >
              <span className="q-btn__wrapper col row q-anchor--skip">
                <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row no-wrap">
                  {manualBusy ? (
                    <i className="q-icon on-left mdi mdi-loading mdi-spin" aria-hidden />
                  ) : (
                    <i className="q-icon on-left mdi mdi-key-variant" aria-hidden />
                  )}
                  <span className="block">{manualBusy ? 'Validating…' : 'Link with API key'}</span>
                </span>
              </span>
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
