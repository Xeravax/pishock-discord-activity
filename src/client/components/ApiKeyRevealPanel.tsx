import { useState } from 'react';
import { AppVersionBadge } from './AppVersionBadge';
import { SecretValue } from './SecretValue';

type Props = {
  apiKey: string;
  apiKeyName: string;
  expiresAt?: string | null;
  pishockUsername?: string | null;
  onContinue: () => void;
};

function formatExpiry(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** One-time reveal of the newly created PiShock API key. */
export function ApiKeyRevealPanel({
  apiKey,
  apiKeyName,
  expiresAt,
  pishockUsername,
  onContinue,
}: Props) {
  const [copied, setCopied] = useState(false);
  const expiryLabel = formatExpiry(expiresAt);

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="auth-boot" role="dialog" aria-modal="true" aria-labelledby="api-key-reveal-title">
      <div className="auth-boot__glow" aria-hidden />
      <div className="auth-boot__panel auth-boot__panel--wide">
        <div className="auth-boot__mark" aria-hidden>
          <i className="q-icon mdi mdi-key-variant auth-boot__bolt" />
        </div>
        <h1 className="auth-boot__brand auth-boot__brand-row">
          <span className="auth-boot__brand-name">
            Pi<span>Shock</span>
          </span>
          <AppVersionBadge />
        </h1>
        <p className="auth-boot__sub">API key created</p>

        <h2 id="api-key-reveal-title" className="auth-boot__heading">
          Save this key — shown once
        </h2>
        <p className="auth-boot__hint">
          A PiShock API key named <strong>{apiKeyName}</strong>
          {pishockUsername ? (
            <>
              {' '}
              for <strong>{pishockUsername}</strong>
            </>
          ) : null}{' '}
          was created and stored encrypted for this activity. It stays hidden until you click it.
          Copy it now if you want a backup — we will not show it again. It stays valid until you
          unlink or PiShock rejects it
          {expiryLabel ? <> (PiShock reports expiry {expiryLabel})</> : null}.
        </p>

        <div className="auth-boot__account auth-boot__api-key-box">
          <div className="auth-boot__account-label">API key</div>
          <SecretValue value={apiKey} label="API key" className="auth-boot__api-key" />
        </div>

        <div className="auth-boot__actions">
          <button
            type="button"
            className="q-btn q-btn-item non-selectable no-outline text-secondary bg-dark q-btn--outline q-btn--rectangle q-btn--actionable"
            onClick={() => void copyKey()}
          >
            <span className="q-btn__wrapper col row q-anchor--skip">
              <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                <span className="block">{copied ? 'Copied' : 'Copy key'}</span>
              </span>
            </span>
          </button>
          <button
            type="button"
            className="q-btn q-btn-item non-selectable no-outline bg-secondary text-dark q-btn--standard q-btn--rectangle q-btn--actionable"
            onClick={onContinue}
          >
            <span className="q-btn__wrapper col row q-anchor--skip">
              <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                <span className="block">Continue</span>
              </span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
