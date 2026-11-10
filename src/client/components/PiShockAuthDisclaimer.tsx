type Props = {
  /** Slightly denser layout for compact panels */
  compact?: boolean;
};

/**
 * Explicit notice: session auth token (not API key), encrypted at rest.
 * Shown before / during PiShock linking so users are not surprised.
 */
export function PiShockAuthDisclaimer({ compact }: Props) {
  return (
    <aside
      className={`pishock-auth-disclaimer${compact ? ' pishock-auth-disclaimer--compact' : ''}`}
      role="note"
      aria-label="PiShock authentication disclaimer"
    >
      <div className="pishock-auth-disclaimer__eyebrow">Authentication disclaimer</div>
      <p className="pishock-auth-disclaimer__lead">
        This application <strong>will request an authentication token</strong> from PiShock when you
        link your account.
      </p>
      <ul className="pishock-auth-disclaimer__list">
        <li>
          It uses a <strong>PiShock login / session authentication token</strong>, not a classic
          PiShock <strong>API key</strong>, for your account.
        </li>
        <li>
          It will <strong>not</strong> ask for or store an API key for you. Other people&apos;s
          devices are only controllable when <strong>those users have logged in with their own
          PiShock accounts</strong> in this activity (their own tokens / shares).
        </li>
        <li>
          Authentication tokens are <strong>encrypted in the database</strong> (AES-256-GCM) and are
          never sent to other users&apos; browsers.
        </li>
      </ul>
    </aside>
  );
}
