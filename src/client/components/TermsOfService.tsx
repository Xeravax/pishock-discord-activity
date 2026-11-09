type Props = { onBack: () => void };

export function TermsOfService({ onBack }: Props) {
  return (
    <div className="legal-page">
      <button type="button" className="btn secondary" onClick={onBack}>
        ← Back to Application
      </button>

      <h1>Terms of Service</h1>
      <p className="muted">PiShock Discord Activity · Last updated {new Date().toLocaleDateString()}</p>

      <div className="safety-gate-important">
        <strong>CRITICAL SAFETY WARNING:</strong> This application controls electrical shock
        devices that can cause physical harm, injury, or death if misused. Use only with
        explicit, informed consent; follow safety protocols; start with the lowest settings;
        take full responsibility for consequences; comply with all applicable laws.
      </div>

      <section className="panel">
        <h2>Acceptance of Terms</h2>
        <p className="muted">
          By accessing or using this Service, you agree to these Terms. If you do not agree,
          do not use the Service. You must be at least 18 years of age and have legal capacity
          to enter into these Terms.
        </p>
      </section>

      <section className="panel">
        <h2>Safety Requirements</h2>
        <ul className="legal-list">
          <li>Obtain clear, informed consent from all participants before any device interaction</li>
          <li>Always start with the lowest intensity and duration settings</li>
          <li>Establish safe words and emergency stop procedures before use</li>
          <li>Ensure proper device placement and avoid sensitive areas</li>
          <li>Never use on people with medical conditions that make stimulation unsafe</li>
        </ul>
      </section>

      <section className="panel">
        <h2>Prohibited Use</h2>
        <ul className="legal-list">
          <li>Non-consensual use of devices</li>
          <li>Attempting to bypass safety limits, bans, or share restrictions</li>
          <li>Use by anyone under 18</li>
          <li>Any unlawful purpose in your jurisdiction</li>
        </ul>
      </section>

      <section className="panel">
        <h2>Disclaimer of Liability</h2>
        <p className="muted">
          The Service is provided as-is. Developers and operators assume no responsibility for
          harm, injury, misuse, or adverse effects arising from use of electrical devices
          controlled through this Activity. You use the Service at your own risk.
        </p>
      </section>

      <section className="panel">
        <h2>Emergency</h2>
        <p className="muted">
          For emergency situations or safety concerns, immediately discontinue use, pause or
          power off the device on pishock.com, and contact appropriate emergency services if
          needed.
        </p>
      </section>
    </div>
  );
}
