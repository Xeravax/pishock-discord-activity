import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { openExternal, requestCommunityJoinCode } from '../discord';
import { participantAvatarUrl } from '../participants';
import { describeBypassedGates } from './OfficialLogsPanel';

type Recap = {
  durationMs: number;
  commands: number;
  shocks: number;
  vibrates: number;
  beeps: number;
  totalShockMs: number;
  maxShockIntensity: number;
  refused: number;
  adminBypasses: number;
  rouletteSafe: number;
  topSenders: Array<{ id: string; count: number }>;
};

type SessionRow = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  summary: Recap | null;
  dmStatus: 'pending' | 'sent' | 'failed' | 'disabled' | 'empty';
  seenAt: string | null;
};

type HistoryEntry = {
  id: string;
  action: string;
  shockerName: string | null;
  hubName: string | null;
  intensity: number | null;
  durationMs: number | null;
  warningLevel: string | null;
  success: boolean;
  source: string;
  locationName: string | null;
  createdAt: string;
  adminBypass: boolean;
  bypassedGates: string[];
  refusedReason: string | null;
  executor: { id: string | null; username?: string | null; globalName?: string | null; avatar?: string | null; label?: string };
};

type Filter = '' | 'shock' | 'vibrate' | 'beep';

function personName(e: HistoryEntry['executor']): string {
  return e.globalName || e.username || e.label || 'Someone';
}

function verb(action: string): string {
  const a = action.toLowerCase();
  if (a === 'roulette_safe') return 'spun the wheel (safe)';
  if (a.includes('vibrate') || a.includes('warning')) return 'vibrated you';
  if (a.includes('beep')) return 'beeped you';
  if (a.includes('hold')) return 'hold-shocked you';
  if (a.includes('shock')) return 'shocked you';
  return a.replace(/^participant_/, '');
}

function fmtDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h ${min % 60}m`;
}

/** Menu → My history: session recaps + every command done to you. */
export function MyHistoryPanel({
  token,
  onSeen,
}: {
  token: string;
  onSeen?: () => void;
}) {
  const [tab, setTab] = useState<'sessions' | 'history'>('sessions');
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [dmFailed, setDmFailed] = useState(false);
  const [community, setCommunity] = useState<{ enabled: boolean; inviteUrl: string | null } | null>(null);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [s, c] = await Promise.all([
          apiFetch<{ sessions: SessionRow[]; dmFailed: boolean }>('/me/sessions', token),
          apiFetch<{ enabled: boolean; inviteUrl: string | null }>('/community', token),
        ]);
        if (cancelled) return;
        setSessions(s.sessions);
        setDmFailed(s.dmFailed);
        setCommunity(c);
        await apiFetch('/me/sessions/seen', token, { method: 'POST', body: '{}' });
        onSeen?.();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, onSeen]);

  const loadHistory = useCallback(
    async (reset: boolean) => {
      setLoadingMore(true);
      try {
        const params = new URLSearchParams();
        if (filter) params.set('action', filter);
        if (!reset && cursor) params.set('cursor', cursor);
        const res = await apiFetch<{ entries: HistoryEntry[]; nextCursor: string | null }>(
          `/me/history?${params.toString()}`,
          token,
        );
        setEntries((prev) => (reset ? res.entries : [...prev, ...res.entries]));
        setCursor(res.nextCursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoadingMore(false);
      }
    },
    [token, filter, cursor],
  );

  useEffect(() => {
    if (tab === 'history') void loadHistory(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, filter]);

  const joinServer = async () => {
    setError(null);
    try {
      const code = await requestCommunityJoinCode();
      const res = await apiFetch<{ result: 'joined' | 'already' }>('/community/join', token, {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      setDmFailed(false);
      setNotice(
        res.result === 'joined'
          ? 'You joined the server — recaps can now reach your DMs.'
          : 'You are already in the server.',
      );
    } catch {
      // Declined or failed: fall back to the normal invite link.
      if (community?.inviteUrl) await openExternal(community.inviteUrl);
    }
  };

  return (
    <div className="ps-stack ps-stack--lg my-history">
      <div className="my-history__tabs" role="tablist">
        {(
          [
            ['sessions', 'Session recaps'],
            ['history', 'Everything done to me'],
          ] as const
        ).map(([id, title]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`log-privacy__scope${tab === id ? ' is-active' : ''}`}
            onClick={() => setTab(id)}
          >
            <span className="log-privacy__scope-title">{title}</span>
          </button>
        ))}
      </div>

      {error ? (
        <div className="ps-callout ps-callout--error" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? <div className="ps-callout ps-callout--success">{notice}</div> : null}

      {dmFailed && community?.enabled ? (
        <div className="ps-callout">
          <strong>We couldn’t DM your last recap.</strong> Discord only lets the app message you if
          you share a server with it. Would you like to join our Discord server?
          <div className="row q-gutter-sm" style={{ marginTop: 8 }}>
            <button type="button" className="safety-btn safety-btn--accept" onClick={() => void joinServer()}>
              Join the server
            </button>
            {community.inviteUrl ? (
              <button type="button" className="safety-btn" onClick={() => void openExternal(community.inviteUrl!)}>
                Open invite instead
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === 'sessions' ? (
        sessions == null ? (
          <div className="text-grey-5">Loading…</div>
        ) : sessions.filter((s) => s.dmStatus !== 'empty').length === 0 ? (
          <div className="text-grey-5">No sessions with activity yet.</div>
        ) : (
          <div className="ps-stack">
            {sessions
              .filter((s) => s.summary && s.dmStatus !== 'empty')
              .map((s) => {
                const r = s.summary!;
                return (
                  <div key={s.id} className={`my-history__recap${s.seenAt ? '' : ' is-unread'}`}>
                    <div className="my-history__recap-head">
                      <strong>{new Date(s.startedAt).toLocaleString()}</strong>
                      <span className="text-grey-5"> · {fmtDuration(r.durationMs)}</span>
                      <span className="my-history__dm" title="Recap DM">
                        {s.dmStatus === 'sent' ? 'DM sent' : s.dmStatus === 'failed' ? 'DM failed' : ''}
                      </span>
                    </div>
                    <div>
                      ⚡ {r.shocks} ({(r.totalShockMs / 1000).toFixed(1)}s, max {r.maxShockIntensity}%) · 〰️{' '}
                      {r.vibrates} · 🔔 {r.beeps}
                      {r.rouletteSafe ? ` · 🎡 ${r.rouletteSafe} safe` : ''}
                    </div>
                    {r.refused ? <div className="text-grey-5">🛡️ {r.refused} refused by your settings</div> : null}
                    {r.adminBypasses ? (
                      <div className="text-negative">🟥 {r.adminBypasses} admin bypass{r.adminBypasses === 1 ? '' : 'es'}</div>
                    ) : null}
                  </div>
                );
              })}
          </div>
        )
      ) : (
        <>
          <div className="my-history__filters" role="radiogroup" aria-label="Filter">
            {(
              [
                ['', 'All'],
                ['shock', 'Shocks'],
                ['vibrate', 'Vibrations'],
                ['beep', 'Beeps'],
              ] as const
            ).map(([id, title]) => (
              <button
                key={id || 'all'}
                type="button"
                role="radio"
                aria-checked={filter === id}
                className={`safety-btn${filter === id ? ' safety-btn--accept' : ''}`}
                onClick={() => setFilter(id)}
              >
                {title}
              </button>
            ))}
          </div>
          <div className="official-logs-list">
            {entries.map((e) => (
              <div
                key={e.id}
                className={`official-log-row${e.adminBypass ? ' official-log-row--admin' : ''}`}
              >
                {e.adminBypass ? (
                  <div className="official-log-admin">
                    <i className="q-icon mdi mdi-shield-alert" aria-hidden /> An admin bypassed this ·{' '}
                    {describeBypassedGates(e.bypassedGates)}
                  </div>
                ) : null}
                <div className="my-history__entry">
                  {e.executor.id ? (
                    <img
                      src={participantAvatarUrl(e.executor.id, e.executor.avatar ?? null)}
                      alt=""
                      className="official-log-avatar"
                    />
                  ) : null}
                  <span>
                    <strong>{personName(e.executor)}</strong> {verb(e.action)}
                    {e.intensity != null && !e.action.includes('beep') ? ` at ${e.intensity}%` : ''}
                    {e.durationMs ? ` for ${(e.durationMs / 1000).toFixed(1)}s` : ''}
                    {e.shockerName ? ` on ${e.shockerName}` : ''}
                    {e.warningLevel ? ` (warned: ${e.warningLevel})` : ''}
                    {!e.success ? <span className="text-negative"> — {e.refusedReason ?? 'not delivered'}</span> : null}
                  </span>
                </div>
                <div className="text-grey-5 text-caption">
                  {new Date(e.createdAt).toLocaleString()}
                  {e.locationName ? ` · ${e.locationName}` : ''}
                  {e.source === 'website' ? ' · via PiShock website' : ''}
                </div>
              </div>
            ))}
            {entries.length === 0 && !loadingMore ? <div className="text-grey-5">Nothing yet.</div> : null}
          </div>
          {cursor ? (
            <button type="button" className="safety-btn" disabled={loadingMore} onClick={() => void loadHistory(false)}>
              {loadingMore ? 'Loading…' : 'Load older'}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
