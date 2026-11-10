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

type Props = {
  enabled: boolean;
  paused: boolean;
  active: QueuePanelItem | null;
  waiting: QueuePanelItem[];
  busy?: boolean;
  onToggleEnabled: (enabled: boolean) => void;
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
  enabled,
  paused,
  active,
  waiting,
  busy = false,
  onToggleEnabled,
  onTogglePaused,
  onSkip,
  onClear,
  onRemove,
  displayNameFor,
}: Props) {
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
            onChange={(e) => onToggleEnabled(e.target.checked)}
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
