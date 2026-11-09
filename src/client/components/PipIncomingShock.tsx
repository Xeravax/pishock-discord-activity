export type IncomingShockHit = {
  executorDiscordUserId: string;
  displayName: string;
  avatarUrl: string;
  action: string;
  intensity: number | null;
  durationMs: number | null;
  at: number;
  success: boolean;
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
    return <div className="pip-incoming" aria-hidden />;
  }

  return (
    <div
      className={`pip-incoming ${hit.success ? '' : 'pip-incoming--failed'}`}
      role="status"
      aria-live="polite"
    >
      <img className="pip-incoming__avatar" src={hit.avatarUrl} alt="" />
      <div className="pip-incoming__copy">
        <div className="pip-incoming__name ellipsis" title={hit.displayName}>
          {hit.displayName}
        </div>
        <div className="pip-incoming__action">{formatAction(hit.action)}</div>
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
