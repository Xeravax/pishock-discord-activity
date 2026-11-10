import { useMemo } from 'react';

export type OfficialLogPerson = {
  id: string;
  displayName: string;
  avatarUrl: string;
};

export type OfficialLogEntry = {
  id: string;
  from: OfficialLogPerson;
  to: OfficialLogPerson;
  /** @deprecated use from.displayName */
  fromLabel: string;
  /** @deprecated use to.displayName */
  toLabel: string;
  viaApi: boolean;
  action: 'shock' | 'vibrate' | 'beep' | 'other';
  intensity: number | null;
  durationSec: number | null;
  at: number;
};

type Props = {
  open: boolean;
  entries: OfficialLogEntry[];
  onOpen: () => void;
  onClose: () => void;
};

function formatAgo(at: number, now: number): string {
  const sec = Math.max(0, Math.round((now - at) / 1000));
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.round(hr / 24);
  return `${day} day${day === 1 ? '' : 's'} ago`;
}

function actionIcon(action: OfficialLogEntry['action']): string {
  if (action === 'vibrate') return 'mdi-vibrate';
  if (action === 'beep') return 'mdi-bell';
  if (action === 'shock') return 'mdi-lightning-bolt';
  return 'mdi-circle-outline';
}

function formatDuration(sec: number): string {
  if (Number.isInteger(sec)) return String(sec);
  const t = Math.round(sec * 10) / 10;
  return String(t);
}

function PersonChip({
  person,
  tone,
}: {
  person: OfficialLogPerson;
  tone: 'from' | 'to';
}) {
  return (
    <span
      className={`official-log-person official-log-person--${tone}`}
      title={person.displayName}
    >
      <img src={person.avatarUrl} alt="" className="official-log-avatar" />
      <span className="ellipsis">{person.displayName}</span>
    </span>
  );
}

/** Tiny FAB + public who→whom activity log. */
export function OfficialLogsFab({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  const badge = count > 99 ? '99+' : count > 0 ? String(count) : null;
  return (
    <button
      type="button"
      className="official-logs-fab"
      onClick={onClick}
      aria-label={`Open logs${count ? `, ${count} entries` : ''}`}
      title="Logs"
    >
      <i className="q-icon mdi mdi-message-text-clock" aria-hidden />
      {badge ? <span className="official-logs-fab__badge">{badge}</span> : null}
    </button>
  );
}

export function OfficialLogsPanel({ open, entries, onClose }: Omit<Props, 'onOpen'>) {
  const now = useMemo(() => Date.now(), [open, entries.length]);
  if (!open) return null;

  return (
    <div className="ps-dialog-root" style={{ zIndex: 7200 }}>
      <div className="ps-dialog-backdrop" onClick={onClose} />
      <div
        className="ps-dialog-inner"
        role="dialog"
        aria-modal="true"
        aria-label="Logs"
      >
        <div className="official-logs-card q-card q-card--dark q-dark bg-dark">
          <div className="official-logs-banner row items-center justify-between no-wrap">
            <span>Recent activity across all sessions</span>
            <button
              type="button"
              className="q-btn q-btn-item non-selectable no-outline q-btn--flat q-btn--round text-dark q-btn--dense"
              onClick={onClose}
              aria-label="Close"
            >
              <span className="q-btn__wrapper col row q-anchor--skip">
                <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                  <i className="q-icon mdi mdi-close" aria-hidden />
                </span>
              </span>
            </button>
          </div>
          <div className="official-logs-list">
            {entries.length === 0 ? (
              <div className="text-grey-5 q-pa-md text-center">No log entries yet.</div>
            ) : (
              entries.map((row) => (
                <div key={row.id} className="official-log-row">
                  <div className="official-log-row__top">
                    <PersonChip person={row.from} tone="from" />
                    <i className="q-icon mdi mdi-arrow-right official-log-arrow" aria-hidden />
                    <PersonChip person={row.to} tone="to" />
                  </div>
                  <div className="official-log-row__bottom">
                    <div className="official-log-row__meta">
                      {row.intensity != null ? (
                        <span className="official-log-stat">
                          <i className={`q-icon mdi ${actionIcon(row.action)}`} aria-hidden />
                          {row.intensity}
                        </span>
                      ) : null}
                      {row.durationSec != null ? (
                        <span className="official-log-stat">
                          <i className="q-icon mdi mdi-clock-outline" aria-hidden />
                          {formatDuration(row.durationSec)}
                        </span>
                      ) : null}
                    </div>
                    <span className="official-log-ago">{formatAgo(row.at, now)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function normalizeAction(raw: string | null, intensity: number | null): OfficialLogEntry['action'] {
  const a = (raw ?? '').toLowerCase();
  if (a.includes('vib') || a === 'v' || a === '1' || a.includes('warning')) return 'vibrate';
  if (a.includes('beep') || a === 'b' || a === '2') return 'beep';
  if (a.includes('shock') || a === 's' || a === '0' || a.includes('hold')) return 'shock';
  if (intensity != null && intensity > 0) return 'shock';
  return 'other';
}

type PublicLogPersonApi = {
  id?: string;
  displayName?: string;
  username?: string | null;
  globalName?: string | null;
  avatarUrl?: string;
  avatar?: string | null;
};

type PublicLogApiRow = {
  id?: string;
  action?: string;
  intensity?: number | null;
  durationMs?: number | null;
  createdAt?: string;
  executor?: PublicLogPersonApi;
  target?: PublicLogPersonApi;
};

function personFromApi(
  raw: PublicLogPersonApi | undefined,
  fallbackId: string,
  avatarUrlFn: (id: string, avatar?: string | null) => string,
): OfficialLogPerson {
  const id = String(raw?.id ?? fallbackId);
  const displayName =
    raw?.displayName ||
    raw?.globalName ||
    raw?.username ||
    'Unknown';
  const avatarUrl =
    raw?.avatarUrl ||
    avatarUrlFn(id, raw?.avatar ?? null);
  return { id, displayName: String(displayName), avatarUrl };
}

/** Normalize the global public activity feed from GET /api/logs */
export function normalizePublicLogs(
  rows: PublicLogApiRow[],
  avatarUrlFn: (id: string, avatar?: string | null) => string,
): OfficialLogEntry[] {
  const out: OfficialLogEntry[] = [];
  rows.forEach((row, idx) => {
    const actionRaw = String(row.action ?? '').toLowerCase();
    if (
      actionRaw === 'end' ||
      actionRaw === 'stop' ||
      actionRaw.endsWith('_end') ||
      actionRaw.startsWith('emergency_stop') ||
      actionRaw.startsWith('pause_')
    ) {
      return;
    }
    const executorId = String(row.executor?.id ?? '');
    const targetId = String(row.target?.id ?? '');
    if (!executorId || !targetId) return;
    const from = personFromApi(row.executor, executorId, avatarUrlFn);
    const to = personFromApi(row.target, targetId, avatarUrlFn);
    const intensity = typeof row.intensity === 'number' ? row.intensity : null;
    const durationMs = typeof row.durationMs === 'number' ? row.durationMs : null;
    const at = new Date(String(row.createdAt ?? '')).getTime() || Date.now() - idx;
    out.push({
      id: String(row.id ?? `public-${at}-${idx}`),
      from,
      to,
      fromLabel: from.displayName,
      toLabel: to.displayName,
      viaApi: false,
      action: normalizeAction(actionRaw, intensity),
      intensity,
      durationSec: durationMs != null ? Math.round((durationMs / 1000) * 10) / 10 : null,
      at,
    });
  });
  return out.sort((a, b) => b.at - a.at);
}

/** @deprecated device website logs are no longer shown in the activity log panel */
export function normalizeDeviceLogs(_raw: unknown): OfficialLogEntry[] {
  return [];
}

/** Fallback for legacy personal activity rows without nested executor/target objects */
export function normalizeActivityLogs(
  rows: Array<Record<string, unknown>>,
  nameByDiscordId: Record<string, string>,
  avatarByDiscordId: Record<string, string> = {},
  avatarUrlFn?: (id: string, avatar?: string | null) => string,
): OfficialLogEntry[] {
  const fallbackAvatar =
    avatarUrlFn ??
    ((id: string) => `https://cdn.discordapp.com/embed/avatars/${Number(id) % 6}.png`);

  const out: OfficialLogEntry[] = [];
  rows.forEach((row, idx) => {
    const actionRaw = String(row.action ?? '').toLowerCase();
    if (actionRaw === 'end' || actionRaw === 'stop' || actionRaw.endsWith('_end')) return;
    const executorId = row.executorDiscordUserId != null ? String(row.executorDiscordUserId) : '';
    const targetId = row.targetDiscordUserId != null ? String(row.targetDiscordUserId) : '';
    if (!executorId || !targetId) return;
    const from: OfficialLogPerson = {
      id: executorId,
      displayName: nameByDiscordId[executorId] || 'Someone',
      avatarUrl: avatarByDiscordId[executorId] || fallbackAvatar(executorId),
    };
    const to: OfficialLogPerson = {
      id: targetId,
      displayName: nameByDiscordId[targetId] || 'Someone',
      avatarUrl: avatarByDiscordId[targetId] || fallbackAvatar(targetId),
    };
    const intensity = typeof row.intensity === 'number' ? row.intensity : null;
    const durationMs = typeof row.durationMs === 'number' ? row.durationMs : null;
    const at = new Date(String(row.createdAt ?? '')).getTime() || Date.now() - idx;
    out.push({
      id: String(row.id ?? `activity-${at}-${idx}`),
      from,
      to,
      fromLabel: from.displayName,
      toLabel: to.displayName,
      viaApi: false,
      action: normalizeAction(actionRaw, intensity),
      intensity,
      durationSec: durationMs != null ? Math.round((durationMs / 1000) * 10) / 10 : null,
      at,
    });
  });
  return out.sort((a, b) => b.at - a.at);
}
