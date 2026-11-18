import { BrandHeader } from './BrandHeader';
import { ContactBlock, ExternalLink, LEGAL, LEGAL_MAILTO } from '../legal/legal';

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
      <p className="muted">PiShock Discord Activity · Effective {LEGAL.effective}</p>

      <section className="panel">
        <h2>1. Who is responsible</h2>
        <p className="muted">
          {LEGAL.operator} operates PiShock Discord Activity and is the controller of your personal
          data under the GDPR (in the Netherlands: the AVG). For any privacy question or to use your
          rights, email us with the subject line below so your request is picked up quickly.
        </p>
        <ContactBlock />
      </section>

      <section className="panel">
        <h2>2. In short</h2>
        <ul className="legal-list">
          <li>We only collect what the activity needs to work safely. No ads, no analytics, no tracking.</li>
          <li>Your PiShock API key is encrypted and never sent to anyone else&apos;s browser. We never see your PiShock password.</li>
          <li>We do not sell your data or share it for marketing.</li>
          <li>You can see, download, limit, and delete your data yourself in Menu → My data.</li>
        </ul>
      </section>

      <section className="panel">
        <h2>3. What we collect</h2>
        <ul className="legal-list">
          <li>
            <strong>Discord account:</strong> your Discord user ID, username, display name and avatar,
            and the server and channel the activity runs in. Discord asks you to approve these scopes:
            identify, guilds, guilds.members.read (your server nickname), rpc.activities.write and,
            if you allow it, rpc.voice.read. Voice data is only used live to show who is speaking or
            muted and is never stored.
          </li>
          <li>
            <strong>PiShock link (optional):</strong> an encrypted API key, your PiShock username and
            user ID, an expiry hint, and cached copies of your PiShock avatar and banner.
          </li>
          <li>
            <strong>Safety and settings:</strong> when you accepted the safety notice; your limits,
            shared shockers and their names, log sharing choices, extra features (queue, approve-each,
            cooldowns, shock budget and its usage, check-ins, roulette, recap DMs), favorites, blocks,
            per-person limits, E-STOP state, and whether and when you allowed admins to exceed your
            limits.
          </li>
          <li>
            <strong>Activity logs:</strong> for each command: who sent it, who received it, the device
            and hub name, action, intensity, duration, warning, result, the server/channel it happened
            in, and whether an admin bypass was used. If you link PiShock, commands on your devices from
            other PiShock panels (such as the PiShock website) can be added so your history is complete.
          </li>
          <li>
            <strong>Sessions and recaps:</strong> when you were connected, and a summary of what was
            done to you in each session. If you turn on recap DMs, our Discord bot sends that summary to
            you.
          </li>
          <li>
            <strong>Moderation:</strong> bans on your account (reason, dates, length, which admin set
            or lifted it) and an audit log of admin actions concerning you, such as viewing your admin
            profile.
          </li>
          <li>
            <strong>Requests:</strong> data deletion or anonymisation requests and when they ran.
            Single-use links for data downloads only exist in memory for a few minutes.
          </li>
          <li>
            <strong>Technical data:</strong> our server logs record requests with your IP address, time
            and path (access tokens are removed). Rate limiting keeps short-lived counters in memory
            only.
          </li>
          <li>
            <strong>On your device:</strong> the app stores a few preferences in your browser&apos;s
            local storage (controller settings, whether you confirmed the safety notice, dismissed
            notices). These never leave your device and no cookies are used for tracking.
          </li>
        </ul>
      </section>

      <section className="panel">
        <h2>4. Sensitive information</h2>
        <p className="muted">
          Because of what this activity is used for, your activity logs can say something about your
          private or sex life, which the GDPR treats as a special category of data. We do not ask you
          for this information; it only arises from using the Service, which you explicitly choose to
          do after the safety acknowledgements. We limit who can see it (section 6) and you can delete
          it at any time.
        </p>
      </section>

      <section className="panel">
        <h2>5. Why we use it, and on what legal basis</h2>
        <ul className="legal-list">
          <li>
            <strong>Providing the Service</strong> (signing you in through Discord, sending commands to
            PiShock, applying your settings, showing your logs and history): necessary to perform our
            agreement with you (GDPR art. 6(1)(b)), and your explicit consent for activity data that may
            be sensitive (art. 9(2)(a)).
          </li>
          <li>
            <strong>Safety, abuse prevention and moderation</strong> (enforcing limits, blocks and bans,
            keeping logs and ban records, the admin audit log, security logs, rate limiting): our
            legitimate interest, and that of other users, in keeping people safe and the Service secure
            (art. 6(1)(f)).
          </li>
          <li>
            <strong>Optional features</strong> (recap DMs, joining our Discord server, voice indicators,
            allowing admins past your limits): your consent (art. 6(1)(a)), which you can withdraw at any
            time in the app.
          </li>
          <li>
            <strong>Legal obligations</strong>, such as answering requests from authorities when the law
            requires it (art. 6(1)(c)).
          </li>
        </ul>
      </section>

      <section className="panel">
        <h2>6. Who can see your data</h2>
        <ul className="legal-list">
          <li>
            <strong>People you interact with:</strong> the sender and the wearer of a command both see
            it. Others in the activity see a shared feed only as far as your Log sharing settings allow.
          </li>
          <li>
            <strong>Admins:</strong> see section 7.
          </li>
          <li>
            <strong>Discord:</strong> runs the activity, signs you in, and delivers recap DMs and server
            invites.
          </li>
          <li>
            <strong>PiShock:</strong> receives the commands for devices and your API key requests.
          </li>
          <li>
            <strong>Authorities:</strong> only when we are legally required to share data.
          </li>
        </ul>
        <p className="muted">
          Discord and PiShock process data under their own privacy policies. We do not sell data or
          give it to advertisers.
        </p>
      </section>

      <section className="panel">
        <h2>7. Admins</h2>
        <p className="muted">
          A small number of admins, appointed by the operator, help run and moderate the Service.
        </p>
        <ul className="legal-list">
          <li>
            <strong>Admin bypass:</strong> admins can skip cooldowns, shock budgets, favorites only,
            approve-each and the queue line. Every time they do, the log entry is marked in red and you
            are notified. They can only go above your limits if you allowed it yourself through three
            separate confirmations (Menu → Extra features), and you can withdraw that at any time.
            E-STOP, pauses, blocks, required warnings and your PiShock device maximum always apply.
          </li>
          <li>
            <strong>Admin panel, what admins can see about you:</strong> your Discord name, username,
            avatar and ID; when you were first and last seen and whether you are online; whether you
            accepted the safety notice and linked PiShock (not which account); how many shockers you
            share and how many are paused; which extra features are on; whether an E-STOP is engaged;
            how many commands you sent and received per type over the last 30 days; how many admin
            bypasses were used on you; how many people blocked you and how many you block; whether a
            deletion request is pending; and your ban history.
          </li>
          <li>
            <strong>What admins cannot see there:</strong> your PiShock account, API key, share codes,
            device names, limits, who you control or who controls you, the contents of your logs, or
            your session recaps.
          </li>
          <li>
            Every profile view, ban, unban and app notice is recorded in an audit log, so admin access
            itself is accountable.
          </li>
        </ul>
      </section>

      <section className="panel">
        <h2>8. International transfers</h2>
        <p className="muted">
          Discord is based in the United States, so using a Discord Activity involves transfers outside
          the European Economic Area. Discord relies on the EU–US Data Privacy Framework and standard
          contractual clauses for these transfers. PiShock is a separate service that you choose to
          link. See their policies for where they process data.
        </p>
      </section>

      <section className="panel">
        <h2>9. How long we keep it</h2>
        <ul className="legal-list">
          <li>
            <strong>Your log entries:</strong> 12 months by default. You can choose 30 days, 3 or 6
            months, or to keep them until you delete them (Menu → My data). The other person in a
            command keeps their own copy under their own setting.
          </li>
          <li><strong>Sessions and recaps:</strong> follow your log retention setting.</li>
          <li>
            <strong>PiShock key:</strong> until you unlink, the key expires (7 days) or PiShock rejects
            it. Cached profile images are removed when you unlink.
          </li>
          <li>
            <strong>Account and settings:</strong> until you delete your data or ask us to.
          </li>
          <li>
            <strong>Bans:</strong> kept while the ban applies and afterwards as history, including after
            account deletion, so a ban cannot be avoided by deleting and re-joining. You can email us to
            review an old ban record.
          </li>
          <li>
            <strong>Admin audit log:</strong> kept as an accountability record. Profile-view entries are
            unlinked from you when your data is deleted.
          </li>
          <li>
            <strong>Blocks and limits others set on you:</strong> kept as their safety data, even after
            you delete your data.
          </li>
          <li>
            <strong>Server logs:</strong> automatically overwritten as new logs come in (size-capped),
            normally within days.
          </li>
          <li>
            <strong>Deletion requests:</strong> kept as proof the request was carried out, with your ID
            removed once it has run.
          </li>
        </ul>
      </section>

      <section className="panel">
        <h2>10. Security</h2>
        <p className="muted">
          PiShock API keys are encrypted at rest (AES-256-GCM) and never sent to other people&apos;s
          browsers. All traffic goes over HTTPS through Discord. Limits and permissions are checked on our
          server for every command, admin access is limited to named accounts and audited, and tokens are
          removed from our logs. No system is perfectly secure; if a breach affects you, we will tell you
          and the authorities as the law requires.
        </p>
      </section>

      <section className="panel">
        <h2>11. Your rights</h2>
        <ul className="legal-list">
          <li><strong>Access and portability:</strong> see what is stored and download it as a file (Menu → My data).</li>
          <li><strong>Rectification:</strong> change your settings at any time from the menu, or ask us to correct something.</li>
          <li>
            <strong>Erasure:</strong> have your data deleted or anonymised. The request runs after 7 days
            so you can cancel it; your PiShock key is removed and sharing is turned off right away. In
            other people&apos;s logs you become &ldquo;Deleted user&rdquo;. The exceptions above (bans,
            others&apos; blocks and limits) still apply.
          </li>
          <li><strong>Restriction and objection:</strong> object to processing based on legitimate interests, or ask us to limit it.</li>
          <li><strong>Withdraw consent:</strong> turn optional features off in the app at any time. This does not affect earlier processing.</li>
          <li>
            <strong>Banned users</strong> keep these rights: My data stays available on the ban screen.
          </li>
        </ul>
        <p className="muted">
          Anything you cannot do in the app, email{' '}
          <ExternalLink href={LEGAL_MAILTO}>{LEGAL.email}</ExternalLink> with the subject &ldquo;
          {LEGAL.subject}&rdquo;. We answer within one month and may ask you to confirm your Discord
          account so we only act for the right person. You can also complain to your data protection
          authority; in the Netherlands that is the{' '}
          <ExternalLink href="https://autoriteitpersoonsgegevens.nl">Autoriteit Persoonsgegevens</ExternalLink>.
        </p>
      </section>

      <section className="panel">
        <h2>12. Automated decisions</h2>
        <p className="muted">
          We do not make decisions about you based solely on automated processing. Safety features such as
          budgets, cooldowns and missed check-ins act on settings you chose; bans are always decided by a
          person.
        </p>
      </section>

      <section className="panel">
        <h2>13. Children</h2>
        <p className="muted">
          The Service is only for people aged 18 and over. If we learn that a minor is using it, we remove
          their account and data.
        </p>
      </section>

      <section className="panel">
        <h2>14. Changes to this policy</h2>
        <p className="muted">
          We may update this policy when the Service changes. The effective date at the top shows the
          current version, and we announce significant changes in the activity.
        </p>
      </section>
    </div>
  );
}
