import type { DiscordParticipant, ParticipantStatus } from '../participants';
import { colorForUser } from '../multiColors';
import { IndividualIntensityToggle, MultiShockToggle } from './MultiShockToggle';

type Props = {
  participants: DiscordParticipant[];
  statuses: Record<string, ParticipantStatus>;
  currentUserId: string;
  /** Single-select (legacy) — ignored when selectedTargetIds is provided */
  selectedTargetId?: string | null;
  /** Multi-select ids when Multishock / multi friend targeting is on */
  selectedTargetIds?: string[];
  multiSelect?: boolean;
  onToggleMultiSelect?: () => void;
  individualIntensity?: boolean;
  onToggleIndividualIntensity?: () => void;
  onSelect: (discordUserId: string | null) => void;
  onRefresh?: () => void;
  /** Star someone so their commands to you get queue priority */
  onTogglePriority?: (discordUserId: string, starred: boolean) => void;
};

/** Discord Shockers roster styled like the official PISHOCKS FAB list */
export function FriendsParticipantList({
  participants,
  statuses,
  currentUserId,
  selectedTargetId = null,
  selectedTargetIds,
  multiSelect = false,
  onToggleMultiSelect,
  individualIntensity = false,
  onToggleIndividualIntensity,
  onSelect,
  onRefresh,
  onTogglePriority,
}: Props) {
  const others = participants.filter((p) => p.id !== currentUserId);
  const selectedIds = selectedTargetIds ?? (selectedTargetId ? [selectedTargetId] : []);
  const selectedSet = new Set(selectedIds);

  return (
    <div className="column flex q-mt-xs official-friends-list">
      <div className="row items-center justify-between official-friends-header">
        <div className="text-secondary official-friends-title">
          DISCORD SHOCKERS
          {multiSelect ? (individualIntensity ? ' · MULTI · EACH' : ' · MULTI') : ''}
        </div>
        <div className="row items-center no-wrap q-gutter-xs">
          {onToggleMultiSelect ? (
            <MultiShockToggle
              active={multiSelect}
              onToggle={onToggleMultiSelect}
              compact
              title="Select several people and operate them together"
            />
          ) : null}
          {multiSelect && onToggleIndividualIntensity ? (
            <IndividualIntensityToggle
              active={individualIntensity}
              onToggle={onToggleIndividualIntensity}
              compact
            />
          ) : null}
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
      </div>

      {others.length === 0 ? (
        <div className="text-grey-5 official-friends-empty">No other participants</div>
      ) : (
        others.map((p) => {
          const status = statuses[p.id];
          const banned = Boolean(status?.bannedYou);
          const eStop = Boolean(
            status?.emergencyStop || status?.shockers?.some((s) => s.emergencyStop),
          );
          const notLoggedIn = Boolean(status && !status.linked);
          const selectable =
            Boolean(status) &&
            !notLoggedIn &&
            (banned || eStop || status?.available || (status?.shockers?.length ?? 0) > 0);
          const active = selectedSet.has(p.id);
          const label = statusLabel(status);
          const detail = statusDetail(status);
          const primary = !banned && !notLoggedIn ? status?.shockers?.[0] : undefined;
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
          const multiColor = multiSelect && active ? colorForUser(`u:${p.id}`) : undefined;

          const starred = Boolean(status?.priority);

          return (
            <div
              key={p.id}
              className={`official-friend-row ${starred ? 'starred' : ''}`}
            >
              <button
                type="button"
                disabled={!selectable}
                className={`official-friend-btn ${active && !multiSelect ? 'active' : ''} ${
                  selectable ? '' : 'disabled'
                } ${banned ? 'blocked' : ''} ${eStop && !banned ? 'estop' : ''} ${
                  notLoggedIn ? 'not-logged-in' : ''
                }`}
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
                      banned || eStop || notLoggedIn || !status?.available ? 'bad' : 'ok'
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
              {onTogglePriority ? (
                <button
                  type="button"
                  className={`official-friend-star ${starred ? 'active' : ''}`}
                  title={
                    starred
                      ? 'Remove queue priority'
                      : 'Star for queue priority on your shockers'
                  }
                  aria-label={starred ? 'Unstar for priority' : 'Star for priority'}
                  aria-pressed={starred}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onTogglePriority(p.id, !starred);
                  }}
                >
                  <i
                    className={`q-icon mdi ${starred ? 'mdi-star' : 'mdi-star-outline'}`}
                    style={{ fontSize: 16 }}
                    aria-hidden
                  />
                </button>
              ) : null}
            </div>
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
  if (!status.linked) return 'Not logged in · Disabled';
  if (status.available) return 'Available';
  if (status.paused) return 'Paused';
  if (!status.consent) return 'No consent · Disabled';
  return 'Unavailable · Disabled';
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
    return 'They are not logged in to PiShock — control is disabled';
  }
  if (!status.consent) {
    return 'They have not consented — control is disabled';
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
