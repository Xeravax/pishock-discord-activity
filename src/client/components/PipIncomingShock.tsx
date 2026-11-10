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

type Props = {
  hit: IncomingShockHit | null;
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

/** PIP-only surface: avatar + last action intensity/duration. No chrome. */
export function PipIncomingShock({ hit }: Props) {
  if (!hit) {
    return (
      <div className="pip-incoming" role="status" aria-live="polite">
        <div className="pip-incoming__empty">No recent shocks yet</div>
      </div>
    );
  }

  const activity = hit.kind === 'activity';
  const targetName = hit.targetDisplayName?.trim() || null;
  const showTarget = activity && targetName && hit.targetDiscordUserId !== hit.executorDiscordUserId;

  return (
    <div
      className={`pip-incoming ${hit.success ? '' : 'pip-incoming--failed'}${
        activity ? ' pip-incoming--activity' : ''
      }`}
      role="status"
      aria-live="polite"
    >
      <img className="pip-incoming__avatar" src={hit.avatarUrl} alt="" />
      <div className="pip-incoming__copy">
        {activity ? (
          <div className="pip-incoming__eyebrow">Latest from log</div>
        ) : null}
        <div className="pip-incoming__name ellipsis" title={hit.displayName}>
          {hit.displayName}
        </div>
        <div className="pip-incoming__action">{formatAction(hit.action)}</div>
        {showTarget ? (
          <div className="pip-incoming__target" title={targetName}>
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
  );
}
