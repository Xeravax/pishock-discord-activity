import { useEffect, useMemo, useState } from 'react';
import { participantAvatarUrl } from '../participants';

/** FAB that opens the wearer's command queue (matches logs button style). */
export function QueueFab({
  count,
  enabled,
  paused,
  active,
  onClick,
}: {
  count: number;
  enabled: boolean;
  paused: boolean;
  active: boolean;
  onClick: () => void;
}) {
  const badge = count > 99 ? '99+' : count > 0 ? String(count) : active ? '•' : null;
  const title = enabled
    ? paused
      ? 'Command queue (paused)'
      : active || count > 0
        ? `Command queue (${count} waiting)`
        : 'Command queue'
    : 'Command queue (off)';
  return (
    <button
      type="button"
      className={`official-logs-fab queue-fab${enabled ? ' is-enabled' : ''}${paused ? ' is-paused' : ''}`}
      onClick={onClick}
      aria-label={title}
      title={title}
    >
      <i className="q-icon mdi mdi-playlist-play" aria-hidden />
      {badge ? <span className="official-logs-fab__badge">{badge}</span> : null}
    </button>
  );
}

export type QueuePanelItem = {
  id: string;
  executorDiscordUserId: string;
  executorUsername: string | null;
  executorGlobalName: string | null;
  executorAvatar: string | null;
  operation: string;
  intensity: number;
  durationMs: number;
  hold: boolean;
  warning: boolean;
  shockerId: number;
  enqueuedAt: number;
  priority: boolean;
};

export type QueuePanelSettings = {
  enabled: boolean;
  progressMs: number;
  maxPerSender: number;
  starOnly: boolean;
};

type Props = {
  settings: QueuePanelSettings;
  paused: boolean;
  active: QueuePanelItem | null;
  waiting: QueuePanelItem[];
  busy?: boolean;
  onClose?: () => void;
  onSettingsChange: (patch: Partial<QueuePanelSettings>) => void;
  onTogglePaused: (paused: boolean) => void;
  onSkip: () => void;
  onClear: () => void;
  onRemove: (itemId: string) => void;
  /** Star / unstar someone for priority + stars-only access */
  onToggleStar?: (discordUserId: string, starred: boolean) => void;
  displayNameFor: (item: QueuePanelItem) => string;
  avatarUrlFor?: (item: QueuePanelItem) => string;
};

function formatOp(item: QueuePanelItem): string {
  if (item.hold || item.operation === 'hold') return 'Hold';
  if (item.warning || item.operation === 'warning') return 'Warn';
  const op = item.operation.replace(/^participant_/, '');
  return op.charAt(0).toUpperCase() + op.slice(1);
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s`;
}

function defaultAvatarUrl(item: QueuePanelItem): string {
  return participantAvatarUrl(item.executorDiscordUserId, item.executorAvatar);
}

type PersonRow = {
  key: string;
  discordUserId: string;
  name: string;
  avatarUrl: string;
  starred: boolean;
  status: 'now' | 'waiting';
  position: number | null;
  detail: string;
  itemIds: string[];
};

export function QueuePanel({
  settings,
  paused,
  active,
  waiting,
  busy = false,
  onClose,
  onSettingsChange,
  onTogglePaused,
  onSkip,
  onClear,
  onRemove,
  onToggleStar,
  displayNameFor,
  avatarUrlFor = defaultAvatarUrl,
}: Props) {
  const { enabled, progressMs, maxPerSender, starOnly } = settings;
  const [progressSecDraft, setProgressSecDraft] = useState(
    () => Math.round(progressMs / 100) / 10,
  );
  const [maxPerSenderDraft, setMaxPerSenderDraft] = useState(maxPerSender);

  useEffect(() => {
    setProgressSecDraft(Math.round(progressMs / 100) / 10);
  }, [progressMs]);
  useEffect(() => {
    setMaxPerSenderDraft(maxPerSender);
  }, [maxPerSender]);

  const commitProgress = () => {
    const sec = Number(progressSecDraft);
    const nextMs = Number.isFinite(sec)
      ? Math.round(Math.max(0, Math.min(60, sec)) * 1000)
      : progressMs;
    setProgressSecDraft(Math.round(nextMs / 100) / 10);
    if (nextMs !== progressMs) onSettingsChange({ progressMs: nextMs });
  };

  const commitMaxPerSender = () => {
    const n = Math.floor(Number(maxPerSenderDraft));
    const next = Number.isFinite(n) ? Math.max(1, Math.min(1_000_000, n)) : maxPerSender;
    setMaxPerSenderDraft(next);
    if (next !== maxPerSender) onSettingsChange({ maxPerSender: next });
  };

  const people = useMemo(() => {
    const rows: PersonRow[] = [];
    if (active) {
      rows.push({
        key: `active:${active.id}`,
        discordUserId: active.executorDiscordUserId,
        name: displayNameFor(active),
        avatarUrl: avatarUrlFor(active),
        starred: active.priority,
        status: 'now',
        position: null,
        detail: `${formatOp(active)} · ${active.intensity}% · ${formatDuration(active.durationMs)}`,
        itemIds: [active.id],
      });
    }
    waiting.forEach((item, idx) => {
      rows.push({
        key: `wait:${item.id}`,
        discordUserId: item.executorDiscordUserId,
        name: displayNameFor(item),
        avatarUrl: avatarUrlFor(item),
        starred: item.priority,
        status: 'waiting',
        position: idx + 1,
        detail: `${formatOp(item)} · ${item.intensity}% · ${formatDuration(item.durationMs)}`,
        itemIds: [item.id],
      });
    });
    return rows;
  }, [active, waiting, displayNameFor, avatarUrlFor]);

  const starredCount = people.filter((p) => p.starred).length;

  return (
    <div className="queue-dash">
      <div className="queue-panel queue-panel--controls">
        <div className="row items-center justify-between queue-panel-header">
          <div className="row items-center no-wrap q-gutter-xs">
            <i
              className="q-icon mdi mdi-playlist-play text-secondary"
              style={{ fontSize: 16 }}
              aria-hidden
            />
            <div className="text-secondary queue-panel-title">CONTROLS</div>
          </div>
          <div className="row items-center no-wrap q-gutter-xs">
            <label className="queue-panel-toggle row items-center no-wrap">
              <span className="text-caption text-grey-5 q-mr-xs">{enabled ? 'On' : 'Off'}</span>
              <input
                type="checkbox"
                checked={enabled}
                disabled={busy}
                onChange={(e) => onSettingsChange({ enabled: e.target.checked })}
              />
            </label>
            {onClose ? (
              <button
                type="button"
                className="q-btn q-btn-item non-selectable no-outline q-btn--flat q-btn--round q-btn--dense text-grey-5"
                onClick={onClose}
                aria-label="Close queue"
                style={{ minHeight: 22, minWidth: 22, padding: 0 }}
              >
                <i className="q-icon mdi mdi-close" style={{ fontSize: 14 }} aria-hidden />
              </button>
            ) : null}
          </div>
        </div>

        {!enabled ? (
          <div className="text-grey-5 text-caption queue-panel-hint">
            Commands run immediately. Turn on to line them up one at a time.
          </div>
        ) : (
          <>
            <div className="row items-center q-gutter-xs queue-panel-actions">
              <button
                type="button"
                className="q-btn q-btn-item non-selectable no-outline q-btn--outline q-btn--rectangle q-btn--dense"
                disabled={busy}
                onClick={() => onTogglePaused(!paused)}
              >
                {paused ? 'Resume' : 'Pause'}
              </button>
              <button
                type="button"
                className="q-btn q-btn-item non-selectable no-outline q-btn--outline q-btn--rectangle q-btn--dense"
                disabled={busy || !active}
                onClick={onSkip}
              >
                Skip
              </button>
              <button
                type="button"
                className="q-btn q-btn-item non-selectable no-outline q-btn--outline q-btn--rectangle q-btn--dense"
                disabled={busy || waiting.length === 0}
                onClick={onClear}
              >
                Clear
              </button>
              {paused ? <span className="text-warning text-caption">Paused</span> : null}
            </div>

            <label className="queue-panel-progress">
              <span className="text-caption text-grey-5">Advance after</span>
              <span className="row items-center no-wrap q-gutter-xs">
                <input
                  type="number"
                  min={0}
                  max={60}
                  step={0.5}
                  disabled={busy}
                  value={progressSecDraft}
                  aria-label="Minimum seconds before the next queue item"
                  onChange={(e) =>
                    setProgressSecDraft(e.target.value === '' ? 0 : Number(e.target.value))
                  }
                  onBlur={commitProgress}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                />
                <span className="text-caption text-grey-5">s</span>
              </span>
            </label>

            <label className="queue-panel-progress">
              <span className="text-caption text-grey-5">Per person ahead</span>
              <span className="row items-center no-wrap q-gutter-xs">
                <input
                  type="number"
                  min={1}
                  max={1000000}
                  step={1}
                  disabled={busy}
                  value={maxPerSenderDraft}
                  aria-label="Max waiting commands per person"
                  onChange={(e) =>
                    setMaxPerSenderDraft(e.target.value === '' ? 1 : Number(e.target.value))
                  }
                  onBlur={commitMaxPerSender}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                />
              </span>
            </label>

            <label className="queue-panel-toggle row items-center justify-between q-mt-xs">
              <span className="text-caption text-grey-5">Stars only</span>
              <input
                type="checkbox"
                checked={starOnly}
                disabled={busy}
                onChange={(e) => onSettingsChange({ starOnly: e.target.checked })}
              />
            </label>
            {starOnly ? (
              <div className="text-grey-6 queue-panel-progress-hint">
                Only starred people can control your shockers.
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="queue-panel queue-panel--people">
        <div className="row items-center justify-between queue-panel-header">
          <div className="text-secondary queue-panel-title">IN QUEUE</div>
          <div className="text-caption text-grey-5">
            {people.length === 0
              ? 'Empty'
              : `${people.length}${starredCount ? ` · ${starredCount}★` : ''}`}
          </div>
        </div>

        {!enabled ? (
          <div className="text-grey-5 text-caption queue-panel-hint">
            Turn the queue on to see who is waiting here.
          </div>
        ) : people.length === 0 ? (
          <div className="text-grey-6 text-caption queue-panel-hint">Nobody waiting right now.</div>
        ) : (
          <div className="queue-people-list">
            {people.map((person) => (
              <div
                key={person.key}
                className={`queue-person${person.status === 'now' ? ' is-now' : ''}${
                  person.starred ? ' is-starred' : ''
                }`}
              >
                <img src={person.avatarUrl} alt="" className="queue-person__avatar" />
                <div className="queue-person__body">
                  <div className="queue-person__top">
                    <span className="queue-person__name ellipsis">{person.name}</span>
                    {person.starred ? (
                      <span className="queue-person__star-badge" title="Starred — priority lane">
                        <i className="q-icon mdi mdi-star" aria-hidden />
                        Starred
                      </span>
                    ) : null}
                  </div>
                  <div className="queue-person__meta text-caption text-grey-4">
                    {person.status === 'now' ? (
                      <span className="queue-person__now">Now</span>
                    ) : (
                      <span>#{person.position}</span>
                    )}
                    <span>· {person.detail}</span>
                  </div>
                </div>
                <div className="queue-person__actions">
                  {onToggleStar ? (
                    <button
                      type="button"
                      className={`queue-person__star-btn${person.starred ? ' active' : ''}`}
                      disabled={busy}
                      title={
                        person.starred
                          ? 'Remove star (lose priority)'
                          : 'Star for priority / stars-only access'
                      }
                      aria-label={person.starred ? 'Unstar' : 'Star'}
                      aria-pressed={person.starred}
                      onClick={() => onToggleStar(person.discordUserId, !person.starred)}
                    >
                      <i
                        className={`q-icon mdi ${person.starred ? 'mdi-star' : 'mdi-star-outline'}`}
                        style={{ fontSize: 16 }}
                        aria-hidden
                      />
                    </button>
                  ) : null}
                  {person.status === 'waiting'
                    ? person.itemIds.map((itemId) => (
                        <button
                          key={itemId}
                          type="button"
                          className="q-btn q-btn-item non-selectable no-outline q-btn--flat q-btn--round q-btn--dense"
                          aria-label="Remove from queue"
                          disabled={busy}
                          onClick={() => onRemove(itemId)}
                          style={{ minHeight: 22, minWidth: 22, padding: 0 }}
                        >
                          <i className="q-icon mdi mdi-close" style={{ fontSize: 14 }} aria-hidden />
                        </button>
                      ))
                    : null}
                </div>
              </div>
            ))}
          </div>
        )}

        {enabled && starOnly ? (
          <div className="queue-panel-progress-hint text-grey-6 q-mt-xs">
            Stars only is on — unstarred people cannot send commands.
          </div>
        ) : null}
      </div>
    </div>
  );
}
