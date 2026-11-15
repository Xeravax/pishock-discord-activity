import {
  DiscordSDK,
  Common,
  Events,
  Permissions,
  PermissionUtils,
  Platform,
} from '@discord/embedded-app-sdk';
import { apiFetch, isEmbedded } from './api';
import { normalizeParticipant, type DiscordParticipant } from './participants';
import {
  applyDiscordSafeAreaFallback,
  installDiscordSafeAreaFallback,
} from './safeArea';

export type DiscordUserProfile = {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
};

export type AuthState = {
  accessToken: string;
  user: DiscordUserProfile;
  /** True when authorize included rpc.voice.read successfully. */
  voiceRead: boolean;
};

export type CurrentUserUpdate = {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
};

export type CurrentGuildMemberUpdate = {
  user_id: string;
  nick?: string | null;
  guild_id: string;
  avatar?: string | null;
};

export type VoiceStateFlags = {
  muted: boolean;
  speaking: boolean;
};

export type VoiceStateUpdate = {
  voice_state?: {
    mute?: boolean;
    deaf?: boolean;
    self_mute?: boolean;
    self_deaf?: boolean;
    suppress?: boolean;
  };
  user?: { id?: string };
  nick?: string | null;
  mute?: boolean;
};

export type SpeakingUpdate = {
  channel_id?: string;
  user_id?: string;
};

const BASE_SCOPES = [
  'identify',
  'guilds',
  'guilds.members.read',
  'rpc.activities.write',
] as const;

const VOICE_SCOPES = [...BASE_SCOPES, 'rpc.voice.read'] as const;

const SPEAKING_STALE_MS = 2000;
/** Authorize/authenticate should answer quickly with prompt: 'none'. */
const DISCORD_AUTH_TIMEOUT_MS = 15_000;

class DiscordCommandTimeoutError extends Error {
  constructor(step: string) {
    super(`Discord didn’t respond while ${step}. Close the activity and launch it again.`);
    this.name = 'DiscordCommandTimeoutError';
  }
}

/** Swallow a Discord RPC that rejects or never settles. Boot must not wait on it. */
function ignoreRejection(work: Promise<unknown> | unknown): void {
  if (work && typeof (work as Promise<unknown>).then === 'function') {
    void (work as Promise<unknown>).then(
      () => undefined,
      () => undefined,
    );
  }
}

function withDeadline<T>(promise: Promise<T>, ms: number, step: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new DiscordCommandTimeoutError(step));
    }, ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Orientation lock and interactive PIP are optional. Desktop and a replaced
 * iframe often never acknowledge them. Apply after authorize so a missing
 * reply cannot pin startup on "Preparing activity…".
 */
function applyOptionalActivityChrome(discordSdk: DiscordSDK): void {
  ignoreRejection(
    discordSdk.commands.setOrientationLockState({
      lock_state: Common.OrientationLockStateTypeObject.UNLOCKED,
      picture_in_picture_lock_state: Common.OrientationLockStateTypeObject.LANDSCAPE,
      grid_lock_state: Common.OrientationLockStateTypeObject.LANDSCAPE,
    }),
  );
  ignoreRejection(discordSdk.commands.setConfig({ use_interactive_pip: true }));
  ignoreRejection(
    discordSdk.subscribe(Events.ORIENTATION_UPDATE, () => {
      applyDiscordSafeAreaFallback();
    }),
  );
}

/** Prefer server nick, then global display name, then username. */
export function discordDisplayName(
  user: Pick<DiscordUserProfile, 'username' | 'global_name'>,
  guildNick?: string | null,
): string {
  const nick = guildNick?.trim();
  if (nick) return nick;
  const global = user.global_name?.trim();
  if (global) return global;
  return user.username || 'Unknown';
}

export function guildMemberAvatarUrl(
  guildId: string,
  userId: string,
  avatar: string | null | undefined,
): string | null {
  if (!avatar || !guildId || !userId) return null;
  const ext = avatar.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/avatars/${avatar}.${ext}?size=128`;
}

function isVoiceMuted(state: VoiceStateUpdate['voice_state'], topLevelMute?: boolean): boolean {
  if (topLevelMute) return true;
  if (!state) return false;
  return Boolean(state.mute || state.self_mute || state.suppress);
}

let sdk: DiscordSDK | null = null;

/** Drop cached SDK / location state so a reload always re-auths cleanly. */
export function resetDiscordClient() {
  sdk = null;
  locationHintCache = null;
}

function clientId(): string {
  return import.meta.env.VITE_DISCORD_CLIENT_ID || 'dev_dummy_client_id';
}

export function getDiscordSdk(): DiscordSDK {
  if (sdk) return sdk;
  if (isEmbedded) {
    sdk = new DiscordSDK(clientId(), { disableConsoleLogOverride: true });
  } else {
    const dummyParams = new URLSearchParams({
      frame_id: 'dummy_frame_id',
      instance_id: 'dummy_instance_id',
      platform: 'desktop',
      sdk_version: '1.0.0',
    });
    const originalSearch = window.location.search;
    window.history.replaceState({}, '', `${window.location.pathname}?${dummyParams}`);
    sdk = new DiscordSDK(clientId(), { disableConsoleLogOverride: true });
    window.history.replaceState({}, '', `${window.location.pathname}${originalSearch}`);
  }
  return sdk;
}

export function getActivityInstanceId(): string | null {
  try {
    return getDiscordSdk().instanceId ?? null;
  } catch {
    return null;
  }
}

export type ActivityLocationHint = {
  guildId: string | null;
  channelId: string | null;
  locationKind: string | null;
  locationName: string | null;
  locationIconUrl: string | null;
};

type DiscordGuildSummary = {
  id: string;
  name?: string;
  icon?: string | null;
};

function guildIconUrl(guildId: string, icon: string | null | undefined): string | null {
  if (!icon) return null;
  const ext = icon.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/icons/${guildId}/${icon}.${ext}?size=64`;
}

let locationHintCache: { key: string; at: number; value: ActivityLocationHint } | null = null;
const LOCATION_HINT_TTL_MS = 5 * 60_000;

/**
 * Resolve the current activity's guild/DM name + icon via the user's OAuth token
 * and Embedded App SDK (more reliable than bot GET /guilds when the bot isn't in-server).
 */
export async function resolveActivityLocationHint(
  accessToken: string,
): Promise<ActivityLocationHint | null> {
  if (!isEmbedded || !accessToken || accessToken === 'dev-token') return null;

  try {
    const sdk = getDiscordSdk();
    const guildId = sdk.guildId ? String(sdk.guildId) : null;
    const channelId = sdk.channelId ? String(sdk.channelId) : null;
    const cacheKey = `${guildId ?? ''}:${channelId ?? ''}`;
    if (
      locationHintCache &&
      locationHintCache.key === cacheKey &&
      Date.now() - locationHintCache.at < LOCATION_HINT_TTL_MS
    ) {
      return locationHintCache.value;
    }

    let locationName: string | null = null;
    let locationIconUrl: string | null = null;
    let locationKind: string | null = guildId ? 'gc' : channelId ? 'dm' : null;

    if (guildId) {
      const res = await fetch('https://discord.com/api/users/@me/guilds', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const guilds = (await res.json()) as DiscordGuildSummary[];
        const guild = Array.isArray(guilds) ? guilds.find((g) => String(g.id) === guildId) : null;
        if (guild) {
          locationName = guild.name ? String(guild.name) : null;
          locationIconUrl = guildIconUrl(guildId, guild.icon);
        }
      }
    }

    if (channelId && guildId) {
      try {
        const channel = await sdk.commands.getChannel({ channel_id: channelId });
        if (!locationName && channel?.name) {
          locationName = String(channel.name);
        }
      } catch {
        // optional — guild name from /users/@me/guilds is enough
      }
    } else if (channelId && !guildId) {
      locationKind = 'dm';
      try {
        const channel = await sdk.commands.getChannel({ channel_id: channelId });
        const name = channel?.name ? String(channel.name).trim() : '';
        if (name) locationName = name;
        else if (channel?.type === 3) locationName = 'Group DM';
        else locationName = 'Direct Message';
      } catch {
        locationName = locationName ?? 'Direct Message';
      }
    }

    if (!locationName && guildId) locationName = 'Discord Server';

    const value: ActivityLocationHint = {
      guildId,
      channelId,
      locationKind,
      locationName,
      locationIconUrl,
    };
    locationHintCache = { key: cacheKey, at: Date.now(), value };
    return value;
  } catch {
    return null;
  }
}

export type BootstrapProgress = {
  progress: number;
  label: string;
};

export async function bootstrapDiscord(
  onLayout: (pip: boolean) => void,
  onProgress?: (update: BootstrapProgress) => void,
): Promise<AuthState> {
  const report = (progress: number, label: string) => {
    onProgress?.({ progress, label });
  };

  if (!isEmbedded) {
    report(40, 'Local preview…');
    return {
      accessToken: 'dev-token',
      user: {
        id: 'dev-user',
        username: 'DevUser',
        global_name: 'Local Dev',
      },
      voiceRead: false,
    };
  }

  report(8, 'Connecting to Discord…');
  // Always start from a fresh SDK instance after reload / version bump.
  resetDiscordClient();
  const discordSdk = getDiscordSdk();
  await withDeadline(discordSdk.ready(), DISCORD_AUTH_TIMEOUT_MS, 'connecting');
  report(22, 'Preparing activity…');
  installDiscordSafeAreaFallback();

  const applyLayout = (layoutMode: number) => {
    applyDiscordSafeAreaFallback();
    onLayout(layoutMode === Common.LayoutModeTypeObject.PIP);
  };

  // Prefer compat helper (covers old ACTIVITY_PIP_MODE_UPDATE + new layout events)
  try {
    const sdkAny = discordSdk as DiscordSDK & {
      subscribeToLayoutModeUpdatesCompat?: (
        cb: (update: { layout_mode: number }) => void,
      ) => void | Promise<unknown>;
    };
    if (typeof sdkAny.subscribeToLayoutModeUpdatesCompat === 'function') {
      ignoreRejection(
        sdkAny.subscribeToLayoutModeUpdatesCompat((update) => applyLayout(update.layout_mode)),
      );
    }
  } catch {
    // optional
  }

  // Also subscribe to the modern layout event directly
  try {
    ignoreRejection(
      discordSdk.subscribe(Events.ACTIVITY_LAYOUT_MODE_UPDATE, (update) => {
        applyLayout(update.layout_mode);
      }),
    );
  } catch {
    // optional
  }

  report(38, 'Authorizing with Discord…');
  let voiceRead = false;
  let code: string;
  try {
    const withVoice = await withDeadline(
      discordSdk.commands.authorize({
        client_id: clientId(),
        response_type: 'code',
        state: '',
        prompt: 'none',
        scope: [...VOICE_SCOPES],
      }),
      DISCORD_AUTH_TIMEOUT_MS,
      'authorizing',
    );
    code = withVoice.code;
    voiceRead = true;
  } catch (err) {
    if (err instanceof DiscordCommandTimeoutError) throw err;
    const base = await withDeadline(
      discordSdk.commands.authorize({
        client_id: clientId(),
        response_type: 'code',
        state: '',
        prompt: 'none',
        scope: [...BASE_SCOPES],
      }),
      DISCORD_AUTH_TIMEOUT_MS,
      'authorizing',
    );
    code = base.code;
    voiceRead = false;
  }

  report(58, 'Exchanging session…');
  const result = await apiFetch<{
    access_token: string;
    user: AuthState['user'];
  }>('/auth/discord', null, {
    method: 'POST',
    body: JSON.stringify({ code }),
  });

  report(72, 'Signing into activity…');
  await withDeadline(
    discordSdk.commands.authenticate({ access_token: result.access_token }),
    DISCORD_AUTH_TIMEOUT_MS,
    'signing in',
  );
  applyOptionalActivityChrome(discordSdk);
  report(82, 'Authenticated');

  return {
    accessToken: result.access_token,
    user: result.user,
    voiceRead,
  };
}

export async function fetchInstanceParticipants(): Promise<DiscordParticipant[]> {
  if (!isEmbedded) return [];
  const discordSdk = getDiscordSdk();
  const result = await discordSdk.commands.getInstanceConnectedParticipants();
  const list = (result as { participants?: Array<Record<string, unknown>> }).participants ?? [];
  return list.map((p) => normalizeParticipant(p));
}

export function subscribeParticipants(
  onUpdate: (participants: DiscordParticipant[]) => void,
): () => void {
  if (!isEmbedded) return () => undefined;
  const discordSdk = getDiscordSdk();
  const handler = (data: { participants?: Array<Record<string, unknown>> }) => {
    const list = data.participants ?? [];
    onUpdate(list.map((p) => normalizeParticipant(p)));
  };
  try {
    discordSdk.subscribe(Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE, handler);
  } catch {
    // older SDK / unsupported
  }
  return () => {
    try {
      discordSdk.unsubscribe(Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE, handler);
    } catch {
      // ignore
    }
  };
}

export function subscribeCurrentUser(
  onUpdate: (user: CurrentUserUpdate) => void,
): () => void {
  if (!isEmbedded) return () => undefined;
  const discordSdk = getDiscordSdk();
  const handler = (data: CurrentUserUpdate) => {
    onUpdate({
      id: String(data.id),
      username: String(data.username ?? ''),
      global_name: data.global_name != null ? String(data.global_name) : null,
      avatar: data.avatar != null ? String(data.avatar) : null,
    });
  };
  try {
    void discordSdk.subscribe(Events.CURRENT_USER_UPDATE, handler);
  } catch {
    // optional
  }
  return () => {
    try {
      void discordSdk.unsubscribe(Events.CURRENT_USER_UPDATE, handler);
    } catch {
      // ignore
    }
  };
}

export function subscribeCurrentGuildMember(
  onUpdate: (member: CurrentGuildMemberUpdate) => void,
): () => void {
  if (!isEmbedded) return () => undefined;
  let discordSdk: DiscordSDK;
  try {
    discordSdk = getDiscordSdk();
  } catch {
    return () => undefined;
  }
  const guildId = discordSdk.guildId ? String(discordSdk.guildId) : null;
  if (!guildId) return () => undefined;

  const handler = (data: CurrentGuildMemberUpdate) => {
    onUpdate({
      user_id: String(data.user_id ?? ''),
      nick: data.nick != null && String(data.nick).trim() ? String(data.nick) : null,
      guild_id: String(data.guild_id ?? guildId),
      avatar: data.avatar != null ? String(data.avatar) : null,
    });
  };
  try {
    void discordSdk.subscribe(Events.CURRENT_GUILD_MEMBER_UPDATE, handler, {
      guild_id: guildId,
    });
  } catch {
    // optional / DM / unsupported
  }
  return () => {
    try {
      void discordSdk.unsubscribe(Events.CURRENT_GUILD_MEMBER_UPDATE, handler, {
        guild_id: guildId,
      });
    } catch {
      // ignore
    }
  };
}

/**
 * Seed mute flags + live voice/speaking subscriptions for the activity channel.
 * Requires rpc.voice.read (AuthState.voiceRead).
 */
export function subscribeVoiceIndicators(
  onUpdate: (map: Record<string, VoiceStateFlags>) => void,
): () => void {
  if (!isEmbedded) return () => undefined;
  let discordSdk: DiscordSDK;
  try {
    discordSdk = getDiscordSdk();
  } catch {
    return () => undefined;
  }
  const channelId = discordSdk.channelId ? String(discordSdk.channelId) : null;
  if (!channelId) return () => undefined;

  const map: Record<string, VoiceStateFlags> = {};
  const speakingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let cancelled = false;

  const emit = () => {
    if (cancelled) return;
    onUpdate({ ...map });
  };

  const ensure = (userId: string): VoiceStateFlags => {
    if (!map[userId]) map[userId] = { muted: false, speaking: false };
    return map[userId];
  };

  const clearSpeakingTimer = (userId: string) => {
    const t = speakingTimers.get(userId);
    if (t) {
      clearTimeout(t);
      speakingTimers.delete(userId);
    }
  };

  const setSpeaking = (userId: string, speaking: boolean) => {
    if (!userId) return;
    const row = ensure(userId);
    clearSpeakingTimer(userId);
    if (speaking) {
      row.speaking = true;
      speakingTimers.set(
        userId,
        setTimeout(() => {
          speakingTimers.delete(userId);
          if (map[userId]) {
            map[userId].speaking = false;
            emit();
          }
        }, SPEAKING_STALE_MS),
      );
    } else {
      row.speaking = false;
    }
    emit();
  };

  const onVoiceState = (data: VoiceStateUpdate) => {
    const userId = data.user?.id != null ? String(data.user.id) : '';
    if (!userId) return;
    const row = ensure(userId);
    row.muted = isVoiceMuted(data.voice_state, data.mute);
    emit();
  };

  const onSpeakingStart = (data: SpeakingUpdate) => {
    setSpeaking(data.user_id != null ? String(data.user_id) : '', true);
  };

  const onSpeakingStop = (data: SpeakingUpdate) => {
    setSpeaking(data.user_id != null ? String(data.user_id) : '', false);
  };

  const args = { channel_id: channelId };

  void (async () => {
    try {
      const channel = await discordSdk.commands.getChannel({ channel_id: channelId });
      if (cancelled) return;
      const states =
        (channel as { voice_states?: VoiceStateUpdate[] }).voice_states ?? [];
      for (const vs of states) {
        const userId = vs.user?.id != null ? String(vs.user.id) : '';
        if (!userId) continue;
        const row = ensure(userId);
        row.muted = isVoiceMuted(vs.voice_state, vs.mute);
      }
      emit();
    } catch {
      // optional — live events still work
    }

    try {
      await discordSdk.subscribe(Events.VOICE_STATE_UPDATE, onVoiceState, args);
      await discordSdk.subscribe(Events.SPEAKING_START, onSpeakingStart, args);
      await discordSdk.subscribe(Events.SPEAKING_STOP, onSpeakingStop, args);
    } catch {
      // missing scope / unsupported
    }
  })();

  return () => {
    cancelled = true;
    for (const t of speakingTimers.values()) clearTimeout(t);
    speakingTimers.clear();
    try {
      void discordSdk.unsubscribe(Events.VOICE_STATE_UPDATE, onVoiceState, args);
      void discordSdk.unsubscribe(Events.SPEAKING_START, onSpeakingStart, args);
      void discordSdk.unsubscribe(Events.SPEAKING_STOP, onSpeakingStop, args);
    } catch {
      // ignore
    }
  };
}

export async function openExternal(url: string) {
  if (isEmbedded) {
    const discordSdk = getDiscordSdk();
    try {
      await discordSdk.commands.openExternalLink({ url });
      return;
    } catch {
      // fall through
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** True when the Discord client reports desktop (share-moment is desktop-only). */
export function isDesktopPlatform(): boolean {
  if (!isEmbedded) return false;
  try {
    return getDiscordSdk().platform === Platform.DESKTOP;
  } catch {
    return new URLSearchParams(window.location.search).get('platform') === Platform.DESKTOP;
  }
}

export type InviteActivityResult =
  | { method: 'invite_dialog' }
  | { method: 'share_link'; success: boolean };

/**
 * Invite someone into the activity: guild invite dialog when permitted,
 * otherwise shareLink (works in DMs / without CREATE_INSTANT_INVITE).
 */
export async function inviteToActivity(): Promise<InviteActivityResult> {
  if (!isEmbedded) {
    throw new Error('Invite is only available inside Discord');
  }
  const discordSdk = getDiscordSdk();
  const guildId = discordSdk.guildId ? String(discordSdk.guildId) : null;

  if (guildId) {
    try {
      const { permissions } = await discordSdk.commands.getChannelPermissions();
      if (PermissionUtils.can(Permissions.CREATE_INSTANT_INVITE, permissions)) {
        await discordSdk.commands.openInviteDialog();
        return { method: 'invite_dialog' };
      }
    } catch {
      // Fall through to shareLink
    }
  }

  const { success } = await discordSdk.commands.shareLink({
    message: 'Join me in the PiShock activity.',
  });
  return { method: 'share_link', success };
}

/** Upload a PNG (or other image) to Discord’s ephemeral activity attachment CDN. */
export async function uploadActivityAttachment(
  accessToken: string,
  file: Blob,
  filename?: string,
): Promise<string> {
  if (!accessToken || accessToken === 'dev-token') {
    throw new Error('Share requires Discord authentication');
  }
  const name =
    filename ?? (file.type === 'image/gif' ? 'pishock-moment.gif' : 'pishock-moment.png');
  const body = new FormData();
  body.append('file', file, name);
  const res = await fetch(
    `https://discord.com/api/applications/${clientId()}/attachment`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body,
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Attachment upload failed (${res.status})`);
  }
  const json = (await res.json()) as { attachment?: { url?: string }; url?: string };
  const mediaUrl = json.attachment?.url || json.url;
  if (!mediaUrl) throw new Error('Attachment upload returned no URL');
  return String(mediaUrl);
}

/** Open Discord’s share-moment dialog (desktop only). */
export async function openShareMoment(mediaUrl: string): Promise<void> {
  if (!isEmbedded) {
    throw new Error('Share is only available inside Discord');
  }
  if (!isDesktopPlatform()) {
    throw new Error('Share moment is only available on desktop Discord');
  }
  const discordSdk = getDiscordSdk();
  await discordSdk.commands.openShareMomentDialog({ mediaUrl });
}

/**
 * Rich Presence via Embedded App SDK `setActivity`.
 * Requires Developer Portal art asset key `pishock_logo`, Activities enabled,
 * and `rpc.activities.write` (already requested at authorize). Portal toggles
 * cannot be enabled from code.
 */
import {
  PRESENCE_ASSET_KEY,
  PRESENCE_PARTY_SOFT_MAX,
  type PresenceSnapshot,
} from '../shared/presence';

export {
  buildPresenceSnapshot,
  PRESENCE_ASSET_KEY,
  PRESENCE_PARTY_SOFT_MAX,
  type PresenceSnapshot,
} from '../shared/presence';

const PRESENCE_DEBOUNCE_MS = 400;

let presenceTimer: ReturnType<typeof setTimeout> | null = null;
let lastPresenceKey: string | null = null;
let presenceInflight: string | null = null;

function presenceKey(snapshot: PresenceSnapshot): string {
  return [
    snapshot.details,
    snapshot.state,
    snapshot.partySize,
    snapshot.partyMax,
    snapshot.instanceId ?? '',
    snapshot.startedAt,
  ].join('|');
}

async function pushRichPresence(snapshot: PresenceSnapshot): Promise<void> {
  if (!isEmbedded) return;
  const key = presenceKey(snapshot);
  if (key === lastPresenceKey || key === presenceInflight) return;
  presenceInflight = key;
  try {
    const discordSdk = getDiscordSdk();
    const partyId = snapshot.instanceId || `pishock-${snapshot.startedAt}`;
    const current = Math.max(1, Math.floor(snapshot.partySize) || 1);
    const max = Math.max(current, Math.floor(snapshot.partyMax) || PRESENCE_PARTY_SOFT_MAX);
    // Unix seconds for Discord timestamps
    const startSec = Math.floor(snapshot.startedAt / 1000);
    await discordSdk.commands.setActivity({
      activity: {
        type: 0,
        details: snapshot.details,
        state: snapshot.state,
        instance: true,
        timestamps: { start: startSec },
        assets: {
          large_image: PRESENCE_ASSET_KEY,
          large_text: 'PiShock',
        },
        party: {
          id: partyId,
          size: [current, max],
        },
      },
    });
    lastPresenceKey = key;
  } catch {
    // Optional on some clients / missing scope / missing art asset
  } finally {
    if (presenceInflight === key) presenceInflight = null;
  }
}

/** Debounced Rich Presence update from privacy-safe app state. */
export function updateRichPresence(snapshot: PresenceSnapshot): void {
  if (!isEmbedded) return;
  if (presenceTimer) clearTimeout(presenceTimer);
  presenceTimer = setTimeout(() => {
    presenceTimer = null;
    void pushRichPresence(snapshot);
  }, PRESENCE_DEBOUNCE_MS);
}
