import { useMemo } from 'react';

export type OfficialLogEntry = {
  id: string;
  fromLabel: string;
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

/** Tiny FAB + official-style log list (who → whom, API, intensity, duration, ago). */
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
            <span>Logs are a work in progress.</span>
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
                    <span className="official-log-pill official-log-pill--from ellipsis" title={row.fromLabel}>
                      {row.fromLabel}
                    </span>
                    <span className="official-log-pill official-log-pill--to ellipsis" title={row.toLabel}>
                      {row.toLabel}
                    </span>
                  </div>
                  <div className="official-log-row__bottom">
                    <div className="official-log-row__meta">
                      {row.viaApi ? (
                        <span className="official-log-pill official-log-pill--api">API</span>
                      ) : null}
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

function pickString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = row[key];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

function pickNumber(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const v = row[key];
    if (v == null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeAction(raw: string | null, intensity: number | null): OfficialLogEntry['action'] {
  const a = (raw ?? '').toLowerCase();
  if (a.includes('vib') || a === 'v' || a === '1' || a.includes('warning')) return 'vibrate';
  if (a.includes('beep') || a === 'b' || a === '2') return 'beep';
  if (a.includes('shock') || a === 's' || a === '0' || a.includes('hold')) return 'shock';
  if (intensity != null && intensity > 0) return 'shock';
  return 'other';
}

function looksLikeApi(row: Record<string, unknown>, fromLabel: string): boolean {
  const ty = pickString(row, ['Type', 'type', 'OriginType', 'originType', 'ty', 'Via', 'via']);
  if (ty && /api/i.test(ty)) return true;
  for (const key of ['IsApi', 'isApi', 'Api', 'api', 'FromApi', 'fromApi']) {
    const v = row[key];
    if (v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true') return true;
  }
  if (/api/i.test(fromLabel) && !/discord/i.test(fromLabel)) return true;
  return false;
}

function parseTimestamp(row: Record<string, unknown>): number {
  const raw = pickString(row, [
    'Time',
    'time',
    'Timestamp',
    'timestamp',
    'Date',
    'date',
    'Created',
    'created',
    'CreatedAt',
    'createdAt',
    'LogTime',
    'logTime',
  ]);
  if (!raw) return Date.now();
  // PiShock sometimes returns /Date(ms)/
  const msMatch = /\/Date\((\d+)/.exec(raw);
  if (msMatch) return Number(msMatch[1]);
  const asNum = Number(raw);
  if (Number.isFinite(asNum) && asNum > 1_000_000_000) {
    return asNum < 1e12 ? asNum * 1000 : asNum;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function durationToSec(row: Record<string, unknown>): number | null {
  const ms = pickNumber(row, ['DurationMs', 'durationMs', 'duration_ms']);
  if (ms != null) return Math.round((ms / 1000) * 10) / 10;
  const dur = pickNumber(row, ['Duration', 'duration', 'Dur', 'dur', 'd']);
  if (dur == null) return null;
  // Heuristic: values > 30 are almost certainly milliseconds
  if (dur > 30) return Math.round((dur / 1000) * 10) / 10;
  return dur;
}

/** Normalize PiShock LoadLogs payloads into display rows */
export function normalizeDeviceLogs(raw: unknown): OfficialLogEntry[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? (() => {
          const obj = raw as Record<string, unknown>;
          for (const key of ['Logs', 'logs', 'Items', 'items', 'Data', 'data', 'Entries', 'entries']) {
            if (Array.isArray(obj[key])) return obj[key] as unknown[];
          }
          return [];
        })()
      : [];

  return list
    .map((item, idx) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const fromLabel =
        pickString(row, [
          'Username',
          'UserName',
          'username',
          'userName',
          'From',
          'from',
          'FromUser',
          'fromUser',
          'Origin',
          'origin',
          'AgentName',
          'agentName',
          'Name',
          'name',
          'Owner',
          'owner',
        ]) ?? 'Unknown';
      const toLabel =
        pickString(row, [
          'ShockerName',
          'shockerName',
          'Shocker',
          'shocker',
          'Target',
          'target',
          'To',
          'to',
          'DeviceName',
          'deviceName',
        ]) ?? 'Shocker';
      const intensity = pickNumber(row, ['Intensity', 'intensity', 'Int', 'int', 'i']);
      const action = normalizeAction(
        pickString(row, ['Type', 'type', 'Mode', 'mode', 'Op', 'op', 'Operation', 'operation', 'm']),
        intensity,
      );
      const at = parseTimestamp(row);
      const id =
        pickString(row, ['Id', 'id', 'LogId', 'logId']) ?? `device-${at}-${idx}-${fromLabel}-${toLabel}`;
      return {
        id,
        fromLabel,
        toLabel,
        viaApi: looksLikeApi(row, fromLabel),
        action,
        intensity,
        durationSec: durationToSec(row),
        at,
      } satisfies OfficialLogEntry;
    })
    .filter((r): r is OfficialLogEntry => Boolean(r))
    .sort((a, b) => b.at - a.at);
}

/** Normalize activity CommandLog rows (Discord activity audit) */
export function normalizeActivityLogs(
  rows: Array<Record<string, unknown>>,
  nameByDiscordId: Record<string, string>,
): OfficialLogEntry[] {
  return rows
    .map((row, idx) => {
      const actionRaw = String(row.action ?? '').toLowerCase();
      if (actionRaw === 'end' || actionRaw === 'stop' || actionRaw.endsWith('_end')) return null;
      const executorId = row.executorDiscordUserId != null ? String(row.executorDiscordUserId) : '';
      const targetId = row.targetDiscordUserId != null ? String(row.targetDiscordUserId) : '';
      const fromLabel =
        (executorId && nameByDiscordId[executorId]) ||
        (executorId ? `${executorId} · Discord` : 'Activity');
      const toLabel =
        (targetId && nameByDiscordId[targetId]) ||
        (row.shockerId != null ? `Shocker ${row.shockerId}` : 'Shocker');
      let viaApi = false;
      if (typeof row.detail === 'string') {
        try {
          const detail = JSON.parse(row.detail) as Record<string, unknown>;
          viaApi =
            String(detail.via ?? '').toLowerCase().includes('api') ||
            String(detail.path ?? '').toLowerCase().includes('api');
        } catch {
          // ignore
        }
      }
      const intensity = typeof row.intensity === 'number' ? row.intensity : null;
      const durationMs = typeof row.durationMs === 'number' ? row.durationMs : null;
      const at = new Date(String(row.createdAt ?? '')).getTime() || Date.now() - idx;
      return {
        id: String(row.id ?? `activity-${at}-${idx}`),
        fromLabel,
        toLabel,
        viaApi,
        action: normalizeAction(actionRaw, intensity),
        intensity,
        durationSec: durationMs != null ? Math.round((durationMs / 1000) * 10) / 10 : null,
        at,
      } satisfies OfficialLogEntry;
    })
    .filter((r): r is OfficialLogEntry => Boolean(r))
    .sort((a, b) => b.at - a.at);
}
