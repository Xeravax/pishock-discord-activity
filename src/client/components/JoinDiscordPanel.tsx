import { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { openExternal, requestCommunityJoinCode } from '../discord';

type Community = { enabled: boolean; inviteUrl: string | null };

/**
 * Menu → Join our Discord. Always available: one tap adds you to the community server
 * (Discord asks you to approve it), with the plain invite link as the fallback. Joining
 * also lets the bot DM your session recaps.
 */
export function JoinDiscordPanel({ token }: { token: string }) {
  const [community, setCommunity] = useState<Community | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Community>('/community', token).then(setCommunity, (e) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  }, [token]);

  const join = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const code = await requestCommunityJoinCode();
      const res = await apiFetch<{ result: 'joined' | 'already' }>('/community/join', token, {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      setNotice(
        res.result === 'joined'
          ? 'You joined the server. Recap DMs can now reach you.'
          : 'You are already in the server.',
      );
    } catch {
      // Declined or failed: fall back to the normal invite link.
      if (community?.inviteUrl) {
        setNotice('Opening the invite link instead.');
        await openExternal(community.inviteUrl);
      } else {
        setError('Could not join the server right now.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ps-stack ps-stack--lg">
      <p className="log-privacy__note">
        Our community server is where you get help, share feedback and appeal decisions. Joining is
        optional. It also lets the app&apos;s bot send you session recaps in your DMs, because Discord
        only allows that when you share a server with it.
      </p>
      {error ? (
        <div className="ps-callout ps-callout--error" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? <div className="ps-callout ps-callout--success">{notice}</div> : null}
      <div className="row q-gutter-sm">
        {community?.enabled ? (
          <button type="button" className="safety-btn safety-btn--accept" disabled={busy} onClick={() => void join()}>
            <i className="q-icon mdi mdi-account-plus-outline" aria-hidden /> Join the server
          </button>
        ) : null}
        {community?.inviteUrl ? (
          <button
            type="button"
            className={`safety-btn${community.enabled ? '' : ' safety-btn--accept'}`}
            onClick={() => void openExternal(community.inviteUrl!)}
          >
            <i className="q-icon mdi mdi-open-in-new" aria-hidden /> {community.enabled ? 'Open invite instead' : 'Open invite'}
          </button>
        ) : null}
      </div>
      {community?.enabled ? (
        <p className="log-privacy__note">
          &ldquo;Join the server&rdquo; asks Discord for permission to add you; the approval is used once
          and not stored.
        </p>
      ) : null}
    </div>
  );
}
