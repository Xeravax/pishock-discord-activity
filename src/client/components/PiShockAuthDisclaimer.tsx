type Props = {
  /** Slightly denser layout for compact panels */
  compact?: boolean;
};

/**
 * Explicit notice: named API key, encrypted at rest.
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
        This application <strong>will create a named PiShock API key</strong> when you link your
        account.
      </p>
      <ul className="pishock-auth-disclaimer__list">
        <li>
          After you sign in on PiShock&apos;s login page, confirming the link creates a{' '}
          <strong>named API key</strong> (<strong>Discord Activity</strong>) and stores it
          encrypted for control. You can also paste an existing username + API key instead.
        </li>
        <li>
          The short-lived login session token is used only to create that key and is{' '}
          <strong>not</strong> persisted. The API key stays until you unlink or PiShock rejects it.
        </li>
        <li>
          Other people&apos;s devices are only controllable when{' '}
          <strong>those users have linked their own PiShock accounts</strong> in this activity.
        </li>
        <li>
          API keys are <strong>encrypted in the database</strong> (AES-256-GCM) and are never sent
          to other users&apos; browsers after the one-time reveal.
        </li>
      </ul>
    </aside>
  );
}
