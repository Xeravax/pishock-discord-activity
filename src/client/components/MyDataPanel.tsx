import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { openExternal } from '../discord';

type Deletion = { id: string; mode: 'delete' | 'anonymise'; requestedAt: string; executeAfter: string } | null;

type DataSummary = {
  profile: {
    id: string;
    username: string | null;
    globalName: string | null;
    consentAt: string | null;
    createdAt: string;
    lastSeenAt: string | null;
    logRetentionDays: number | null;
    adminLimitOverrideConsentAt: string | null;
  } | null;
  pishock: { pishockUsername: string; pishockUserId: number; createdAt: string; apiKey: string } | null;
  counts: {
    shares: number;
    blocks: number;
    favorites: number;
    personLimits: number;
    logsOwned: number;
    logsAboutYou: number;
    logsByYou: number;
  };
  oldestLogAt: string | null;
  retentionDays: number | null;
  deletion: Deletion;
};

const RETENTION: Array<{ value: number | null; label: string }> = [
  { value: 30, label: '30 days' },
  { value: 90, label: '3 months' },
  { value: 180, label: '6 months' },
  { value: 365, label: '12 months (default)' },
  { value: null, label: 'Keep until I delete' },
];

function fmt(date: string | null | undefined): string {
  return date ? new Date(date).toLocaleString() : '—';
}

/** Menu → My data: what we store, download it, choose retention, delete or anonymise. */
export function MyDataPanel({ token, onDeletionRequested }: { token: string; onDeletionRequested?: () => void }) {
  const [data, setData] = useState<DataSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'delete' | 'anonymise'>('delete');
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch<{ data: DataSummary }>('/me/data', token);
    setData(res.data);
  }, [token]);

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return error ? (
      <div className="ps-callout ps-callout--error" role="alert">
        {error}
      </div>
    ) : (
      <div className="text-grey-5 q-pa-md">Loading your data…</div>
    );
  }

  const c = data.counts;
  return (
    <div className="ps-stack ps-stack--lg my-data">
      <p className="text-grey-5 text-body2" style={{ margin: 0 }}>
        Everything this activity stores about you. You can download it, choose how long logs are
        kept, or have it deleted.
      </p>
      {error ? (
        <div className="ps-callout ps-callout--error" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? <div className="ps-callout ps-callout--success">{notice}</div> : null}

      <div>
        <div className="ps-section-title">What we store</div>
        <dl className="my-data__list">
          <dt>Discord account</dt>
          <dd>
            {data.profile?.globalName || data.profile?.username || '—'} ({data.profile?.id})
          </dd>
          <dt>Safety acknowledgement</dt>
          <dd>{fmt(data.profile?.consentAt)}</dd>
          <dt>PiShock account</dt>
          <dd>
            {data.pishock
              ? `${data.pishock.pishockUsername} — API key ${data.pishock.apiKey}`
              : 'Not linked'}
          </dd>
          <dt>Shared shockers</dt>
          <dd>{c.shares}</dd>
          <dt>Blocks · favorites · per-person limits you set</dt>
          <dd>
            {c.blocks} · {c.favorites} · {c.personLimits}
          </dd>
          <dt>Log entries</dt>
          <dd>
            {c.logsOwned} ({c.logsAboutYou} about you, {c.logsByYou} sent by you) · oldest{' '}
            {fmt(data.oldestLogAt)}
          </dd>
          <dt>Admin access to your limits</dt>
          <dd>{data.profile?.adminLimitOverrideConsentAt ? `Granted ${fmt(data.profile.adminLimitOverrideConsentAt)}` : 'Not granted'}</dd>
          <dt>Last seen</dt>
          <dd>{fmt(data.profile?.lastSeenAt)}</dd>
        </dl>
      </div>

      <div>
        <div className="ps-section-title">Keep my logs for</div>
        <div className="my-data__retention" role="radiogroup" aria-label="Log retention">
          {RETENTION.map((opt) => (
            <button
              key={String(opt.value)}
              type="button"
              role="radio"
              aria-checked={data.retentionDays === opt.value}
              disabled={busy}
              className={`log-privacy__scope${data.retentionDays === opt.value ? ' is-active' : ''}`}
              onClick={() =>
                void run(async () => {
                  const res = await apiFetch<{ data: DataSummary }>('/me/data/retention', token, {
                    method: 'PUT',
                    body: JSON.stringify({ days: opt.value }),
                  });
                  setData(res.data);
                  setNotice('Retention saved. Older entries are removed within the hour.');
                })
              }
            >
              <span className="log-privacy__scope-title">{opt.label}</span>
            </button>
          ))}
        </div>
        <p className="log-privacy__note">
          Applies to your copy of each log entry. The other person in a command keeps their own copy
          under their own setting.
        </p>
      </div>

      <div>
        <div className="ps-section-title">Download my data</div>
        <button
          type="button"
          className="safety-btn"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const res = await apiFetch<{ url: string }>('/me/export', token, { method: 'POST', body: '{}' });
              await openExternal(res.url);
              setNotice('Your download opened in the browser. The link works once, for 10 minutes.');
            })
          }
        >
          <i className="q-icon mdi mdi-download" aria-hidden /> Export as JSON
        </button>
      </div>

      <div>
        <div className="ps-section-title">Delete my data</div>
        {data.deletion ? (
          <div className="ps-callout ps-callout--error">
            <strong>{data.deletion.mode === 'anonymise' ? 'Anonymisation' : 'Deletion'} scheduled</strong> for{' '}
            {fmt(data.deletion.executeAfter)}. Your PiShock key was removed and sharing is off. You
            can still cancel until then.
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="safety-btn"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await apiFetch('/me/deletion', token, { method: 'DELETE' });
                    await load();
                    setNotice('Cancelled. Re-link PiShock and turn sharing back on to continue using it.');
                  })
                }
              >
                Cancel request
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="my-data__retention" role="radiogroup" aria-label="Delete or anonymise">
              {(
                [
                  ['delete', 'Delete', 'Remove your account data and your log copies.'],
                  [
                    'anonymise',
                    'Anonymise',
                    'Remove everything that identifies you; keep your logs as anonymous history.',
                  ],
                ] as const
              ).map(([id, title, hint]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={mode === id}
                  className={`log-privacy__scope${mode === id ? ' is-active' : ''}`}
                  onClick={() => setMode(id)}
                >
                  <span className="log-privacy__scope-title">{title}</span>
                  <span className="log-privacy__scope-hint">{hint}</span>
                </button>
              ))}
            </div>
            <p className="log-privacy__note">
              Runs after 7 days so you can change your mind. Right away: your PiShock key is removed
              from this app, sharing is turned off and your queue is cleared. In other people’s logs
              you become “Deleted user”. Blocks and limits others set on you are kept, so they stay
              protected if you come back.
            </p>
            {confirming ? (
              <div className="row items-center q-gutter-sm">
                <span className="text-negative">Are you sure?</span>
                <button type="button" className="safety-btn" disabled={busy} onClick={() => setConfirming(false)}>
                  No
                </button>
                <button
                  type="button"
                  className="safety-btn safety-btn--danger"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await apiFetch('/me/deletion', token, {
                        method: 'POST',
                        body: JSON.stringify({ mode }),
                      });
                      setConfirming(false);
                      await load();
                      onDeletionRequested?.();
                    })
                  }
                >
                  Yes, {mode === 'anonymise' ? 'anonymise' : 'delete'} in 7 days
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="safety-btn safety-btn--danger"
                disabled={busy}
                onClick={() => setConfirming(true)}
              >
                Request {mode === 'anonymise' ? 'anonymisation' : 'deletion'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
