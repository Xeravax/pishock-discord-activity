import { useCallback, useEffect, useRef, useState } from 'react';

export type IncomingShockHit = {
  executorDiscordUserId: string;
  displayName: string;
  avatarUrl: string;
  action: string;
  intensity: number | null;
  durationMs: number | null;
  at: number;
  success: boolean;
  /** Who received the command (activity-feed / unlinked PIP) */
  targetDiscordUserId?: string | null;
  targetDisplayName?: string | null;
  targetAvatarUrl?: string | null;
  /**
   * personal = last hit on you (linked)
   * activity = latest shock from the public log (unlinked spectator)
   */
  kind?: 'personal' | 'activity';
};

export type PipQueueNext = {
  executorDiscordUserId: string;
  displayName: string;
  avatarUrl: string;
  operation: string;
  intensity: number;
  durationMs: number;
  priority?: boolean;
  paused?: boolean;
  /** Wall-clock ms when this item is expected to start */
  estimatedStartAt: number | null;
  /** Snapshot wait at last update (fallback when no wall clock) */
  startsInMs: number | null;
};

/**
 * Owner quick actions in interactive PIP. Omitted for spectators (no linked devices),
 * which keeps PIP a read-only status card for them.
 */
export type PipControls = {
  selfDiscordUserId: string | null;
  /** Owned shockers the STOP button covers (0 = no devices loaded yet). */
  stopTargetCount: number;
  /** How many of those are latched by emergency stop right now. */
  stoppedCount: number;
  onEmergencyStop: (engaged: boolean) => void;
  queueEnabled: boolean;
  queuePaused: boolean;
  queueHasActive: boolean;
  onToggleQueuePaused: (paused: boolean) => void;
  onSkipActive: () => void;
  isStarred: (discordUserId: string) => boolean;
  isBlocked: (discordUserId: string) => boolean;
  onToggleStar: (discordUserId: string, starred: boolean) => void;
  onToggleBlock: (discordUserId: string, blocked: boolean) => void;
  busy: boolean;
  /** Short-lived result line (errors / confirmations), since PIP has no toast. */
  message: { tone: 'error' | 'ok'; text: string } | null;
};

type Props = {
  hit: IncomingShockHit | null;
  queueNext?: PipQueueNext | null;
  controls?: PipControls | null;
};

const CONFIRM_WINDOW_MS = 3000;

/** Two-tap guard for actions that should not fire from a stray click in a tiny window. */
function useArmed(): [string | null, (key: string) => boolean] {
  const [armed, setArmed] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    },
    [],
  );
  const tryFire = useCallback(
    (key: string) => {
      if (timer.current != null) window.clearTimeout(timer.current);
      if (armed === key) {
        timer.current = null;
        setArmed(null);
        return true;
      }
      setArmed(key);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setArmed(null);
      }, CONFIRM_WINDOW_MS);
      return false;
    },
    [armed],
  );
  return [armed, tryFire];
}

function PersonActions({
  discordUserId,
  name,
  controls,
  armed,
  tryFire,
  compact = false,
}: {
  discordUserId: string;
  name: string;
  controls: PipControls;
  armed: string | null;
  tryFire: (key: string) => boolean;
  compact?: boolean;
}) {
  if (!discordUserId || discordUserId === controls.selfDiscordUserId) return null;
  const starred = controls.isStarred(discordUserId);
  const blocked = controls.isBlocked(discordUserId);
  const blockKey = `block:${discordUserId}`;
  const confirmBlock = armed === blockKey;
  return (
    <div className={`pip-person-actions${compact ? ' pip-person-actions--compact' : ''}`}>
      <button
        type="button"
        className={`pip-chip${starred ? ' pip-chip--starred' : ''}`}
        aria-pressed={starred}
        disabled={blocked}
        title={starred ? `Remove ${name} from favorites` : `Favorite ${name} (queue priority)`}
        onClick={() => controls.onToggleStar(discordUserId, !starred)}
      >
        <i className={`q-icon mdi ${starred ? 'mdi-star' : 'mdi-star-outline'}`} aria-hidden />
        {compact ? null : <span>{starred ? 'Favorited' : 'Favorite'}</span>}
      </button>
      <button
        type="button"
        className={`pip-chip pip-chip--block${blocked ? ' pip-chip--blocked' : ''}${
          confirmBlock ? ' pip-chip--confirm' : ''
        }`}
        aria-pressed={blocked}
        title={blocked ? `Unblock ${name}` : `Block ${name} from your shockers`}
        onClick={() => {
          if (blocked) {
            controls.onToggleBlock(discordUserId, false);
            return;
          }
          if (tryFire(blockKey)) controls.onToggleBlock(discordUserId, true);
        }}
      >
        <i className="q-icon mdi mdi-account-cancel" aria-hidden />
        {compact && !confirmBlock ? null : (
          <span>{blocked ? 'Blocked' : confirmBlock ? 'Confirm?' : 'Block'}</span>
        )}
      </button>
    </div>
  );
}

function ControlBar({
  controls,
  armed,
  tryFire,
}: {
  controls: PipControls;
  armed: string | null;
  tryFire: (key: string) => boolean;
}) {
  const allStopped =
    controls.stopTargetCount > 0 && controls.stoppedCount >= controls.stopTargetCount;
  const confirmRelease = armed === 'release';
  return (
    <div className="pip-controls" role="toolbar" aria-label="Quick controls">
      <button
        type="button"
        className={`pip-stop${allStopped ? ' pip-stop--engaged' : ''}${
          confirmRelease ? ' pip-stop--confirm' : ''
        }`}
        disabled={controls.busy || controls.stopTargetCount === 0}
        title={
          controls.stopTargetCount === 0
            ? 'No devices loaded'
            : allStopped
              ? 'Release emergency stop on all your shockers'
              : 'Emergency stop: cut and lock all your shockers'
        }
        onClick={() => {
          if (!allStopped) {
            // Engaging is always one tap — never put a confirm in front of STOP.
            controls.onEmergencyStop(true);
            return;
          }
          if (tryFire('release')) controls.onEmergencyStop(false);
        }}
      >
        <i className="q-icon mdi mdi-alert-octagon" aria-hidden />
        <span>
          {allStopped ? (confirmRelease ? 'Tap to release' : 'Stopped · Release') : 'STOP ALL'}
        </span>
      </button>
      {controls.queueEnabled ? (
        <>
          <button
            type="button"
            className={`pip-icon-btn${controls.queuePaused ? ' pip-icon-btn--on' : ''}`}
            aria-pressed={controls.queuePaused}
            disabled={controls.busy}
            title={controls.queuePaused ? 'Resume queue' : 'Pause queue'}
            onClick={() => controls.onToggleQueuePaused(!controls.queuePaused)}
          >
            <i
              className={`q-icon mdi ${controls.queuePaused ? 'mdi-play' : 'mdi-pause'}`}
              aria-hidden
            />
          </button>
          <button
            type="button"
            className="pip-icon-btn"
            disabled={controls.busy || !controls.queueHasActive}
            title="Skip the running command"
            onClick={() => controls.onSkipActive()}
          >
            <i className="q-icon mdi mdi-skip-next" aria-hidden />
          </button>
        </>
      ) : null}
    </div>
  );
}

function formatAction(action: string): string {
  const raw = action.toLowerCase().replace(/^participant_/, '');
  if (raw === 'shock' || raw === 'hold') return 'SHOCK';
  if (raw === 'vibrate' || raw === 'warning') return 'VIBRATE';
  if (raw === 'beep') return 'BEEP';
  return raw.toUpperCase() || 'HIT';
}

function formatDuration(ms: number): string {
  const s = ms / 1000;
  return Number.isInteger(s) ? `${s}s` : `${s.toFixed(1)}s`;
}

function formatEta(waitMs: number | null | undefined): string | null {
  if (waitMs == null || !Number.isFinite(waitMs)) return null;
  if (waitMs <= 0) return 'now';
  const sec = Math.max(1, Math.round(waitMs / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem ? `${min}m ${rem}s` : `${min}m`;
}

function remainingMs(next: PipQueueNext, now: number): number | null {
  if (next.estimatedStartAt != null && Number.isFinite(next.estimatedStartAt)) {
    return Math.max(0, next.estimatedStartAt - now);
  }
  if (next.startsInMs != null && Number.isFinite(next.startsInMs)) {
    return Math.max(0, next.startsInMs);
  }
  return null;
}

/** PIP-only surface: last hit + next queue item / ETA. No chrome. */
export function PipIncomingShock({ hit, queueNext = null, controls = null }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [armed, tryFire] = useArmed();

  useEffect(() => {
    if (!queueNext) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [queueNext?.estimatedStartAt, queueNext?.startsInMs, queueNext?.displayName]);


  const activity = hit?.kind === 'activity';
  const targetName = hit?.targetDisplayName?.trim() || null;
  const showTarget =
    Boolean(hit) &&
    activity &&
    targetName &&
    hit!.targetDiscordUserId !== hit!.executorDiscordUserId;

  const waitMs = queueNext ? remainingMs(queueNext, now) : null;
  const eta = formatEta(waitMs);
  let etaLabel: string | null = null;
  if (queueNext) {
    if (queueNext.paused) {
      etaLabel =
        eta && eta !== 'now' ? `Paused · ~${eta} after resume` : 'Paused · waiting to resume';
    } else if (!eta) {
      etaLabel = 'Estimating…';
    } else if (eta === 'now') {
      etaLabel = 'Starting soon';
    } else {
      etaLabel = `Next in ~${eta}`;
    }
  }

  const stopped = controls ? controls.stoppedCount : 0;
  const statusLine = controls
    ? stopped > 0
      ? stopped >= controls.stopTargetCount
        ? 'Emergency stop is ON'
        : `Emergency stop on ${stopped} of ${controls.stopTargetCount}`
      : controls.queueEnabled && controls.queuePaused
        ? 'Queue paused'
        : null
    : null;

  return (
    <div
      className={`pip-incoming${hit && !hit.success ? ' pip-incoming--failed' : ''}${
        activity ? ' pip-incoming--activity' : ''
      }${queueNext ? ' pip-incoming--with-queue' : ''}${controls ? ' pip-incoming--interactive' : ''}`}
    >
      {statusLine ? (
        <div
          className={`pip-status${stopped > 0 ? ' pip-status--estop' : ''}`}
          role="status"
        >
          {statusLine}
        </div>
      ) : null}
      <div className="pip-incoming__body" role="status" aria-live="polite">
      {!hit && !queueNext ? (
        <div className="pip-incoming__hit pip-incoming__hit--empty">
          <div className="pip-incoming__empty">No recent shocks yet</div>
        </div>
      ) : hit ? (
        <div className="pip-incoming__hit">
          <img className="pip-incoming__avatar" src={hit.avatarUrl} alt="" />
          <div className="pip-incoming__copy">
            {activity ? <div className="pip-incoming__eyebrow">Latest from log</div> : null}
            <div className="pip-incoming__name ellipsis" title={hit.displayName}>
              {hit.displayName}
            </div>
            <div className="pip-incoming__action">{formatAction(hit.action)}</div>
            {showTarget ? (
              <div className="pip-incoming__target" title={targetName!}>
                <span className="pip-incoming__target-label">to</span>
                {hit.targetAvatarUrl ? (
                  <img className="pip-incoming__target-avatar" src={hit.targetAvatarUrl} alt="" />
                ) : null}
                <span className="pip-incoming__target-name ellipsis">{targetName}</span>
              </div>
            ) : null}
            <div className="pip-incoming__stats">
              {hit.intensity != null ? <span>{hit.intensity}%</span> : null}
              {hit.intensity != null && hit.durationMs != null ? (
                <span className="pip-incoming__dot" aria-hidden>
                  ·
                </span>
              ) : null}
              {hit.durationMs != null ? <span>{formatDuration(hit.durationMs)}</span> : null}
            </div>
            {controls && !activity ? (
              <PersonActions
                discordUserId={hit.executorDiscordUserId}
                name={hit.displayName}
                controls={controls}
                armed={armed}
                tryFire={tryFire}
              />
            ) : null}
          </div>
        </div>
      ) : (
        <div className="pip-incoming__hit pip-incoming__hit--empty">
          <div className="pip-incoming__empty">No recent shocks yet</div>
        </div>
      )}

      {queueNext ? (
        <div className="pip-incoming__queue">
          <div className="pip-incoming__queue-label">Up next</div>
          <div className="pip-incoming__queue-row">
            <img className="pip-incoming__queue-avatar" src={queueNext.avatarUrl} alt="" />
            <div className="pip-incoming__queue-copy">
              <div className="pip-incoming__queue-name ellipsis" title={queueNext.displayName}>
                {queueNext.displayName}
                {queueNext.priority ? (
                  <i className="q-icon mdi mdi-star pip-incoming__queue-star" aria-hidden />
                ) : null}
              </div>
              <div className="pip-incoming__queue-op">
                {formatAction(queueNext.operation)} · {queueNext.intensity}% ·{' '}
                {formatDuration(queueNext.durationMs)}
              </div>
              {etaLabel ? <div className="pip-incoming__queue-eta">{etaLabel}</div> : null}
            </div>
            {controls ? (
              <PersonActions
                discordUserId={queueNext.executorDiscordUserId}
                name={queueNext.displayName}
                controls={controls}
                armed={armed}
                tryFire={tryFire}
                compact
              />
            ) : null}
          </div>
        </div>
      ) : null}
      </div>

      {controls?.message ? (
        <div
          className={`pip-message pip-message--${controls.message.tone}`}
          role={controls.message.tone === 'error' ? 'alert' : 'status'}
        >
          {controls.message.text}
        </div>
      ) : null}
      {controls ? <ControlBar controls={controls} armed={armed} tryFire={tryFire} /> : null}
    </div>
  );
}
