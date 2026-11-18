import { BrandHeader } from './BrandHeader';
import { PiShockAuthDisclaimer } from './PiShockAuthDisclaimer';

type Props = {
  pishockUserId: number;
  pishockUsername?: string | null;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  hubNames: string[];
  discordName: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export function LinkConfirmPanel({
  pishockUserId,
  pishockUsername,
  avatarUrl,
  bannerUrl,
  hubNames,
  discordName,
  busy,
  error,
  onConfirm,
  onCancel,
}: Props) {
  const hasShowcase = Boolean(avatarUrl || bannerUrl);

  return (
    <div className="auth-boot" role="dialog" aria-modal="true" aria-labelledby="link-confirm-title">
      <div className="auth-boot__glow" aria-hidden />
      <div className="auth-boot__panel auth-boot__panel--wide auth-boot__panel--sheet">
        <div className="auth-boot__sheet-body">
          <BrandHeader badgeIcon="mdi-account-check" sub="Confirm account" />

          <h2 id="link-confirm-title" className="auth-boot__heading">
            Is this your PiShock account?
          </h2>
          <p className="auth-boot__hint">
            PiShock confirmed a successful login. Link it to{' '}
            <strong className="text-grey-3">{discordName}</strong> only if this is you. Confirming
            creates a <strong>7-day named API key</strong> used for device control. Unlinking
            removes the key from this app. The key expires after 7 days or when you revoke it at
            PiShock.
          </p>

          {error ? (
            <div className="auth-boot__error">
              <div className="auth-boot__error-title">Couldn’t link</div>
              <p>{error}</p>
            </div>
          ) : null}

          <div className={`auth-boot__account${hasShowcase ? ' auth-boot__account--profile' : ''}`}>
            {hasShowcase ? (
              bannerUrl ? (
                <img
                  className="auth-boot__profile-banner"
                  src={bannerUrl}
                  alt=""
                  decoding="async"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="auth-boot__profile-banner auth-boot__profile-banner--empty" />
              )
            ) : null}
            <div className="auth-boot__account-row">
              {hasShowcase ? (
                avatarUrl ? (
                  <img
                    className="auth-boot__profile-avatar"
                    src={avatarUrl}
                    alt=""
                    width={80}
                    height={80}
                    decoding="async"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="auth-boot__profile-avatar auth-boot__profile-avatar--placeholder">
                    <i className="q-icon mdi mdi-account" aria-hidden />
                  </div>
                )
              ) : null}
              <div className="auth-boot__account-details">
                <div className="auth-boot__account-label">PiShock account</div>
                {pishockUsername ? (
                  <div className="auth-boot__account-id">{pishockUsername}</div>
                ) : null}
                <div className={pishockUsername ? 'auth-boot__account-hubs' : 'auth-boot__account-id'}>
                  User ID {pishockUserId}
                </div>
                {hubNames.length > 0 ? (
                  <div className="auth-boot__account-hubs">Hubs: {hubNames.join(', ')}</div>
                ) : (
                  <div className="auth-boot__account-hubs">
                    Hub names unavailable — User ID is enough to verify this is you.
                  </div>
                )}
              </div>
            </div>
          </div>

          <PiShockAuthDisclaimer compact />

          <p className="auth-boot__caption">
            Only accept if this is your account. Deny discards the login and does not create an API
            key or link anything.
          </p>
        </div>

        <div className="auth-boot__sheet-footer">
          <button
            type="button"
            className="q-btn q-btn-item non-selectable no-outline text-secondary bg-dark q-btn--outline q-btn--rectangle q-btn--actionable"
            disabled={busy}
            onClick={onCancel}
          >
            <span className="q-btn__wrapper col row q-anchor--skip">
              <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row no-wrap">
                <i className="q-icon on-left mdi mdi-close" aria-hidden />
                <span className="block">Deny</span>
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
                <i
                  className={`q-icon on-left mdi ${busy ? 'mdi-loading mdi-spin' : 'mdi-check'}`}
                  aria-hidden
                />
                <span className="block">{busy ? 'Linking…' : 'Accept'}</span>
              </span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
