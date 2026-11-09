type Props = {
  linking: boolean;
  loginUrl: string | null;
  error: string | null;
  onStart: () => void;
  onOpen: () => void;
  onRefresh: () => void;
};

export function LoginPanel({ linking, loginUrl, error, onStart, onOpen, onRefresh }: Props) {
  return (
    <section
      className={`q-card q-card--dark q-dark q-pa-md ${linking ? 'linking' : ''}`}
      style={{ border: '1px solid rgba(121,198,219,.35)' }}
    >
      <div className="text-secondary text-h6 q-mb-sm" style={{ fontFamily: 'geo, Oxanium, sans-serif' }}>
        Link PiShock
      </div>
      <p className="text-grey-5 text-body2">
        Sign in through PiShock&apos;s login page. Your PiShock password never enters this activity.
        We store only the session PiShock returns, encrypted on the server.
      </p>
      {error ? (
        <div className="bg-negative text-white q-pa-sm q-mb-md" style={{ borderRadius: 4 }}>
          {error}
        </div>
      ) : null}
      <div className="row q-gutter-sm q-mt-md" style={{ flexWrap: 'wrap' }}>
        {!loginUrl ? (
          <button
            type="button"
            className="q-btn q-btn-item non-selectable no-outline bg-secondary text-dark q-btn--standard q-btn--rectangle q-btn--actionable"
            disabled={linking}
            onClick={onStart}
          >
            <span className="q-btn__wrapper col row q-anchor--skip">
              <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                <span className="block">{linking ? 'Starting…' : 'Connect PiShock'}</span>
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
    </section>
  );
}
