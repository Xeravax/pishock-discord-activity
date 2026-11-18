import { BrandHeader } from './BrandHeader';

type Props = { onBack: () => void };

export function PrivacyPolicy({ onBack }: Props) {
  return (
    <div className="legal-page">
      <button type="button" className="btn secondary legal-page__back" onClick={onBack}>
        <i className="q-icon mdi mdi-arrow-left" aria-hidden />
        Back to Application
      </button>

      <BrandHeader compact className="legal-page__brand" />

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
          <li>
            Your settings: limits, shared shockers, log sharing, extra features (approve-each,
            cooldowns, shock budget and its usage, check-ins), favorites, blocks and per-person limits
          </li>
          <li>When you were last connected (used for session budgets)</li>
          <li>Whether and when you allowed admins to exceed your limits</li>
          <li>Data deletion / anonymisation requests and when they ran</li>
          <li>
            Your sessions (start and end) with a recap of what was done to you. If you turn on recap
            DMs, the recap is sent to you by the app&apos;s Discord bot. If you choose to join our
            Discord server, the one-time Discord approval is used to add you and is not stored.
          </li>
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
        <h2>Admin access</h2>
        <p className="muted">
          Admins of this activity can skip cooldowns, shock budgets, favorites only, approve-each and
          the queue line. Every time they do, the log entry is marked in red and you are notified.
          They can only go above your limits if you allowed it yourself through three separate
          confirmations (Menu → Extra features), and you can withdraw that at any time. E-STOP,
          pauses, blocks, required warnings and your PiShock device maximum always apply.
        </p>
      </section>

      <section className="panel">
        <h2>Retention</h2>
        <p className="muted">
          Unlinking removes the key from this app. The key stays valid at PiShock until you revoke
          it there or PiShock rejects it. Your copy of each log entry is kept for 12 months by
          default; you can choose 30 days, 3 or 6 months, or to keep it until you delete it (Menu →
          My data). The other person in a command keeps their own copy under their own setting.
        </p>
      </section>

      <section className="panel">
        <h2>Your rights</h2>
        <ul className="legal-list">
          <li>See what is stored about you and download it as a file (Menu → My data)</li>
          <li>Choose how long your logs are kept</li>
          <li>
            Have your data deleted or anonymised. The request runs after 7 days so you can cancel it;
            your PiShock key is removed and sharing is turned off right away. In other people&apos;s
            logs you become &ldquo;Deleted user&rdquo;. Blocks and limits other people set on you are
            kept so they stay protected.
          </li>
          <li>Correct your settings at any time from the menu</li>
          <li>
            Complain to your data protection authority (in the Netherlands: the Autoriteit
            Persoonsgegevens)
          </li>
        </ul>
      </section>
    </div>
  );
}
