import { useState } from 'react';
import { AppVersionBadge } from './AppVersionBadge';
import { PiShockAuthDisclaimer } from './PiShockAuthDisclaimer';

export type SetupChoices = {
  wantsDiscordShare: boolean;
};

type Props = {
  discordName: string;
  onComplete: (choices: SetupChoices) => void;
  onSkipToLogin: (choices: SetupChoices) => void;
};

const STEPS = [
  {
    title: 'Authentication — read this first',
    body: (
      <>
        <PiShockAuthDisclaimer />
        <p>
          Your PiShock <strong>password never enters Discord</strong>. Linking opens PiShock&apos;s
          own browser login page; only the session token PiShock returns is kept (encrypted).
        </p>
      </>
    ),
  },
  {
    title: 'How linking works',
    body: (
      <>
        <p>
          This activity opens a <strong>browser login page</strong> from PiShock (not Discord). Sign
          in there with your PiShock account.
        </p>
        <ol className="setup-steps-list">
          <li>A PiShock login URL opens in your browser</li>
          <li>Log in on that page (password never enters Discord)</li>
          <li>Come back here — we detect the successful login</li>
          <li>Confirm “Is this your PiShock account?” before anything is linked</li>
        </ol>
      </>
    ),
  },
  {
    title: 'Discord Shockers (optional)',
    body: (
      <>
        <p>
          After linking, you can opt shockers into <strong>Discord Shockers</strong> so other people
          in this activity can control them (with your limits and pause/block controls).
        </p>
        <p className="text-grey-5">
          You can still control other people’s Discord Shockers without linking. Linking is only
          required to receive shocks or use your own devices.
        </p>
      </>
    ),
  },
] as const;

/** First-time link intro — same boot aesthetic as Discord / PiShock auth. */
export function SetupWizard({ discordName, onComplete, onSkipToLogin }: Props) {
  const [step, setStep] = useState(0);
  const [wantsDiscordShare, setWantsDiscordShare] = useState(true);

  const last = step >= STEPS.length - 1;
  const current = STEPS[step]!;

  return (
    <div className="auth-boot" role="dialog" aria-modal="true" aria-labelledby="setup-wizard-title">
      <div className="auth-boot__glow" aria-hidden />
      <div className="auth-boot__panel auth-boot__panel--wide">
        <div className="auth-boot__mark" aria-hidden>
          <i className="q-icon mdi mdi-flash auth-boot__bolt" />
        </div>
        <h1 className="auth-boot__brand auth-boot__brand-row">
          <span className="auth-boot__brand-name">
            Pi<span>Shock</span>
          </span>
          <AppVersionBadge />
        </h1>
        <p className="auth-boot__sub">
          First-time setup · {discordName} · {step + 1}/{STEPS.length}
        </p>

        <h2 id="setup-wizard-title" className="auth-boot__heading">
          {current.title}
        </h2>
        <div className="auth-boot__hint setup-wizard-body">{current.body}</div>

        {last ? (
          <label className="auth-boot__check">
            <input
              type="checkbox"
              checked={wantsDiscordShare}
              onChange={(e) => setWantsDiscordShare(e.target.checked)}
            />
            <span>
              After I link, ask which shockers to share in Discord Shockers
            </span>
          </label>
        ) : null}

        <div className="auth-boot__actions">
          <button
            type="button"
            className="q-btn q-btn-item non-selectable no-outline text-grey-5 q-btn--flat q-btn--rectangle q-btn--actionable q-btn--dense"
            onClick={() => onSkipToLogin({ wantsDiscordShare })}
          >
            <span className="q-btn__wrapper col row q-anchor--skip">
              <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                <span className="block">Skip intro</span>
              </span>
            </span>
          </button>
          {step > 0 ? (
            <button
              type="button"
              className="q-btn q-btn-item non-selectable no-outline text-secondary bg-dark q-btn--outline q-btn--rectangle q-btn--actionable"
              onClick={() => setStep((s) => s - 1)}
            >
              <span className="q-btn__wrapper col row q-anchor--skip">
                <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                  <span className="block">Back</span>
                </span>
              </span>
            </button>
          ) : null}
          <button
            type="button"
            className="q-btn q-btn-item non-selectable no-outline bg-secondary text-dark q-btn--standard q-btn--rectangle q-btn--actionable"
            onClick={() => {
              if (!last) {
                setStep((s) => s + 1);
                return;
              }
              onComplete({ wantsDiscordShare });
            }}
          >
            <span className="q-btn__wrapper col row q-anchor--skip">
              <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                <span className="block">{last ? 'Continue to login' : 'Next'}</span>
              </span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function loadSetupPrefs(discordUserId: string): SetupChoices & { seen: boolean } {
  try {
    const raw = localStorage.getItem(`pishock-setup:${discordUserId}`);
    if (!raw) return { seen: false, wantsDiscordShare: true };
    const parsed = JSON.parse(raw) as { seen?: boolean; wantsDiscordShare?: boolean };
    return {
      seen: Boolean(parsed.seen),
      wantsDiscordShare: parsed.wantsDiscordShare !== false,
    };
  } catch {
    return { seen: false, wantsDiscordShare: true };
  }
}

export function saveSetupPrefs(discordUserId: string, choices: SetupChoices) {
  localStorage.setItem(
    `pishock-setup:${discordUserId}`,
    JSON.stringify({ seen: true, wantsDiscordShare: choices.wantsDiscordShare }),
  );
}
