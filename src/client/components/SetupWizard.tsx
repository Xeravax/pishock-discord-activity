import { useState } from 'react';

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
    title: 'How linking works',
    body: (
      <>
        <p>
          When you continue, this activity opens a <strong>browser login page</strong> from PiShock
          (not Discord). Sign in there with your PiShock account.
        </p>
        <ol className="setup-steps-list">
          <li>A PiShock login URL opens in your browser</li>
          <li>Log in on that page (password never enters Discord)</li>
          <li>Come back to this activity — we detect the successful login</li>
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
          in this activity can control them through Discord (with your limits and pause/block
          controls).
        </p>
        <p className="text-grey-5">
          You can skip this and still shock other people’s Discord Shockers without linking. Linking
          is only required to receive shocks or use your own devices.
        </p>
      </>
    ),
  },
] as const;

export function SetupWizard({ discordName, onComplete, onSkipToLogin }: Props) {
  const [step, setStep] = useState(0);
  const [wantsDiscordShare, setWantsDiscordShare] = useState(true);

  const last = step >= STEPS.length - 1;
  const current = STEPS[step]!;

  return (
    <div className="column q-gutter-md setup-wizard">
      <div className="text-caption text-secondary">
        First-time setup · {discordName} · Step {step + 1} of {STEPS.length}
      </div>
      <div className="text-h6 text-secondary" style={{ fontFamily: 'geo, Oxanium, sans-serif' }}>
        {current.title}
      </div>
      <div className="text-body2 text-grey-4 setup-wizard-body">{current.body}</div>

      {last ? (
        <label className="row items-start no-wrap q-gutter-sm cursor-pointer">
          <input
            type="checkbox"
            checked={wantsDiscordShare}
            onChange={(e) => setWantsDiscordShare(e.target.checked)}
            style={{ marginTop: 4, accentColor: '#79c6db' }}
          />
          <span className="text-body2 text-grey-3">
            After I link, help me choose shockers to share in Discord Shockers
          </span>
        </label>
      ) : null}

      <div className="row q-gutter-sm justify-between" style={{ flexWrap: 'wrap' }}>
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
        <div className="row q-gutter-sm">
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
