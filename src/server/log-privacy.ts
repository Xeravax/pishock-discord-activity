/**
 * Per-user log sharing preferences.
 *
 * The wearer (target) of a command decides how *their* hits show up for other
 * people in the shared log feed: where (scope), what (sender, shocker, intensity,
 * location), which actions, and whether others may turn them into share cards.
 * A sender may additionally ask to appear as "Someone" to third parties.
 *
 * The two people involved in a command (target and sender) always see the full
 * row — a wearer must always be able to find out who shocked them.
 */

export const LOG_VISIBILITY = ['everywhere', 'server', 'channel', 'private'] as const;
export type LogVisibility = (typeof LOG_VISIBILITY)[number];

export type LogPrivacy = {
  /** Where third parties can see your hits. */
  visibility: LogVisibility;
  /** Show who shocked you. */
  showSender: boolean;
  /** Show shocker + hub names. */
  showDevice: boolean;
  /** Show intensity + duration. */
  showIntensity: boolean;
  /** Show the server / channel name and icon. */
  showLocation: boolean;
  /** Which actions on you appear in the shared feed. */
  includeShock: boolean;
  includeVibrate: boolean;
  includeBeep: boolean;
  /** Let other people create share images of your hits. */
  allowShareCards: boolean;
  /** When *you* send a command, appear as "Someone" to third parties. */
  hideMeAsSender: boolean;
};

export const DEFAULT_LOG_PRIVACY: LogPrivacy = {
  visibility: 'everywhere',
  showSender: true,
  showDevice: true,
  showIntensity: true,
  showLocation: true,
  includeShock: true,
  includeVibrate: true,
  includeBeep: true,
  allowShareCards: true,
  hideMeAsSender: false,
};

/** Prisma column names on DiscordUser, keyed by LogPrivacy field. */
export const LOG_PRIVACY_COLUMNS = {
  visibility: 'logVisibility',
  showSender: 'logShowSender',
  showDevice: 'logShowDevice',
  showIntensity: 'logShowIntensity',
  showLocation: 'logShowLocation',
  includeShock: 'logIncludeShock',
  includeVibrate: 'logIncludeVibrate',
  includeBeep: 'logIncludeBeep',
  allowShareCards: 'logAllowShareCards',
  hideMeAsSender: 'logHideMeAsSender',
} as const satisfies Record<keyof LogPrivacy, string>;

export type LogPrivacyColumns = {
  logVisibility: string;
  logShowSender: boolean;
  logShowDevice: boolean;
  logShowIntensity: boolean;
  logShowLocation: boolean;
  logIncludeShock: boolean;
  logIncludeVibrate: boolean;
  logIncludeBeep: boolean;
  logAllowShareCards: boolean;
  logHideMeAsSender: boolean;
};

export const LOG_PRIVACY_SELECT = Object.fromEntries(
  Object.values(LOG_PRIVACY_COLUMNS).map((col) => [col, true]),
) as { [K in keyof LogPrivacyColumns]: true };

export function normalizeLogVisibility(raw: unknown): LogVisibility {
  return LOG_VISIBILITY.includes(raw as LogVisibility) ? (raw as LogVisibility) : 'everywhere';
}

export function logPrivacyFromColumns(row: Partial<LogPrivacyColumns> | null | undefined): LogPrivacy {
  if (!row) return { ...DEFAULT_LOG_PRIVACY };
  const out = { ...DEFAULT_LOG_PRIVACY };
  out.visibility = normalizeLogVisibility(row.logVisibility);
  for (const [key, col] of Object.entries(LOG_PRIVACY_COLUMNS) as Array<
    [keyof LogPrivacy, keyof LogPrivacyColumns]
  >) {
    if (key === 'visibility') continue;
    const v = row[col];
    if (typeof v === 'boolean') (out[key] as boolean) = v;
  }
  return out;
}

/** Validate a partial patch from the client into column updates. Unknown / bad fields are ignored. */
export function logPrivacyPatchToColumns(patch: unknown): Partial<LogPrivacyColumns> {
  const data: Partial<LogPrivacyColumns> = {};
  if (!patch || typeof patch !== 'object') return data;
  const p = patch as Record<string, unknown>;
  if (LOG_VISIBILITY.includes(p.visibility as LogVisibility)) {
    data.logVisibility = p.visibility as LogVisibility;
  }
  for (const [key, col] of Object.entries(LOG_PRIVACY_COLUMNS) as Array<
    [keyof LogPrivacy, keyof LogPrivacyColumns]
  >) {
    if (key === 'visibility') continue;
    if (typeof p[key] === 'boolean') (data as Record<string, unknown>)[col] = p[key];
  }
  return data;
}

export type LogViewer = {
  id: string;
  /** Viewer's current activity location (verified). Null when unknown. */
  guildId: string | null;
  channelId: string | null;
};

export type LogPerson = {
  id: string;
  username: string | null;
  globalName: string | null;
  displayName: string;
  avatar: string | null;
  avatarUrl: string;
};

export type PublicLogRow = {
  id: string;
  action: string;
  shockerId: number | null;
  shockerName: string | null;
  hubClientId: string | null;
  hubName: string | null;
  warningLevel: string | null;
  intensity: number | null;
  durationMs: number | null;
  success: boolean;
  createdAt: Date;
  source: 'discord' | 'website';
  location: {
    kind: string | null;
    name: string | null;
    iconUrl: string | null;
    guildId: string | null;
    channelId: string | null;
  } | null;
  executor: LogPerson;
  target: LogPerson;
  /** Whether this viewer may create a share card from the row. */
  shareable?: boolean;
};

/** Row location used for scope checks (independent of whether the name is shown). */
export type RowScope = { guildId: string | null; channelId: string | null };

const HIDDEN_SENDER: LogPerson = {
  id: 'hidden',
  username: null,
  globalName: null,
  displayName: 'Someone',
  avatar: null,
  avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
};

/** Map raw log actions (e.g. "participant_shock", "hold_vibrate") onto shock / vibrate / beep. */
export function logActionKind(action: string): 'shock' | 'vibrate' | 'beep' | 'other' {
  const a = String(action || '').toLowerCase();
  if (a.includes('vibrat')) return 'vibrate';
  if (a.includes('beep')) return 'beep';
  if (a.includes('shock') || a.includes('hold') || a.includes('zap')) return 'shock';
  return 'other';
}

function actionIncluded(action: string, prefs: LogPrivacy): boolean {
  const kind = logActionKind(action);
  if (kind === 'shock') return prefs.includeShock;
  if (kind === 'vibrate') return prefs.includeVibrate;
  if (kind === 'beep') return prefs.includeBeep;
  return true;
}

function inScope(prefs: LogPrivacy, scope: RowScope, viewer: LogViewer): boolean {
  switch (prefs.visibility) {
    case 'everywhere':
      return true;
    case 'private':
      return false;
    case 'channel':
      return Boolean(scope.channelId && viewer.channelId && scope.channelId === viewer.channelId);
    case 'server':
      if (scope.guildId) return Boolean(viewer.guildId && scope.guildId === viewer.guildId);
      // DMs / group DMs have no guild — fall back to the same channel.
      return Boolean(scope.channelId && viewer.channelId && scope.channelId === viewer.channelId);
    default:
      return false;
  }
}

/**
 * Apply the target's (and sender's) preferences for one viewer.
 * Returns null when the row must be hidden from this viewer.
 */
export function applyLogPrivacy(
  row: PublicLogRow,
  scope: RowScope,
  targetPrefs: LogPrivacy,
  executorPrefs: LogPrivacy | null,
  viewer: LogViewer,
): PublicLogRow | null {
  const isTarget = viewer.id === row.target.id;
  const isExecutor = viewer.id === row.executor.id;
  if (isTarget || isExecutor) {
    // Involved people always see everything. Only the wearer can always share their own hit.
    return { ...row, shareable: isTarget || targetPrefs.allowShareCards };
  }

  if (!actionIncluded(row.action, targetPrefs)) return null;
  if (!inScope(targetPrefs, scope, viewer)) return null;

  const out: PublicLogRow = { ...row, shareable: targetPrefs.allowShareCards };
  if (!targetPrefs.showSender || executorPrefs?.hideMeAsSender) {
    out.executor = { ...HIDDEN_SENDER };
  }
  if (!targetPrefs.showDevice) {
    out.shockerId = null;
    out.shockerName = null;
    out.hubClientId = null;
    out.hubName = null;
  }
  if (!targetPrefs.showIntensity) {
    out.intensity = null;
    out.durationMs = null;
  }
  if (!targetPrefs.showLocation) {
    out.location = null;
  }
  return out;
}
