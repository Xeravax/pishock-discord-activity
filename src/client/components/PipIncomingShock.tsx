import { useEffect, useState } from 'react';

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

type Props = {
  hit: IncomingShockHit | null;
  queueNext?: PipQueueNext | null;
};

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
export function PipIncomingShock({ hit, queueNext = null }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!queueNext) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [queueNext?.estimatedStartAt, queueNext?.startsInMs, queueNext?.displayName]);

  if (!hit && !queueNext) {
    return (
      <div className="pip-incoming" role="status" aria-live="polite">
        <div className="pip-incoming__empty">No recent shocks yet</div>
      </div>
    );
  }

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

  return (
    <div
      className={`pip-incoming${hit && !hit.success ? ' pip-incoming--failed' : ''}${
        activity ? ' pip-incoming--activity' : ''
      }${queueNext ? ' pip-incoming--with-queue' : ''}`}
      role="status"
      aria-live="polite"
    >
      {hit ? (
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
          </div>
        </div>
      ) : null}
    </div>
  );
}
