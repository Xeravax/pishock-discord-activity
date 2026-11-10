import { useEffect, useState } from 'react';

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
  maxSenderMs: number;
  starOnly: boolean;
};

type Props = {
  settings: QueuePanelSettings;
  paused: boolean;
  active: QueuePanelItem | null;
  waiting: QueuePanelItem[];
  busy?: boolean;
  onSettingsChange: (patch: Partial<QueuePanelSettings>) => void;
  onTogglePaused: (paused: boolean) => void;
  onSkip: () => void;
  onClear: () => void;
  onRemove: (itemId: string) => void;
  displayNameFor: (item: QueuePanelItem) => string;
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

export function QueuePanel({
  settings,
  paused,
  active,
  waiting,
  busy = false,
  onSettingsChange,
  onTogglePaused,
  onSkip,
  onClear,
  onRemove,
  displayNameFor,
}: Props) {
  const { enabled, progressMs, maxPerSender, maxSenderMs, starOnly } = settings;
  const [progressSecDraft, setProgressSecDraft] = useState(
    () => Math.round(progressMs / 100) / 10,
  );
  const [maxSenderSecDraft, setMaxSenderSecDraft] = useState(
    () => Math.round(maxSenderMs / 100) / 10,
  );
  const [maxPerSenderDraft, setMaxPerSenderDraft] = useState(maxPerSender);

  useEffect(() => {
    setProgressSecDraft(Math.round(progressMs / 100) / 10);
  }, [progressMs]);
  useEffect(() => {
    setMaxSenderSecDraft(Math.round(maxSenderMs / 100) / 10);
  }, [maxSenderMs]);
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

  const commitMaxSender = () => {
    const sec = Number(maxSenderSecDraft);
    const nextMs = Number.isFinite(sec)
      ? Math.round(Math.max(0, Math.min(300, sec)) * 1000)
      : maxSenderMs;
    setMaxSenderSecDraft(Math.round(nextMs / 100) / 10);
    if (nextMs !== maxSenderMs) onSettingsChange({ maxSenderMs: nextMs });
  };

  const commitMaxPerSender = () => {
    const n = Math.floor(Number(maxPerSenderDraft));
    const next = Number.isFinite(n) ? Math.max(1, Math.min(1_000_000, n)) : maxPerSender;
    setMaxPerSenderDraft(next);
    if (next !== maxPerSender) onSettingsChange({ maxPerSender: next });
  };

  return (
    <div className="queue-panel">
      <div className="row items-center justify-between queue-panel-header">
        <div className="text-secondary queue-panel-title">COMMAND QUEUE</div>
        <label className="queue-panel-toggle row items-center no-wrap">
          <span className="text-caption text-grey-5 q-mr-xs">{enabled ? 'On' : 'Off'}</span>
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy}
            onChange={(e) => onSettingsChange({ enabled: e.target.checked })}
          />
        </label>
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

          <label className="queue-panel-progress">
            <span className="text-caption text-grey-5">Max queue time / person</span>
            <span className="row items-center no-wrap q-gutter-xs">
              <input
                type="number"
                min={0}
                max={300}
                step={1}
                disabled={busy}
                value={maxSenderSecDraft}
                aria-label="Max total queued seconds per person"
                onChange={(e) =>
                  setMaxSenderSecDraft(e.target.value === '' ? 0 : Number(e.target.value))
                }
                onBlur={commitMaxSender}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
              />
              <span className="text-caption text-grey-5">s</span>
            </span>
            <span className="text-grey-6 queue-panel-progress-hint">
              {maxSenderMs <= 0 ? 'Unlimited' : `Cap ${formatDuration(maxSenderMs)} of waiting time`}
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

          <div className="queue-panel-section">
            <div className="text-caption text-grey-5">Now</div>
            {active ? (
              <div className={`queue-panel-item active ${active.priority ? 'priority' : ''}`}>
                <div className="queue-panel-item-main">
                  <span className="ellipsis">
                    {active.priority ? '★ ' : ''}
                    {displayNameFor(active)}
                  </span>
                  <span className="text-caption text-grey-4">
                    {formatOp(active)} · {active.intensity}% · {formatDuration(active.durationMs)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-grey-6 text-caption">Idle</div>
            )}
          </div>

          <div className="queue-panel-section">
            <div className="text-caption text-grey-5">
              Waiting{waiting.length ? ` (${waiting.length})` : ''}
            </div>
            {waiting.length === 0 ? (
              <div className="text-grey-6 text-caption">Empty</div>
            ) : (
              waiting.map((item, idx) => (
                <div
                  key={item.id}
                  className={`queue-panel-item ${item.priority ? 'priority' : ''}`}
                >
                  <div className="queue-panel-item-main">
                    <span className="ellipsis">
                      {idx + 1}. {item.priority ? '★ ' : ''}
                      {displayNameFor(item)}
                    </span>
                    <span className="text-caption text-grey-4">
                      {formatOp(item)} · {item.intensity}% · {formatDuration(item.durationMs)}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="q-btn q-btn-item non-selectable no-outline q-btn--flat q-btn--round q-btn--dense"
                    aria-label="Remove from queue"
                    disabled={busy}
                    onClick={() => onRemove(item.id)}
                    style={{ minHeight: 22, minWidth: 22, padding: 0 }}
                  >
                    <i className="q-icon mdi mdi-close" style={{ fontSize: 14 }} aria-hidden />
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
