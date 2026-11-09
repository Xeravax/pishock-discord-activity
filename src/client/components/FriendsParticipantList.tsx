import type { DiscordParticipant, ParticipantStatus } from '../participants';

const MULTI_COLORS = [
  '#79c6db',
  '#ce93d8',
  '#81c784',
  '#ffb74d',
  '#f48fb1',
  '#90caf9',
  '#aed581',
  '#ff8a65',
] as const;

function colorForUserId(id: string): string {
  const key = `u:${id}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return MULTI_COLORS[hash % MULTI_COLORS.length]!;
}

type Props = {
  participants: DiscordParticipant[];
  statuses: Record<string, ParticipantStatus>;
  currentUserId: string;
  /** Single-select (legacy) — ignored when selectedTargetIds is provided */
  selectedTargetId?: string | null;
  /** Multi-select ids when Multishock / multi friend targeting is on */
  selectedTargetIds?: string[];
  multiSelect?: boolean;
  /** Current user has a PiShock session linked */
  pishockLinked?: boolean;
  onSelect: (discordUserId: string | null) => void;
  onRefresh?: () => void;
  onLinkAccount?: () => void;
};

/** Discord Shockers roster styled like the official PISHOCKS FAB list */
export function FriendsParticipantList({
  participants,
  statuses,
  currentUserId,
  selectedTargetId = null,
  selectedTargetIds,
  multiSelect = false,
  pishockLinked = true,
  onSelect,
  onRefresh,
  onLinkAccount,
}: Props) {
  const others = participants.filter((p) => p.id !== currentUserId);
  const selectedIds = selectedTargetIds ?? (selectedTargetId ? [selectedTargetId] : []);
  const selectedSet = new Set(selectedIds);

  return (
    <div className="column flex q-mt-xs official-friends-list">
      <div className="row items-center justify-between official-friends-header">
        <div className="text-secondary official-friends-title">
          DISCORD SHOCKERS{multiSelect ? ' · MULTI' : ''}
        </div>
        {onRefresh ? (
          <button
            type="button"
            className="q-btn q-btn-item non-selectable no-outline q-btn--flat q-btn--round text-secondary q-btn--dense q-btn--actionable"
            onClick={onRefresh}
            aria-label="Refresh participants"
            style={{ minHeight: 22, minWidth: 22, padding: 0 }}
          >
            <span className="q-btn__wrapper col row q-anchor--skip">
              <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                <i className="q-icon mdi mdi-refresh" style={{ fontSize: 14 }} aria-hidden />
              </span>
            </span>
          </button>
        ) : null}
      </div>

      {!pishockLinked ? (
        <div className="official-friends-unlinked q-mb-xs">
          <div className="text-secondary text-caption" style={{ fontWeight: 600 }}>
            Not linked to PiShock
          </div>
          <div className="text-grey-5" style={{ fontSize: 10, lineHeight: 1.25 }}>
            You can still control people below who shared devices into this activity. Link PiShock
            only if you want to share your own shockers.
          </div>
          {onLinkAccount ? (
            <button
              type="button"
              className="q-btn q-btn-item non-selectable no-outline q-mt-xs q-btn--standard q-btn--rectangle bg-secondary text-dark q-btn--dense q-btn--actionable"
              onClick={onLinkAccount}
            >
              <span className="q-btn__wrapper col row q-anchor--skip">
                <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                  <span className="block">Link PiShock</span>
                </span>
              </span>
            </button>
          ) : null}
        </div>
      ) : null}

      {others.length === 0 ? (
        <div className="text-grey-5 official-friends-empty">
          {pishockLinked
            ? 'No other participants'
            : 'No other participants yet — stay here until someone shares devices.'}
        </div>
      ) : (
        others.map((p) => {
          const status = statuses[p.id];
          const banned = Boolean(status?.bannedYou);
          const eStop = Boolean(
            status?.emergencyStop || status?.shockers?.some((s) => s.emergencyStop),
          );
          const selectable =
            Boolean(status) &&
            (banned || eStop || status?.available || (status?.shockers?.length ?? 0) > 0);
          const active = selectedSet.has(p.id);
          const label = statusLabel(status);
          const detail = statusDetail(status);
          const primary = !banned ? status?.shockers?.[0] : undefined;
          const limits = primary ? formatLimits(primary) : null;
          const flags = primary
            ? [
                primary.canShock ? 'S' : null,
                primary.canVibrate ? 'V' : null,
                primary.canBeep ? 'B' : null,
              ]
                .filter(Boolean)
                .join('')
            : null;
          const multiColor = multiSelect && active ? colorForUserId(p.id) : undefined;

          return (
            <button
              key={p.id}
              type="button"
              disabled={!selectable}
              className={`official-friend-btn ${active && !multiSelect ? 'active' : ''} ${
                selectable ? '' : 'disabled'
              } ${banned ? 'blocked' : ''} ${eStop && !banned ? 'estop' : ''}`}
              style={
                multiSelect && multiColor
                  ? {
                      background: multiColor,
                      borderColor: multiColor,
                      color: '#121212',
                    }
                  : undefined
              }
              onClick={() => {
                if (!selectable) return;
                if (multiSelect) {
                  onSelect(p.id);
                  return;
                }
                onSelect(active ? null : p.id);
              }}
            >
              <img src={p.avatarUrl} alt="" className="official-friend-avatar" />
              <span className="official-friend-meta">
                <span className="official-friend-name ellipsis">{p.displayName}</span>
                <span
                  className={`official-friend-status ${
                    banned || eStop || !status?.available ? 'bad' : 'ok'
                  }`}
                >
                  {label}
                </span>
                {detail ? (
                  <span className="official-friend-limits ellipsis">{detail}</span>
                ) : primary ? (
                  <span className="official-friend-limits ellipsis">
                    {primary.shockerName}
                    {limits ? ` · ${limits}` : ''}
                    {flags ? ` · ${flags}` : ''}
                    {primary.emergencyStop ? ' · E-STOP' : ''}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}

function statusLabel(status?: ParticipantStatus): string {
  if (!status) return 'Unknown';
  if (status.bannedYou) return 'Blocked';
  if (status.emergencyStop || status.shockers?.some((s) => s.emergencyStop)) return 'E-STOP';
  if (status.available) return 'Available';
  if (status.paused) return 'Paused';
  if (!status.linked) return 'Not linked to PiShock';
  if (!status.consent) return 'No consent';
  return 'Unavailable';
}

function statusDetail(status?: ParticipantStatus): string | null {
  if (!status) return null;
  if (status.bannedYou) {
    return 'You are blocked — cannot view or use their shockers';
  }
  if (status.emergencyStop || status.shockers?.every((s) => s.emergencyStop)) {
    return 'Emergency stop armed — controls disabled';
  }
  if (!status.linked) {
    return 'They have not linked PiShock in this activity';
  }
  return null;
}

function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s`;
}

function formatLimits(primary: ParticipantStatus['shockers'][number]): string {
  const activity = `${primary.maxIntensity}% · ${formatMs(primary.maxDurationMs)}`;
  const deviceHigher =
    primary.deviceMaxIntensity > primary.maxIntensity ||
    primary.deviceMaxDurationMs > primary.maxDurationMs;
  if (!deviceHigher) return activity;
  return `${activity} (PiShock ${primary.deviceMaxIntensity}% · ${formatMs(primary.deviceMaxDurationMs)})`;
}
