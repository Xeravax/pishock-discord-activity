import { useEffect, useState } from 'react';
import type { GlobalBanInfo } from '../hooks/useGlobalBan';
import { openExternal } from '../discord';
import { PsDialog } from './PsDialog';
import { MyDataPanel } from './MyDataPanel';
import { ExternalLink, LEGAL, LEGAL_MAILTO } from '../legal/legal';

function remaining(expiresAt: string, now: number): string {
  const ms = Date.parse(expiresAt) - now;
  if (ms <= 0) return 'ended';
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days > 0) return `${days} day${days === 1 ? '' : 's'}${hours ? `, ${hours} h` : ''} left`;
  const mins = Math.max(1, Math.ceil((ms % 3_600_000) / 60_000));
  return hours ? `${hours} h ${mins} min left` : `${mins} min left`;
}

/**
 * Shown instead of the whole app when an admin banned this account. It documents the
 * ban (reason, date, length, reference) and keeps the user's data rights reachable.
 */
export function GlobalBanScreen({
  ban,
  token,
  displayName,
}: {
  ban: GlobalBanInfo;
  token: string | null;
  displayName: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [dataOpen, setDataOpen] = useState(false);
  useEffect(() => {
    if (!ban.expiresAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [ban.expiresAt]);
  const ended = Boolean(ban.expiresAt && Date.parse(ban.expiresAt) <= now);

  return (
    <div className="global-ban" role="alert" aria-labelledby="global-ban-title">
      <div className="global-ban__card">
        <div className="global-ban__badge" aria-hidden>
          <i className="q-icon mdi mdi-gavel" />
        </div>
        <h1 id="global-ban-title" className="global-ban__title">
          {ended ? 'Your ban has ended' : 'You have been banned from this activity'}
        </h1>
        <p className="global-ban__lead">
          {ended
            ? 'Reload the activity to continue.'
            : `${displayName}, an admin has banned your account from PiShock Activity. While the ban is active you cannot control anyone, and nobody can control you.`}
        </p>

        <section className="global-ban__reason" aria-label="Reason">
          <div className="global-ban__label">Reason</div>
          <blockquote>{ban.reason}</blockquote>
        </section>

        <dl className="global-ban__facts">
          <div>
            <dt>Banned on</dt>
            <dd>{new Date(ban.createdAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt>Length</dt>
            <dd>
              {ban.expiresAt ? (
                <>
                  Until {new Date(ban.expiresAt).toLocaleString()}
                  <span className="global-ban__muted"> · {remaining(ban.expiresAt, now)}</span>
                </>
              ) : (
                'Permanent'
              )}
            </dd>
          </div>
          <div>
            <dt>Reference</dt>
            <dd className="global-ban__ref">{ban.id}</dd>
          </div>
        </dl>

        <ul className="global-ban__effects">
          <li>Your shared shockers were paused and anything waiting in your queue was removed.</li>
          <li>Commands you had queued for other people will not run.</li>
          <li>You can still view, download or delete your data.</li>
          <li>
            Think this is a mistake? Appeal {ban.appealUrl ? 'in our Discord server or ' : ''}by email to{' '}
            <ExternalLink href={LEGAL_MAILTO}>{LEGAL.email}</ExternalLink>, and mention the reference above.
          </li>
        </ul>

        <div className="global-ban__actions">
          {ended ? (
            <button type="button" className="safety-btn safety-btn--accept" onClick={() => window.location.reload()}>
              Reload
            </button>
          ) : null}
          {ban.appealUrl ? (
            <button
              type="button"
              className="safety-btn safety-btn--accept"
              onClick={() => void openExternal(ban.appealUrl!)}
            >
              <i className="q-icon mdi mdi-forum-outline" aria-hidden /> Appeal on Discord
            </button>
          ) : null}
          {token ? (
            <button type="button" className="safety-btn" onClick={() => setDataOpen(true)}>
              <i className="q-icon mdi mdi-database-lock-outline" aria-hidden /> My data
            </button>
          ) : null}
        </div>
      </div>

      {token ? (
        <PsDialog open={dataOpen} title="My data" onClose={() => setDataOpen(false)} wide>
          <MyDataPanel token={token} />
        </PsDialog>
      ) : null}
    </div>
  );
}
