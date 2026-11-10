import { AppVersionBadge } from './AppVersionBadge';

type Props = {
  pishockUserId: number;
  hubNames: string[];
  discordName: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export function LinkConfirmPanel({
  pishockUserId,
  hubNames,
  discordName,
  busy,
  error,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div className="auth-boot" role="dialog" aria-modal="true" aria-labelledby="link-confirm-title">
      <div className="auth-boot__glow" aria-hidden />
      <div className="auth-boot__panel auth-boot__panel--wide">
        <div className="auth-boot__mark" aria-hidden>
          <i className="q-icon mdi mdi-account-check auth-boot__bolt" />
        </div>
        <h1 className="auth-boot__brand auth-boot__brand-row">
          <span className="auth-boot__brand-name">
            Pi<span>Shock</span>
          </span>
          <AppVersionBadge />
        </h1>
        <p className="auth-boot__sub">Confirm account</p>

        <h2 id="link-confirm-title" className="auth-boot__heading">
          Is this your PiShock account?
        </h2>
        <p className="auth-boot__hint">
          PiShock confirmed a successful login. Link it to{' '}
          <strong className="text-grey-3">{discordName}</strong> only if this is you.
        </p>

        {error ? (
          <div className="auth-boot__error">
            <div className="auth-boot__error-title">Couldn’t link</div>
            <p>{error}</p>
          </div>
        ) : null}

        <div className="auth-boot__account">
          <div className="auth-boot__account-label">PiShock account</div>
          <div className="auth-boot__account-id">User ID {pishockUserId}</div>
          {hubNames.length > 0 ? (
            <div className="auth-boot__account-hubs">Hubs: {hubNames.join(', ')}</div>
          ) : (
            <div className="auth-boot__account-hubs">
              Hub names unavailable — User ID is enough to verify this is you.
            </div>
          )}
        </div>

        <p className="auth-boot__caption">
          Only confirm if this is your account. Cancel discards the login and does not link anything.
        </p>

        <div className="auth-boot__actions">
          <button
            type="button"
            className="q-btn q-btn-item non-selectable no-outline text-grey-4 bg-dark q-btn--outline q-btn--rectangle q-btn--actionable"
            disabled={busy}
            onClick={onCancel}
          >
            <span className="q-btn__wrapper col row q-anchor--skip">
              <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                <span className="block">No, cancel</span>
              </span>
            </span>
          </button>
          <button
            type="button"
            className="q-btn q-btn-item non-selectable no-outline bg-secondary text-dark q-btn--standard q-btn--rectangle q-btn--actionable"
            disabled={busy}
            onClick={onConfirm}
          >
            <span className="q-btn__wrapper col row q-anchor--skip">
              <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row no-wrap">
                {busy ? <i className="q-icon on-left mdi mdi-loading mdi-spin" aria-hidden /> : null}
                <span className="block">{busy ? 'Linking…' : 'Yes, link this account'}</span>
              </span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
