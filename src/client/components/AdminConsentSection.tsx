import { useState } from 'react';
import type { AdminConsentState, AdminConsentStepResult } from '../safety';

type Props = {
  consent: AdminConsentState;
  onStep: (step: 1 | 2 | 3, nonce?: string, phrase?: string) => Promise<AdminConsentStepResult>;
  onRevoke: () => Promise<void>;
};

const PROMPTS: Array<{ title: string; body: string[]; confirm: string }> = [
  {
    title: 'Let admins go past your limits?',
    body: [
      'Admins of this activity can already skip soft rules like cooldowns, your shock budget, favorites only and approve-each. Every time they do, it is logged in red and you are notified.',
      'This permission goes further: it lets admins send commands ABOVE your Activity limits, share limits and per-person limits.',
    ],
    confirm: 'I understand — continue',
  },
  {
    title: 'Please read the risks',
    body: [
      'With this on, an admin could send shocks up to your PiShock device maximum — the only limit left is what you set on PiShock itself.',
      'It covers every admin of this app, including admins added later. E-STOP, pauses, blocks and required warnings still always work.',
      'You can turn it off at any time with one tap, and it applies immediately.',
    ],
    confirm: 'I accept these risks',
  },
  {
    title: 'Final confirmation',
    body: ['Type the phrase below to give consent.'],
    confirm: 'Give consent',
  },
];

/** Extra features → Admin access: consent via three separate prompts; revoke is one tap. */
export function AdminConsentSection({ consent, onStep, onRevoke }: Props) {
  const [prompt, setPrompt] = useState<0 | 1 | 2 | 3>(0);
  const [nonce, setNonce] = useState<string | undefined>();
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setPrompt(0);
    setNonce(undefined);
    setPhrase('');
  };

  /** "Allow…" only opens prompt 1; every confirm below is one server-enforced step. */
  const start = () => {
    setError(null);
    setPrompt(1);
  };

  const confirm = async () => {
    if (prompt === 0) return;
    setError(null);
    setBusy(true);
    try {
      const res =
        prompt === 1
          ? await onStep(1)
          : prompt === 2
            ? await onStep(2, nonce)
            : await onStep(3, nonce, phrase);
      if (res.complete) {
        close();
      } else {
        setNonce(res.nonce);
        setPrompt((prompt + 1) as 2 | 3);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // A wrong phrase can be retyped; anything else restarts from prompt 1.
      if (prompt !== 3) close();
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setError(null);
    setBusy(true);
    try {
      await onRevoke();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const shown = prompt === 0 ? null : PROMPTS[prompt - 1]!;
  const isLast = prompt === 3;

  return (
    <div className="ps-callout safety-admin">
      <div className="safety-admin__status">
        <span>
          <i className="q-icon mdi mdi-shield-crown-outline" aria-hidden />{' '}
          <strong>Admin access to your limits:</strong>{' '}
          {consent.granted ? (
            <span className="text-negative">
              ON
              {consent.grantedAt ? ` since ${new Date(consent.grantedAt).toLocaleString()}` : ''}
            </span>
          ) : (
            'off'
          )}
        </span>
        {consent.granted ? (
          <button type="button" className="safety-btn safety-btn--accept" disabled={busy} onClick={() => void revoke()}>
            Turn off now
          </button>
        ) : (
          <button type="button" className="safety-btn" disabled={busy} onClick={start}>
            Allow…
          </button>
        )}
      </div>
      <p className="log-privacy__note" style={{ marginBottom: 0 }}>
        Admins can always skip cooldowns, budget, favorites only and approve-each (logged in red, you
        get notified). Going <em>above your limits</em> needs this extra consent.
      </p>
      {error ? (
        <div className="ps-callout ps-callout--error" role="alert" style={{ marginTop: 8 }}>
          {error}
        </div>
      ) : null}

      {shown ? (
        <div className="ps-dialog-root safety-checkin-root" role="alertdialog" aria-modal="true" aria-labelledby="admin-consent-title">
          <div className="ps-dialog-backdrop" />
          <div className="safety-checkin">
            <i className="q-icon mdi mdi-shield-alert-outline safety-checkin__icon" aria-hidden style={{ color: 'var(--ps-danger-soft)' }} />
            <span className="text-caption text-grey-5">Confirmation {prompt} of 3</span>
            <h2 id="admin-consent-title">{shown.title}</h2>
            {shown.body.map((line) => (
              <p key={line}>{line}</p>
            ))}
            {isLast ? (
              <input
                className="safety-admin__phrase"
                value={phrase}
                placeholder={consent.phrase}
                aria-label={`Type ${consent.phrase}`}
                onChange={(e) => setPhrase(e.target.value)}
                autoFocus
              />
            ) : null}
            {error ? (
              <div className="ps-callout ps-callout--error" role="alert" style={{ width: '100%' }}>
                {error}
              </div>
            ) : null}
            <div className="safety-approval__actions" style={{ width: '100%' }}>
              <button type="button" className="safety-btn" disabled={busy} onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="safety-btn safety-btn--danger"
                disabled={busy || (isLast && phrase.trim().toUpperCase() !== consent.phrase)}
                onClick={() => void confirm()}
              >
                {shown.confirm}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
