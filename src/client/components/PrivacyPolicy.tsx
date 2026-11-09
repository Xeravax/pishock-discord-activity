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
        <h2>Information We Store</h2>
        <ul className="legal-list">
          <li>Discord user id and profile fields needed for the activity session</li>
          <li>Encrypted PiShock session credentials (user id + website token) linked to your Discord user</li>
          <li>Consent acknowledgment status</li>
          <li>Command activity logs for accountability (action, intensity, duration, success)</li>
        </ul>
      </section>

      <section className="panel">
        <h2>How We Use Information</h2>
        <ul className="legal-list">
          <li>Authenticate you inside Discord and authorize PiShock control requests</li>
          <li>Enforce consent and safety gates before device control</li>
          <li>Proxy commands to PiShock APIs without exposing your PiShock token to other clients</li>
          <li>Maintain activity logs for transparency and abuse investigation</li>
        </ul>
      </section>

      <section className="panel">
        <h2>What We Do Not Do</h2>
        <ul className="legal-list">
          <li>We do not store your PiShock password</li>
          <li>We do not sell personal data</li>
          <li>We do not share PiShock tokens with other activity participants</li>
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
          Sessions and logs are retained only as long as needed for operation, safety, and
          abuse prevention. You can unlink your PiShock session from the activity at any time.
        </p>
      </section>
    </div>
  );
}
