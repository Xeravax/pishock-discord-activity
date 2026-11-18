import { useEffect, useMemo, useRef, useState } from 'react';
import { participantAvatarUrl } from '../participants';

/** FAB that opens the wearer's command queue (matches logs button style). */
export function QueueFab({
  count,
  enabled,
  paused,
  halted,
  active,
  onClick,
}: {
  count: number;
  enabled: boolean;
  paused: boolean;
  halted?: boolean;
  active: boolean;
  onClick: () => void;
}) {
  const badge = count > 99 ? '99+' : count > 0 ? String(count) : active ? '•' : null;
  const title = enabled
    ? halted
      ? 'Command queue (closed)'
      : paused
        ? 'Command queue (paused)'
        : active || count > 0
          ? `Command queue (${count} waiting)`
          : 'Command queue'
    : 'Command queue (off)';
  return (
    <button
      type="button"
      className={`official-logs-fab queue-fab${enabled ? ' is-enabled' : ''}${paused ? ' is-paused' : ''}${
        halted ? ' is-halted' : ''
      }`}
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
  halted: boolean;
  active: QueuePanelItem | null;
  waiting: QueuePanelItem[];
  /** Ms until the next waiting item may start */
  nextStartsInMs?: number | null;
  nextEstimatedStartAt?: number | null;
  busy?: boolean;
  onClose?: () => void;
  onSettingsChange: (patch: Partial<QueuePanelSettings>) => void;
  onTogglePaused: (paused: boolean) => void;
  onToggleHalted: (halted: boolean) => void;
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

function formatNextEta(waitMs: number | null | undefined): string | null {
  if (waitMs == null || !Number.isFinite(waitMs)) return null;
  if (waitMs <= 0) return 'now';
  const sec = Math.max(1, Math.round(waitMs / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem ? `${min}m ${rem}s` : `${min}m`;
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

/** Accessible on/off switch (checkbox underneath, so labels and keyboard work). */
function Switch({
  checked,
  disabled,
  label,
  hint,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  hint?: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className={`queue-row queue-row--switch${disabled ? ' is-disabled' : ''}`}>
      <span className="queue-row__copy">
        <span className="queue-row__label">{label}</span>
        {hint ? <span className="queue-row__hint">{hint}</span> : null}
      </span>
      <span className="ps-switch">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="ps-switch__track" aria-hidden>
          <span className="ps-switch__thumb" />
        </span>
      </span>
    </label>
  );
}

/**
 * −/+ stepper that updates instantly and saves once clicking settles, so a burst of
 * taps is one request.
 */
function Stepper({
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  disabled,
  onCommit,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (n: number) => string;
  disabled?: boolean;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  const pending = useRef<number | null>(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  useEffect(() => {
    if (pending.current == null) setDraft(value);
  }, [value]);

  useEffect(
    () => () => {
      if (pending.current != null) window.clearTimeout(pending.current);
    },
    [],
  );

  const bump = (dir: 1 | -1) => {
    const next = Math.max(min, Math.min(max, Math.round((draft + dir * step) * 1000) / 1000));
    if (next === draft) return;
    setDraft(next);
    if (pending.current != null) window.clearTimeout(pending.current);
    pending.current = window.setTimeout(() => {
      pending.current = null;
      if (next !== value) commitRef.current(next);
    }, 450);
  };

  return (
    <div className={`queue-row queue-row--stepper${disabled ? ' is-disabled' : ''}`}>
      <span className="queue-row__copy">
        <span className="queue-row__label">{label}</span>
        {hint ? <span className="queue-row__hint">{hint}</span> : null}
      </span>
      <span className="queue-stepper" role="group" aria-label={label}>
        <button
          type="button"
          className="queue-stepper__btn"
          disabled={disabled || draft <= min}
          aria-label={`Decrease ${label.toLowerCase()}`}
          onClick={() => bump(-1)}
        >
          <i className="q-icon mdi mdi-minus" aria-hidden />
        </button>
        <span className="queue-stepper__value" aria-live="polite">
          {format(draft)}
        </span>
        <button
          type="button"
          className="queue-stepper__btn"
          disabled={disabled || draft >= max}
          aria-label={`Increase ${label.toLowerCase()}`}
          onClick={() => bump(1)}
        >
          <i className="q-icon mdi mdi-plus" aria-hidden />
        </button>
      </span>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  title,
  tone,
  disabled,
  onClick,
}: {
  icon: string;
  label: string;
  title: string;
  tone?: 'accent' | 'warn' | 'danger';
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`queue-action${tone ? ` queue-action--${tone}` : ''}`}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      <i className={`q-icon mdi ${icon}`} aria-hidden />
      <span>{label}</span>
    </button>
  );
}

export function QueuePanel({
  settings,
  paused,
  halted,
  active,
  waiting,
  nextStartsInMs = null,
  nextEstimatedStartAt = null,
  busy = false,
  onClose,
  onSettingsChange,
  onTogglePaused,
  onToggleHalted,
  onSkip,
  onClear,
  onRemove,
  onToggleStar,
  displayNameFor,
  avatarUrlFor = defaultAvatarUrl,
}: Props) {
  const { enabled, progressMs, maxPerSender, starOnly } = settings;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled || waiting.length === 0) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [enabled, waiting.length, nextEstimatedStartAt, nextStartsInMs]);

  const nextEtaLabel = useMemo(() => {
    if (!enabled || waiting.length === 0) return null;
    const waitMs =
      nextEstimatedStartAt != null && Number.isFinite(nextEstimatedStartAt)
        ? Math.max(0, nextEstimatedStartAt - now)
        : nextStartsInMs;
    const eta = formatNextEta(waitMs);
    if (paused) {
      return eta && eta !== 'now' ? `Next in ~${eta} after resume` : 'Paused — next is waiting';
    }
    if (!eta) return null;
    if (eta === 'now') return 'Next starting soon';
    return `Next in ~${eta}`;
  }, [enabled, waiting.length, nextEstimatedStartAt, nextStartsInMs, now, paused]);

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

  const status: { label: string; tone: 'off' | 'live' | 'warn' } = !enabled
    ? { label: 'Off', tone: 'off' }
    : paused
      ? { label: 'Paused', tone: 'warn' }
      : halted
        ? { label: 'Closed', tone: 'warn' }
        : { label: 'Running', tone: 'live' };

  return (
    <div className="queue-dash">
      <section className="queue-panel queue-panel--controls" aria-label="Command queue controls">
        <header className="queue-head">
          <span className="queue-head__icon" aria-hidden>
            <i className="q-icon mdi mdi-playlist-play" />
          </span>
          <span className="queue-head__copy">
            <span className="queue-head__title">Command queue</span>
            <span className={`queue-status queue-status--${status.tone}`}>
              <span className="queue-status__dot" aria-hidden />
              {status.label}
            </span>
          </span>
          <span className="ps-switch" title={enabled ? 'Turn the queue off' : 'Turn the queue on'}>
            <input
              type="checkbox"
              role="switch"
              aria-label="Command queue"
              checked={enabled}
              disabled={busy}
              onChange={(e) => onSettingsChange({ enabled: e.target.checked })}
            />
            <span className="ps-switch__track" aria-hidden>
              <span className="ps-switch__thumb" />
            </span>
          </span>
          {onClose ? (
            <button type="button" className="queue-head__close" onClick={onClose} aria-label="Close queue">
              <i className="q-icon mdi mdi-close" aria-hidden />
            </button>
          ) : null}
        </header>

        {!enabled ? (
          <p className="queue-empty">
            Commands run as soon as they arrive. Turn the queue on to line them up one at a time.
          </p>
        ) : (
          <>
            <div className="queue-actions">
              <ActionButton
                icon={paused ? 'mdi-play' : 'mdi-pause'}
                label={paused ? 'Resume' : 'Pause'}
                title={
                  paused
                    ? 'Start running queued commands again'
                    : 'Stop running the next item — people can still join the queue'
                }
                tone={paused ? 'warn' : undefined}
                disabled={busy}
                onClick={() => onTogglePaused(!paused)}
              />
              <ActionButton
                icon="mdi-skip-next"
                label="Skip"
                title="Skip the command that's running now"
                disabled={busy || !active}
                onClick={onSkip}
              />
              <ActionButton
                icon="mdi-playlist-remove"
                label="Clear"
                title="Remove everyone who's waiting"
                tone="danger"
                disabled={busy || waiting.length === 0}
                onClick={onClear}
              />
            </div>

            <div className="queue-rows">
              <Switch
                label="Accept new commands"
                hint={halted ? 'Closed — waiting commands still run' : undefined}
                checked={!halted}
                disabled={busy}
                onChange={(open) => onToggleHalted(!open)}
              />
              <Switch
                label="Stars only"
                hint={starOnly ? 'Only starred people can send' : undefined}
                checked={starOnly}
                disabled={busy}
                onChange={(next) => onSettingsChange({ starOnly: next })}
              />
              <Stepper
                label="Advance after"
                hint="Gap between commands"
                value={progressMs}
                min={0}
                max={60_000}
                step={500}
                format={(ms) => (ms <= 0 ? 'Auto' : formatDuration(ms))}
                disabled={busy}
                onCommit={(next) => onSettingsChange({ progressMs: next })}
              />
              <Stepper
                label="Per person"
                hint="Max waiting each"
                value={maxPerSender}
                min={1}
                max={100}
                step={1}
                format={(n) => String(n)}
                disabled={busy}
                onCommit={(next) => onSettingsChange({ maxPerSender: next })}
              />
            </div>
          </>
        )}
      </section>

      {enabled ? (
        <section className="queue-panel queue-panel--people" aria-label="People in the queue">
          <header className="queue-people-head">
            <span className="queue-people-head__title">In queue</span>
            <span className="queue-people-head__count">
              {people.length === 0
                ? 'Empty'
                : `${people.length}${starredCount ? ` · ${starredCount}★` : ''}`}
            </span>
          </header>
          {nextEtaLabel ? <div className="queue-eta">{nextEtaLabel}</div> : null}

          {people.length === 0 ? (
            <p className="queue-empty">Nobody waiting right now.</p>
          ) : (
            <ol className="queue-people-list">
              {people.map((person) => (
                <li
                  key={person.key}
                  className={`queue-person${person.status === 'now' ? ' is-now' : ''}${
                    person.starred ? ' is-starred' : ''
                  }`}
                >
                  <span className="queue-person__pos" aria-hidden>
                    {person.status === 'now' ? (
                      <i className="q-icon mdi mdi-play" />
                    ) : (
                      person.position
                    )}
                  </span>
                  <img src={person.avatarUrl} alt="" className="queue-person__avatar" />
                  <div className="queue-person__body">
                    <span className="queue-person__name ellipsis">{person.name}</span>
                    <span className="queue-person__meta">
                      {person.status === 'now' ? <span className="queue-person__now">Now · </span> : null}
                      {person.detail}
                    </span>
                  </div>
                  <div className="queue-person__actions">
                    {onToggleStar ? (
                      <button
                        type="button"
                        className={`queue-icon-btn queue-icon-btn--star${person.starred ? ' is-active' : ''}`}
                        disabled={busy}
                        title={
                          person.starred
                            ? 'Remove star (lose priority)'
                            : 'Star for priority / stars-only access'
                        }
                        aria-label={person.starred ? `Unstar ${person.name}` : `Star ${person.name}`}
                        aria-pressed={person.starred}
                        onClick={() => onToggleStar(person.discordUserId, !person.starred)}
                      >
                        <i
                          className={`q-icon mdi ${person.starred ? 'mdi-star' : 'mdi-star-outline'}`}
                          aria-hidden
                        />
                      </button>
                    ) : null}
                    {person.status === 'waiting'
                      ? person.itemIds.map((itemId) => (
                          <button
                            key={itemId}
                            type="button"
                            className="queue-icon-btn queue-icon-btn--remove"
                            aria-label={`Remove ${person.name} from queue`}
                            title="Remove from queue"
                            disabled={busy}
                            onClick={() => onRemove(itemId)}
                          >
                            <i className="q-icon mdi mdi-close" aria-hidden />
                          </button>
                        ))
                      : null}
                  </div>
                </li>
              ))}
            </ol>
          )}

          {starOnly ? (
            <p className="queue-foot">Stars only is on — unstarred people can’t send commands.</p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
