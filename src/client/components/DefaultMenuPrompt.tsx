import { AppVersionBadge } from './AppVersionBadge';
import type { DefaultStartMenu } from '../defaultMenuPrefs';

type Props = {
  discordName: string;
  busy?: boolean;
  /** When set, show a dismiss control (e.g. changing preference from the menu). */
  onDismiss?: () => void;
  onChoose: (menu: DefaultStartMenu) => void;
};

/** Ask a linked user which controller menu should open on launch. */
export function DefaultMenuPrompt({ discordName, busy, onDismiss, onChoose }: Props) {
  return (
    <div className="auth-boot" role="dialog" aria-modal="true" aria-labelledby="default-menu-title">
      <div className="auth-boot__glow" aria-hidden />
      <div className="auth-boot__panel auth-boot__panel--wide">
        <div className="auth-boot__mark" aria-hidden>
          <i className="q-icon mdi mdi-view-dashboard-outline auth-boot__bolt" />
        </div>
        <h1 className="auth-boot__brand auth-boot__brand-row">
          <span className="auth-boot__brand-name">
            Pi<span>Shock</span>
          </span>
          <AppVersionBadge />
        </h1>
        <p className="auth-boot__sub">Welcome back · {discordName}</p>

        <h2 id="default-menu-title" className="auth-boot__heading">
          What should open by default?
        </h2>
        <p className="auth-boot__hint">
          Pick the menu you land on when you join this activity. You can change this later in the
          menu.
        </p>

        <div className="auth-boot__actions auth-boot__actions--stack">
          <button
            type="button"
            className="q-btn q-btn-item non-selectable no-outline bg-secondary text-dark q-btn--standard q-btn--rectangle q-btn--actionable"
            disabled={busy}
            onClick={() => onChoose('friends')}
          >
            <span className="q-btn__wrapper col row q-anchor--skip">
              <span className="q-btn__content text-center col items-center q-anchor--skip justify-center column">
                <span className="block">Discord Shockers</span>
                <span className="text-caption" style={{ opacity: 0.85 }}>
                  The menu to control other Discord users who have shared some or all of their devices.
                </span>
              </span>
            </span>
          </button>
          <button
            type="button"
            className="q-btn q-btn-item non-selectable no-outline text-secondary bg-dark q-btn--outline q-btn--rectangle q-btn--actionable"
            disabled={busy}
            onClick={() => onChoose('own')}
          >
            <span className="q-btn__wrapper col row q-anchor--skip">
              <span className="q-btn__content text-center col items-center q-anchor--skip justify-center column">
                <span className="block">My Shockers</span>
                <span className="text-caption" style={{ opacity: 0.75 }}>
                  Your own devices linked to your PiShock account.
                </span>
              </span>
            </span>
          </button>
          {onDismiss ? (
            <button
              type="button"
              className="q-btn q-btn-item non-selectable no-outline text-grey-5 bg-transparent q-btn--flat q-btn--rectangle q-btn--actionable"
              disabled={busy}
              onClick={onDismiss}
            >
              <span className="q-btn__wrapper col row q-anchor--skip">
                <span className="q-btn__content text-center col items-center q-anchor--skip justify-center">
                  Keep current
                </span>
              </span>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
