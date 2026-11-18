import { useCallback, useEffect, useState } from 'react';
import {
  BAN_LENGTHS,
  adminApi,
  describeBanLength,
  type AdminAuditEntry,
  type AdminBanListEntry,
  type AdminOverview,
  type AdminProfile,
  type AdminUserRow,
} from '../admin';
import { participantAvatarUrl } from '../participants';

type Tab = 'overview' | 'people' | 'bans' | 'audit' | 'notice';

const TABS: Array<[Tab, string, string]> = [
  ['overview', 'Overview', 'mdi-view-dashboard-outline'],
  ['people', 'People', 'mdi-account-search-outline'],
  ['bans', 'Bans', 'mdi-gavel'],
  ['audit', 'Audit log', 'mdi-clipboard-text-clock-outline'],
  ['notice', 'Notice', 'mdi-bullhorn-outline'],
];

const FEATURE_LABELS: Record<string, string> = {
  commandQueue: 'Command queue',
  favoritesOnly: 'Favorites only',
  approveEach: 'Approve each',
  budget: 'Shock budget',
  checkIns: 'Check-ins',
  perPersonLimits: 'Per-person limits',
  roulette: 'Roulette',
  recapDms: 'Recap DMs',
  adminLimitConsent: 'Admin limit consent',
};

const AUDIT_LABELS: Record<string, string> = {
  view_profile: 'viewed the profile of',
  ban: 'banned',
  unban: 'lifted the ban on',
  set_notice: 'set the app notice',
  clear_notice: 'cleared the app notice',
};

const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleString() : '—');
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function uptime(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${m}m`;
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'danger' }) {
  return (
    <div className={`admin-stat${tone ? ` admin-stat--${tone}` : ''}`}>
      <div className="admin-stat__value">{value}</div>
      <div className="admin-stat__label">{label}</div>
    </div>
  );
}

function Tally({ title, counts }: { title: string; counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return (
    <div className="admin-tally">
      <div className="admin-label">{title}</div>
      {entries.length ? (
        <div className="admin-chips">
          {entries.map(([k, v]) => (
            <span key={k} className="admin-chip">
              {k} <strong>{v}</strong>
            </span>
          ))}
        </div>
      ) : (
        <div className="admin-muted">Nothing</div>
      )}
    </div>
  );
}

function OverviewTab({ token }: { token: string }) {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    adminApi.overview(token).then(setData, (e) => setError(errText(e)));
  }, [token]);
  useEffect(load, [load]);
  if (error) return <div className="text-negative">{error}</div>;
  if (!data) return <div className="admin-muted">Loading…</div>;
  const total24h = Object.values(data.commands24h).reduce((a, b) => a + b, 0);
  return (
    <div className="ps-stack ps-stack--lg">
      <div className="admin-stats">
        <Stat label="Online now" value={data.live.users} />
        <Stat label="Activity rooms" value={data.live.instances} />
        <Stat label="Commands (24h)" value={total24h} />
        <Stat label="People" value={data.users} />
        <Stat label="Consented" value={data.consented} />
        <Stat label="PiShock linked" value={data.pishockLinked} />
        <Stat label="Sharing a shocker" value={data.sharing} />
        <Stat label="Active bans" value={data.activeBans} tone={data.activeBans ? 'danger' : undefined} />
        <Stat label="E-STOPs engaged" value={data.emergencyStopsEngaged} />
        <Stat label="Admin bypasses (7d)" value={data.adminBypasses7d} tone={data.adminBypasses7d ? 'danger' : undefined} />
        <Stat label="Pending deletions" value={data.pendingDeletions} />
      </div>
      <Tally title="Commands in the last 24 hours" counts={data.commands24h} />
      <div className="admin-tally">
        <div className="admin-label">App</div>
        <div className="admin-kv">
          <span>Version</span>
          <code>{data.version}</code>
          <span>Uptime</span>
          <span>{uptime(data.uptimeMs)}</span>
          <span>Live sockets</span>
          <span>{data.live.sockets}</span>
          <span>Admins</span>
          <span>{data.admins.map((a) => a.name).join(', ') || '—'}</span>
        </div>
      </div>
      <div className="row justify-end">
        <button type="button" className="safety-btn safety-btn--ghost" onClick={load}>
          <i className="q-icon mdi mdi-refresh" aria-hidden /> Refresh
        </button>
      </div>
    </div>
  );
}

function Person({ id, name, avatar }: { id: string; name: string; avatar?: string | null }) {
  return (
    <span className="admin-person">
      <img src={participantAvatarUrl(id, avatar)} alt="" width={28} height={28} />
      <span className="admin-person__text">
        <span className="admin-person__name">{name}</span>
        <span className="admin-person__id">{id}</span>
      </span>
    </span>
  );
}

function BanForm({
  name,
  busy,
  onCancel,
  onConfirm,
}: {
  name: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string, days: number | null) => void;
}) {
  const [reason, setReason] = useState('');
  const [days, setDays] = useState<number | null>(7);
  const [confirming, setConfirming] = useState(false);
  const trimmed = reason.trim();
  const ok = trimmed.length >= 10 && trimmed.length <= 1000;
  return (
    <div className="admin-ban-form ps-stack">
      <div className="admin-label">Ban {name} from the activity</div>
      <label className="admin-field">
        <span>Reason — shown to {name} on their ban screen</span>
        <textarea
          rows={4}
          maxLength={1000}
          value={reason}
          placeholder="Describe what happened. Be factual; the user reads this."
          onChange={(e) => {
            setReason(e.target.value);
            setConfirming(false);
          }}
        />
        <span className={`admin-counter${ok || !trimmed ? '' : ' is-bad'}`}>
          {trimmed.length}/1000 · at least 10
        </span>
      </label>
      <div className="admin-label">Length</div>
      <div className="admin-segments" role="radiogroup" aria-label="Ban length">
        {BAN_LENGTHS.map((b) => (
          <button
            key={String(b.days)}
            type="button"
            role="radio"
            aria-checked={days === b.days}
            className={`admin-segment${days === b.days ? ' is-active' : ''}`}
            onClick={() => {
              setDays(b.days);
              setConfirming(false);
            }}
          >
            {b.label}
          </button>
        ))}
      </div>
      <p className="admin-muted">
        Their shared shockers are paused, their queue is cleared and they are disconnected right away.
      </p>
      <div className="admin-actions">
        <button type="button" className="safety-btn safety-btn--ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        {confirming ? (
          <button
            type="button"
            className="safety-btn safety-btn--danger"
            disabled={busy || !ok}
            onClick={() => onConfirm(trimmed, days)}
          >
            Yes, ban {name}
          </button>
        ) : (
          <button
            type="button"
            className="safety-btn safety-btn--danger"
            disabled={busy || !ok}
            onClick={() => setConfirming(true)}
          >
            Ban…
          </button>
        )}
      </div>
    </div>
  );
}

function ProfileView({
  token,
  id,
  onBack,
  onChanged,
}: {
  token: string;
  id: string;
  onBack: () => void;
  onChanged?: () => void;
}) {
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [banning, setBanning] = useState(false);
  const [unbanReason, setUnbanReason] = useState('');

  const load = useCallback(() => {
    adminApi.profile(token, id).then(
      (res) => {
        setProfile(res.profile);
        setNames(res.names);
      },
      (e) => setError(errText(e)),
    );
  }, [token, id]);
  useEffect(load, [load]);

  if (error && !profile) return <div className="text-negative">{error}</div>;
  if (!profile) return <div className="admin-muted">Loading…</div>;
  const name = profile.globalName || profile.username || profile.id;
  const activeBan = profile.bans.find((b) => b.active) ?? null;

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setNotice(done);
      setBanning(false);
      setUnbanReason('');
      load();
      onChanged?.();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ps-stack ps-stack--lg">
      <button type="button" className="admin-back" onClick={onBack}>
        <i className="q-icon mdi mdi-arrow-left" aria-hidden /> All people
      </button>
      <div className="admin-profile-head">
        <img src={participantAvatarUrl(profile.id, profile.avatar)} alt="" width={56} height={56} />
        <div className="admin-profile-head__text">
          <div className="admin-profile-head__name">
            {name}
            {profile.isAdmin ? <span className="admin-badge">Admin</span> : null}
            {activeBan ? <span className="admin-badge admin-badge--danger">Banned</span> : null}
          </div>
          <div className="admin-muted">
            @{profile.username ?? '—'} · <code>{profile.id}</code>
          </div>
          <div className="admin-muted">
            <span className={`admin-dot${profile.online ? ' is-on' : ''}`} aria-hidden />
            {profile.online ? 'In the activity now' : `Last seen ${fmt(profile.lastSeenAt)}`}
          </div>
        </div>
      </div>

      <div className="admin-privacy-note">
        <i className="q-icon mdi mdi-shield-lock-outline" aria-hidden />
        Counts and settings only — PiShock account, keys, devices, limits and who did what to whom are
        not shown. This view is recorded in the audit log.
      </div>

      <div className="admin-kv">
        <span>First seen</span>
        <span>{fmt(profile.firstSeenAt)}</span>
        <span>Safety notice accepted</span>
        <span>{profile.consented ? 'Yes' : 'No'}</span>
        <span>PiShock linked</span>
        <span>{profile.pishockLinked ? 'Yes' : 'No'}</span>
        <span>Shared shockers</span>
        <span>
          {profile.shares.enabled} on · {profile.shares.paused} paused · {profile.shares.total} total
        </span>
        <span>E-STOP engaged</span>
        <span>{profile.emergencyStopEngaged ? 'Yes' : 'No'}</span>
        <span>Blocked by</span>
        <span>
          {profile.blockedByCount} {profile.blockedByCount === 1 ? 'person' : 'people'}
        </span>
        <span>Blocks set</span>
        <span>{profile.blocksSetCount}</span>
        <span>Data deletion</span>
        <span>{profile.deletionPending ? 'Requested (grace period)' : 'No'}</span>
      </div>

      <div className="admin-tally">
        <div className="admin-label">Extra features</div>
        <div className="admin-chips">
          {Object.entries(profile.features).map(([k, on]) => (
            <span key={k} className={`admin-chip${on ? ' is-on' : ''}`}>
              {FEATURE_LABELS[k] ?? k}
            </span>
          ))}
        </div>
      </div>

      <div className="admin-two">
        <Tally title={`Sent (${profile.stats.windowDays} days)`} counts={profile.stats.sent} />
        <Tally title={`Received (${profile.stats.windowDays} days)`} counts={profile.stats.received} />
      </div>
      {profile.stats.adminBypassesReceived ? (
        <div className="admin-muted">
          Admin bypasses on them in the last {profile.stats.windowDays} days:{' '}
          <strong className="text-negative">{profile.stats.adminBypassesReceived}</strong>
        </div>
      ) : null}

      <div className="admin-tally">
        <div className="admin-label">Ban history</div>
        {profile.bans.length ? (
          <ul className="admin-ban-list">
            {profile.bans.map((b) => (
              <li key={b.id} className={b.active ? 'is-active' : undefined}>
                <div className="admin-ban-list__head">
                  <strong>{b.active ? 'Active' : b.liftedAt ? 'Lifted' : 'Expired'}</strong>
                  <span className="admin-muted">
                    {fmt(b.createdAt)} by {names[b.bannedBy] ?? b.bannedBy} · {describeBanLength(b.expiresAt)}
                  </span>
                </div>
                <blockquote>{b.reason}</blockquote>
                {b.liftedAt ? (
                  <div className="admin-muted">
                    Lifted {fmt(b.liftedAt)} by {names[b.liftedBy ?? ''] ?? b.liftedBy}
                    {b.liftReason ? ` — ${b.liftReason}` : ''}
                  </div>
                ) : null}
                <div className="admin-muted">
                  Reference <code>{b.id}</code>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="admin-muted">Never banned</div>
        )}
      </div>

      {error ? <div className="text-negative">{error}</div> : null}
      {notice ? <div className="text-positive">{notice}</div> : null}

      {profile.isAdmin ? (
        <div className="admin-muted">Admins can’t be banned from the panel.</div>
      ) : activeBan ? (
        <div className="admin-ban-form ps-stack">
          <div className="admin-label">Lift the ban</div>
          <label className="admin-field">
            <span>Why are you lifting it? (kept in the audit log)</span>
            <input value={unbanReason} maxLength={1000} onChange={(e) => setUnbanReason(e.target.value)} />
          </label>
          <div className="admin-actions">
            <button
              type="button"
              className="safety-btn safety-btn--accept"
              disabled={busy || unbanReason.trim().length < 3}
              onClick={() => void run(() => adminApi.unban(token, profile.id, unbanReason.trim()), 'Ban lifted.')}
            >
              Lift ban
            </button>
          </div>
        </div>
      ) : banning ? (
        <BanForm
          name={name}
          busy={busy}
          onCancel={() => setBanning(false)}
          onConfirm={(reason, days) =>
            void run(() => adminApi.ban(token, profile.id, reason, days), `${name} is banned.`)
          }
        />
      ) : (
        <div className="admin-actions">
          <button type="button" className="safety-btn safety-btn--danger" onClick={() => setBanning(true)}>
            <i className="q-icon mdi mdi-gavel" aria-hidden /> Ban from the activity…
          </button>
        </div>
      )}
    </div>
  );
}

function PeopleTab({ token, openId, onOpen }: { token: string; openId: string | null; onOpen: (id: string | null) => void }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<AdminUserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const search = useCallback(
    (query: string) => {
      adminApi.users(token, query).then(
        (res) => {
          setRows(res.users);
          setError(null);
        },
        (e) => setError(errText(e)),
      );
    },
    [token],
  );
  useEffect(() => {
    if (openId) return;
    const t = window.setTimeout(() => search(q), 250);
    return () => window.clearTimeout(t);
  }, [q, search, openId]);

  if (openId) return <ProfileView token={token} id={openId} onBack={() => onOpen(null)} />;
  return (
    <div className="ps-stack">
      <label className="admin-search">
        <i className="q-icon mdi mdi-magnify" aria-hidden />
        <input
          type="search"
          placeholder="Search by name or Discord ID"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search people"
        />
      </label>
      {error ? <div className="text-negative">{error}</div> : null}
      {!rows ? (
        <div className="admin-muted">Loading…</div>
      ) : rows.length ? (
        <ul className="admin-rows">
          {rows.map((u) => (
            <li key={u.id}>
              <button type="button" className="admin-row" onClick={() => onOpen(u.id)}>
                <Person id={u.id} name={u.globalName || u.username || u.id} avatar={u.avatar} />
                <span className="admin-row__meta">
                  {u.isAdmin ? <span className="admin-badge">Admin</span> : null}
                  {u.banned ? <span className="admin-badge admin-badge--danger">Banned</span> : null}
                  <span className={`admin-dot${u.online ? ' is-on' : ''}`} aria-label={u.online ? 'online' : 'offline'} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="admin-muted">No one found.</div>
      )}
    </div>
  );
}

function BansTab({ token, onOpen }: { token: string; onOpen: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const [data, setData] = useState<{ bans: AdminBanListEntry[]; names: Record<string, string> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    adminApi.bans(token, all).then(setData, (e) => setError(errText(e)));
  }, [token, all]);
  return (
    <div className="ps-stack">
      <div className="admin-segments" role="radiogroup" aria-label="Which bans">
        {(
          [
            [false, 'Active'],
            [true, 'All, incl. history'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={all === value}
            className={`admin-segment${all === value ? ' is-active' : ''}`}
            onClick={() => setAll(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {error ? <div className="text-negative">{error}</div> : null}
      {!data ? (
        <div className="admin-muted">Loading…</div>
      ) : data.bans.length ? (
        <ul className="admin-ban-list">
          {data.bans.map((b) => (
            <li key={b.id} className={b.active ? 'is-active' : undefined}>
              <button type="button" className="admin-row admin-row--flat" onClick={() => onOpen(b.discordUserId)}>
                <Person id={b.discordUserId} name={data.names[b.discordUserId] ?? b.discordUserId} />
                <span className="admin-row__meta admin-muted">{describeBanLength(b.expiresAt)}</span>
              </button>
              <blockquote>{b.reason}</blockquote>
              <div className="admin-muted">
                {fmt(b.createdAt)} by {data.names[b.bannedBy] ?? b.bannedBy}
                {b.liftedAt ? ` · lifted ${fmt(b.liftedAt)}` : ''}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="admin-muted">{all ? 'No bans yet.' : 'No active bans.'}</div>
      )}
    </div>
  );
}

function AuditTab({ token }: { token: string }) {
  const [data, setData] = useState<{ entries: AdminAuditEntry[]; names: Record<string, string> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    adminApi.audit(token).then(setData, (e) => setError(errText(e)));
  }, [token]);
  if (error) return <div className="text-negative">{error}</div>;
  if (!data) return <div className="admin-muted">Loading…</div>;
  if (!data.entries.length) return <div className="admin-muted">No admin actions yet.</div>;
  return (
    <ul className="admin-audit">
      {data.entries.map((e) => (
        <li key={e.id} className={e.action === 'ban' ? 'is-danger' : undefined}>
          <span className="admin-audit__when">{fmt(e.createdAt)}</span>
          <span>
            <strong>{data.names[e.adminDiscordUserId] ?? e.adminDiscordUserId}</strong>{' '}
            {AUDIT_LABELS[e.action] ?? e.action}
            {e.targetDiscordUserId ? (
              <>
                {' '}
                <strong>{data.names[e.targetDiscordUserId] ?? e.targetDiscordUserId}</strong>
              </>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function NoticeTab({ token }: { token: string }) {
  const [text, setText] = useState('');
  const [level, setLevel] = useState<'info' | 'warning'>('info');
  const [hours, setHours] = useState<number | null>(null);
  const [current, setCurrent] = useState<AdminOverview['notice']>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    adminApi.overview(token).then(
      (o) => {
        setCurrent(o.notice);
        if (o.notice) {
          setText(o.notice.text);
          setLevel(o.notice.level);
        }
      },
      () => undefined,
    );
  }, [token]);
  const save = async (clear: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await adminApi.setNotice(token, clear ? null : { text: text.trim(), level, expiresInHours: hours });
      setCurrent(res.notice);
      if (clear) setText('');
      setMsg(clear ? 'Notice removed for everyone.' : 'Notice is live for everyone.');
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ps-stack ps-stack--lg">
      <p className="admin-muted">
        A short message shown at the top of the activity for everyone, e.g. planned maintenance.
      </p>
      <label className="admin-field">
        <span>Message</span>
        <textarea rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
        <span className="admin-counter">{text.trim().length}/500</span>
      </label>
      <div className="admin-label">Style</div>
      <div className="admin-segments" role="radiogroup" aria-label="Notice style">
        {(['info', 'warning'] as const).map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={level === l}
            className={`admin-segment${level === l ? ' is-active' : ''}`}
            onClick={() => setLevel(l)}
          >
            {l === 'info' ? 'Info' : 'Warning'}
          </button>
        ))}
      </div>
      <div className="admin-label">Hide automatically after</div>
      <div className="admin-segments" role="radiogroup" aria-label="Notice expiry">
        {(
          [
            [1, '1 hour'],
            [6, '6 hours'],
            [24, '1 day'],
            [168, '1 week'],
            [null, 'Never'],
          ] as const
        ).map(([h, label]) => (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={hours === h}
            className={`admin-segment${hours === h ? ' is-active' : ''}`}
            onClick={() => setHours(h)}
          >
            {label}
          </button>
        ))}
      </div>
      {msg ? <div className="admin-muted">{msg}</div> : null}
      <div className="admin-actions">
        {current ? (
          <button type="button" className="safety-btn safety-btn--ghost" disabled={busy} onClick={() => void save(true)}>
            Remove notice
          </button>
        ) : null}
        <button
          type="button"
          className="safety-btn safety-btn--accept"
          disabled={busy || !text.trim()}
          onClick={() => void save(false)}
        >
          {current ? 'Update notice' : 'Publish notice'}
        </button>
      </div>
    </div>
  );
}

/** Menu → Admin (admins only; every call is re-checked on the server). */
export function AdminPanel({ token }: { token: string }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="admin-panel">
      <div className="admin-tabs" role="tablist" aria-label="Admin sections">
        {TABS.map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`admin-tab${tab === id ? ' is-active' : ''}`}
            onClick={() => {
              setTab(id);
              if (id !== 'people') setOpenId(null);
            }}
          >
            <i className={`q-icon mdi ${icon}`} aria-hidden />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="admin-panel__body" role="tabpanel">
        {tab === 'overview' ? <OverviewTab token={token} /> : null}
        {tab === 'people' ? <PeopleTab token={token} openId={openId} onOpen={setOpenId} /> : null}
        {tab === 'bans' ? (
          <BansTab
            token={token}
            onOpen={(id) => {
              setOpenId(id);
              setTab('people');
            }}
          />
        ) : null}
        {tab === 'audit' ? <AuditTab token={token} /> : null}
        {tab === 'notice' ? <NoticeTab token={token} /> : null}
      </div>
    </div>
  );
}
