export type DiscordParticipant = {
  id: string;
  username?: string;
  global_name?: string | null;
  avatar?: string | null;
  displayName: string;
  avatarUrl: string;
};

export type ParticipantShockerStatus = {
  shockerId: number;
  shockerName: string;
  hubClientId?: string | null;
  hubName?: string | null;
  /** PiShock device/API ceiling (red zone above this) */
  deviceMaxIntensity: number;
  deviceMaxDurationMs: number;
  /** Discord Activity Limit usable band (shock) */
  minIntensity: number;
  maxIntensity: number;
  minDurationMs: number;
  maxDurationMs: number;
  vibMinIntensity?: number;
  vibMaxIntensity?: number;
  vibMinDurationMs?: number;
  vibMaxDurationMs?: number;
  beepMinIntensity?: number;
  beepMaxIntensity?: number;
  beepMinDurationMs?: number;
  beepMaxDurationMs?: number;
  requiredWarningLevel?: 'none' | 'small' | 'mid' | 'long';
  canShock: boolean;
  canVibrate: boolean;
  canBeep: boolean;
  canHold: boolean;
  paused: boolean;
  /** Owner kill-switch latched — no commands accepted */
  emergencyStop?: boolean;
};

export type ParticipantStatus = {
  discordUserId: string;
  username: string | null;
  globalName: string | null;
  avatar: string | null;
  linked: boolean;
  consent: boolean;
  available: boolean;
  paused: boolean;
  /** True when every shared shocker is under emergency stop */
  emergencyStop?: boolean;
  bannedYou: boolean;
  /** Caller's star — this person's commands to the caller get queue priority */
  priority?: boolean;
  /** Their queue / access rules when you target them */
  queue?: {
    enabled: boolean;
    starOnly: boolean;
    starredByThem: boolean;
    canOperate: boolean;
    /** Processing paused — you can still join the queue */
    paused: boolean;
    /** Closed to new entries — waiting items are kept */
    halted: boolean;
    maxPerSender: number;
    progressMs: number;
  };
  shockers: ParticipantShockerStatus[];
};

function defaultAvatarIndex(userId: string): number {
  try {
    if (/^\d+$/.test(userId)) {
      return Number((BigInt(userId) >> 22n) % 6n);
    }
  } catch {
    // fall through
  }
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
  }
  return Math.abs(hash) % 6;
}

export function participantAvatarUrl(id: string, avatar?: string | null): string {
  if (avatar) {
    return `https://cdn.discordapp.com/avatars/${id}/${avatar}.png?size=128`;
  }
  return `https://cdn.discordapp.com/embed/avatars/${defaultAvatarIndex(id)}.png`;
}

export function normalizeParticipant(raw: Record<string, unknown>): DiscordParticipant {
  const id = String(raw.id ?? raw.user_id ?? '');
  const username = raw.username != null ? String(raw.username) : undefined;
  const global_name =
    raw.global_name != null
      ? String(raw.global_name)
      : raw.globalName != null
        ? String(raw.globalName)
        : null;
  const avatar = raw.avatar != null ? String(raw.avatar) : null;
  const nickname =
    raw.nickname != null
      ? String(raw.nickname)
      : raw.nick != null
        ? String(raw.nick)
        : null;
  return {
    id,
    username,
    global_name,
    avatar,
    displayName: nickname || global_name || username || 'Unknown',
    avatarUrl: participantAvatarUrl(id, avatar),
  };
}
