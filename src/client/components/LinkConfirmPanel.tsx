import { AppVersionBadge } from './AppVersionBadge';
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
          <strong className="text-grey-3">{discordName}</strong> only if this is you. Confirming
          creates a <strong>7-day named API key</strong> used for device control. Unlinking removes
          the key from this app. The key expires after 7 days or when you revoke it at PiShock.
        </p>

        {error ? (
          <div className="auth-boot__error">
            <div className="auth-boot__error-title">Couldn’t link</div>
            <p>{error}</p>
          </div>
        ) : null}

        <div className={`auth-boot__account${hasShowcase ? ' auth-boot__account--profile' : ''}`}>
          {hasShowcase ? (
            <div className="auth-boot__profile-showcase" aria-hidden={!avatarUrl && !bannerUrl}>
              <div
                className="auth-boot__profile-banner"
                style={bannerUrl ? { backgroundImage: `url(${bannerUrl})` } : undefined}
              />
              {avatarUrl ? (
                <img
                  className="auth-boot__profile-avatar"
                  src={avatarUrl}
                  alt=""
                  width={72}
                  height={72}
                  decoding="async"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="auth-boot__profile-avatar auth-boot__profile-avatar--placeholder">
                  <i className="q-icon mdi mdi-account" aria-hidden />
                </div>
              )}
            </div>
          ) : null}
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

        <PiShockAuthDisclaimer compact />

        <p className="auth-boot__caption">
          Only confirm if this is your account. Cancel discards the login and does not create an API
          key or link anything.
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
                <span className="block">
                  {busy ? 'Creating API key…' : 'Yes, create API key & link'}
                </span>
              </span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
