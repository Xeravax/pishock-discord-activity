import { BrandHeader } from './BrandHeader';
import { ContactBlock, ExternalLink, LEGAL } from '../legal/legal';

type Props = { onBack: () => void };

export function TermsOfService({ onBack }: Props) {
  return (
    <div className="legal-page">
      <button type="button" className="btn secondary legal-page__back" onClick={onBack}>
        <i className="q-icon mdi mdi-arrow-left" aria-hidden />
        Back to Application
      </button>

      <BrandHeader compact className="legal-page__brand" />

      <h1>Terms of Service</h1>
      <p className="muted">PiShock Discord Activity · Effective {LEGAL.effective}</p>

      <div className="safety-gate-important">
        <strong>CRITICAL SAFETY WARNING:</strong> This application controls electrical shock
        devices that can cause physical harm, injury, or death if misused. Use only with
        explicit, informed consent; follow safety protocols; start with the lowest settings;
        take full responsibility for consequences; comply with all applicable laws.
      </div>

      <section className="panel">
        <h2>1. Who we are</h2>
        <p className="muted">
          PiShock Discord Activity (&ldquo;the Service&rdquo;) is a Discord Activity operated by{' '}
          {LEGAL.operator} (&ldquo;we&rdquo;, &ldquo;us&rdquo;). It lets people in a Discord voice
          channel control PiShock devices that other participants have chosen to share. Questions
          about these Terms can be sent to us using the details below.
        </p>
        <ContactBlock />
      </section>

      <section className="panel">
        <h2>2. Accepting these Terms</h2>
        <ul className="legal-list">
          <li>
            By using the Service you agree to these Terms and to our Privacy Policy. If you do not
            agree, do not use the Service.
          </li>
          <li>
            You must be at least 18 years old and legally able to agree to these Terms. The Service
            is not intended for anyone under 18; we remove accounts we learn belong to minors.
          </li>
          <li>
            You must also follow Discord&apos;s Terms of Service and Community Guidelines, and
            PiShock&apos;s terms for your PiShock account and devices.
          </li>
          <li>
            Before you can control or share devices you must confirm the in-app safety
            acknowledgements. They form part of these Terms.
          </li>
        </ul>
      </section>

      <section className="panel">
        <h2>3. Consent and safety</h2>
        <ul className="legal-list">
          <li>
            Only control someone who has clearly and freely agreed to it. Consent can be withdrawn
            at any moment; when someone stops, pauses, presses E-STOP, blocks you or leaves, you stop.
          </li>
          <li>Start with the lowest intensity and duration, and agree on a safe word beforehand.</li>
          <li>
            Follow PiShock&apos;s placement and safety guidance. Never use devices on the head, neck
            or chest, near the heart, on broken skin, or on anyone with a heart condition, pacemaker,
            epilepsy or another condition that makes electrical stimulation unsafe.
          </li>
          <li>Do not use the Service while impaired, or with anyone who is.</li>
          <li>
            You are responsible for every command you send and for the devices and limits you share.
          </li>
        </ul>
      </section>

      <section className="panel">
        <h2>4. Sharing your devices</h2>
        <ul className="legal-list">
          <li>
            Linking PiShock is optional and only needed to share or control your own devices. You
            decide which shockers are available, to whom, and with which limits.
          </li>
          <li>
            The safety tools stay under your control: Activity Limits, per-person limits, E-STOP,
            pausing, blocking people, approve-each, cooldowns, shock budgets and check-ins. Limits are
            enforced by our server, not by other people&apos;s devices.
          </li>
          <li>
            Optional extras such as the command queue and roulette only apply when you turn them on.
            Roulette results are random but always stay within your limits, and you can veto a room
            vote.
          </li>
          <li>
            Devices can fail, lose connection or behave unexpectedly. Keep the PiShock app or website
            at hand so you can pause or power off a device yourself.
          </li>
        </ul>
      </section>

      <section className="panel">
        <h2>5. What is visible to others</h2>
        <p className="muted">
          Commands are logged. People involved in a command can see it in their log, and others in
          the activity may see a shared feed depending on your Log sharing settings (Menu → Log
          sharing). Do not share screenshots, logs or other personal information about people
          without their permission.
        </p>
      </section>

      <section className="panel">
        <h2>6. Prohibited use</h2>
        <ul className="legal-list">
          <li>Controlling anyone without their consent, or pressuring someone into consenting</li>
          <li>Use by or involving anyone under 18</li>
          <li>Harassing, threatening, doxxing or impersonating other people</li>
          <li>
            Trying to get around limits, blocks, bans, pauses, E-STOP or any other safety feature,
            including by using another account (ban evasion)
          </li>
          <li>
            Exploiting bugs, automating or scripting the Service, scraping data, or interfering with
            its operation or security. Report security issues to us instead.
          </li>
          <li>Any unlawful purpose in your jurisdiction</li>
        </ul>
      </section>

      <section className="panel">
        <h2>7. Admins</h2>
        <ul className="legal-list">
          <li>
            A small number of admins, appointed by the operator, help run and moderate the Service.
          </li>
          <li>
            When sending a command, admins may skip cooldowns, shock budgets, favorites only,
            approve-each and the queue line. Each use is logged in red and the wearer is notified.
          </li>
          <li>
            Admins may only exceed a wearer&apos;s limits after that wearer explicitly allowed it
            through three separate confirmations. The wearer can withdraw this at any time.
          </li>
          <li>
            Admins can never override E-STOP, pauses, blocks, required warnings or the PiShock
            device maximum.
          </li>
          <li>
            Through the admin panel, admins can see app-wide statistics and a limited profile of each
            user, and can ban people (section 8). The Privacy Policy explains exactly what they can
            and cannot see. Every profile view and ban is recorded in an audit log.
          </li>
        </ul>
      </section>

      <section className="panel">
        <h2>8. Bans and enforcement</h2>
        <ul className="legal-list">
          <li>
            We may ban you from the Service if you break these Terms, endanger or harass other
            people, or if we have to for legal reasons. Bans are decided by people, not by an
            automated system.
          </li>
          <li>
            A ban can be temporary (1 day to 1 year) or permanent. You see the reason, the date, how
            long it lasts and a reference number on a dedicated ban screen.
          </li>
          <li>
            While banned you cannot control anyone and nobody can control you: your shared shockers
            are paused, your queue is cleared and commands you had queued for others will not run.
            You can still view, download or delete your data.
          </li>
          <li>
            If you think a ban is wrong, appeal in our{' '}
            <ExternalLink href={LEGAL.community}>Discord server</ExternalLink> or by email, and
            include the reference number. An admin reviews the appeal; lifting a ban is also
            recorded with a reason.
          </li>
          <li>
            Separately, every wearer can block you from their own devices at any time. We cannot
            override someone else&apos;s block.
          </li>
          <li>
            Admins may publish a notice to everyone in the activity, for example about maintenance.
          </li>
        </ul>
      </section>

      <section className="panel">
        <h2>9. Availability and changes to the Service</h2>
        <p className="muted">
          The Service is provided free of charge and on an &ldquo;as is&rdquo; and &ldquo;as
          available&rdquo; basis. It depends on Discord and PiShock and may be interrupted, changed or
          discontinued at any time. When the server restarts or the state of a device is uncertain,
          the Service is designed to stop rather than continue, but you should never rely on it as
          your only way to stop a device.
        </p>
      </section>

      <section className="panel">
        <h2>10. Disclaimer and limitation of liability</h2>
        <ul className="legal-list">
          <li>
            You use the Service and any connected devices at your own risk. To the fullest extent
            permitted by law, we give no warranties and are not liable for harm, injury, loss or
            damage arising from your use of the Service, devices controlled through it, or the
            actions of other users.
          </li>
          <li>
            Nothing in these Terms excludes or limits liability that cannot be excluded or limited
            under applicable law, such as liability for intent or gross negligence, or your rights as
            a consumer.
          </li>
          <li>
            The Service is not made or endorsed by Discord. PiShock devices and accounts are
            governed by PiShock&apos;s own terms.
          </li>
        </ul>
      </section>

      <section className="panel">
        <h2>11. Ending use</h2>
        <p className="muted">
          You can stop using the Service at any time, unlink PiShock, and request deletion or
          anonymisation of your data (Menu → My data). We may suspend or end your access as
          described in section 8.
        </p>
      </section>

      <section className="panel">
        <h2>12. Changes to these Terms</h2>
        <p className="muted">
          We may update these Terms. The effective date at the top shows the current version, and we
          announce significant changes in the activity. If you keep using the Service after a change,
          the new Terms apply; if you do not agree, stop using it and you can delete your data.
        </p>
      </section>

      <section className="panel">
        <h2>13. Governing law</h2>
        <p className="muted">
          These Terms are governed by the laws of the Netherlands. If you are a consumer, you keep the
          protection of the mandatory laws of the country where you live, and you may bring a claim
          in the courts there.
        </p>
      </section>

      <section className="panel">
        <h2>Emergency</h2>
        <p className="muted">
          In an emergency or if anything feels unsafe: press E-STOP, stop immediately, pause or power
          off the device on pishock.com, and contact emergency services if needed.
        </p>
      </section>
    </div>
  );
}
