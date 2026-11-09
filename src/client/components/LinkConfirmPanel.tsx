type Props = {
  pishockUserId: number;
  hubNames: string[];
  discordName: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function LinkConfirmPanel({
  pishockUserId,
  hubNames,
  discordName,
  busy,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div className="column q-gutter-md">
      <div className="text-h6 text-secondary" style={{ fontFamily: 'geo, Oxanium, sans-serif' }}>
        Is this your PiShock account?
      </div>
      <div className="text-grey-5 text-body2">
        PiShock confirmed a successful login. Confirm that this is the account you want to link to
        the Discord PiShock Controller for <strong className="text-grey-3">{discordName}</strong>.
      </div>

      <div
        className="q-card q-card--dark q-dark q-pa-md"
        style={{ border: '1px solid rgba(121,198,219,.45)' }}
      >
        <div className="text-caption text-secondary q-mb-xs">PiShock account</div>
        <div className="text-h6 text-grey-3">User ID {pishockUserId}</div>
        {hubNames.length > 0 ? (
          <div className="text-body2 text-grey-5 q-mt-sm">
            Hubs: {hubNames.join(', ')}
          </div>
        ) : (
          <div className="text-caption text-grey-6 q-mt-sm">
            Hub names unavailable — User ID is enough to verify this is you.
          </div>
        )}
      </div>

      <div className="text-caption text-grey-6">
        Only confirm if this is your account. Cancel discards the login and does not link anything.
      </div>

      <div className="row q-gutter-sm justify-end" style={{ flexWrap: 'wrap' }}>
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
            <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
              <span className="block">{busy ? 'Linking…' : 'Yes, link this account'}</span>
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}
