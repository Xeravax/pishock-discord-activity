type Props = { onBack: () => void };

export function PrivacyPolicy({ onBack }: Props) {
  return (
    <div className="legal-page">
      <button type="button" className="btn secondary" onClick={onBack}>
        ← Back to Application
      </button>

      <h1>Privacy Policy</h1>
      <p className="muted">PiShock Discord Activity · Last updated {new Date().toLocaleDateString()}</p>

      <section className="panel">
        <h2>Introduction</h2>
        <p className="muted">
          This Privacy Policy describes how PiShock Discord Activity collects, uses, and
          protects information when you control PiShock devices through Discord. Your privacy
          and safety are priorities.
        </p>
      </section>

      <section className="panel">
        <h2>PiShock authentication</h2>
        <p className="muted">
          Linking your account uses PiShock&apos;s login page, then{' '}
          <strong>creates a 7-day named API key</strong> (Discord PiShock Controller) for device
          control. The short-lived login session is not persisted. The API key is shown once at
          link time, encrypted at rest (AES-256-GCM), and is never exposed to other
          participants&apos; browsers afterward. Unlinking removes the key from this app. Created
          keys expire after 7 days, or sooner if you revoke them at PiShock or PiShock rejects
          them. Your PiShock password is never stored here. Other people&apos;s devices are only
          available when those users have linked their own PiShock accounts.
        </p>
      </section>

      <section className="panel">
        <h2>Information We Store</h2>
        <ul className="legal-list">
          <li>Discord user id and profile fields needed for the activity session</li>
          <li>
            Encrypted PiShock API key and username linked to your Discord user (optional expiry hint
            if PiShock reports one)
          </li>
          <li>
            Cached PiShock profile avatar and banner images (downloaded from PiShock /Account and
            served from this app; removed when you unlink)
          </li>
          <li>Consent acknowledgment status</li>
          <li>Command activity logs for accountability (action, intensity, duration, success)</li>
        </ul>
      </section>

      <section className="panel">
        <h2>How We Use Information</h2>
        <ul className="legal-list">
          <li>Authenticate you inside Discord and authorize PiShock control requests</li>
          <li>Enforce consent and safety gates before device control</li>
          <li>Proxy commands to PiShock APIs without exposing your API key to other clients</li>
          <li>Maintain activity logs for transparency and abuse investigation</li>
        </ul>
      </section>

      <section className="panel">
        <h2>What We Do Not Do</h2>
        <ul className="legal-list">
          <li>We do not store your PiShock password</li>
          <li>We do not sell personal data</li>
          <li>We do not share PiShock API keys with other activity participants</li>
        </ul>
      </section>

      <section className="panel">
        <h2>Third Parties</h2>
        <p className="muted">
          Discord and PiShock process data under their own policies when you authenticate or
          control devices. Review Discord&apos;s and PiShock&apos;s privacy policies for those
          services.
        </p>
      </section>

      <section className="panel">
        <h2>Retention</h2>
        <p className="muted">
          Unlinking removes the key from this app. The key stays valid at PiShock until you revoke
          it there or PiShock rejects it. Logs are retained only as
          long as needed for operation, safety, and abuse prevention. You can unlink your PiShock
          account from the activity at any time.
        </p>
      </section>
    </div>
  );
}
