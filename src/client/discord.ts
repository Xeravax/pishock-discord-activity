import { DiscordSDK, Common, Events } from '@discord/embedded-app-sdk';
import { apiFetch, isEmbedded } from './api';
import { normalizeParticipant, type DiscordParticipant } from './participants';

export type AuthState = {
  accessToken: string;
  user: {
    id: string;
    username: string;
    global_name?: string | null;
    avatar?: string | null;
  };
};

let sdk: DiscordSDK | null = null;

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
    };
  }

  report(8, 'Connecting to Discord…');
  const discordSdk = getDiscordSdk();
  await discordSdk.ready();
  report(22, 'Preparing activity…');

  try {
    await discordSdk.commands.setOrientationLockState({
      lock_state: Common.OrientationLockStateTypeObject.UNLOCKED,
      picture_in_picture_lock_state: Common.OrientationLockStateTypeObject.LANDSCAPE,
      grid_lock_state: Common.OrientationLockStateTypeObject.LANDSCAPE,
    });
  } catch {
    // optional
  }

  const applyLayout = (layoutMode: number) => {
    onLayout(layoutMode === Common.LayoutModeTypeObject.PIP);
  };

  // Prefer compat helper (covers old ACTIVITY_PIP_MODE_UPDATE + new layout events)
  try {
    const sdkAny = discordSdk as DiscordSDK & {
      subscribeToLayoutModeUpdatesCompat?: (cb: (update: { layout_mode: number }) => void) => void;
    };
    if (typeof sdkAny.subscribeToLayoutModeUpdatesCompat === 'function') {
      sdkAny.subscribeToLayoutModeUpdatesCompat((update) => applyLayout(update.layout_mode));
    }
  } catch {
    // optional
  }

  // Also subscribe to the modern layout event directly
  try {
    void discordSdk.subscribe(Events.ACTIVITY_LAYOUT_MODE_UPDATE, (update) => {
      applyLayout(update.layout_mode);
    });
  } catch {
    // optional
  }

  // Keep the PIP surface alive so last-hit updates (WS/logs) still arrive
  try {
    await discordSdk.commands.setConfig({ use_interactive_pip: true });
  } catch {
    // optional / unsupported on some clients
  }

  report(38, 'Authorizing with Discord…');
  const { code } = await discordSdk.commands.authorize({
    client_id: clientId(),
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify', 'guilds', 'guilds.members.read', 'rpc.activities.write'],
  });

  report(58, 'Exchanging session…');
  const result = await apiFetch<{
    access_token: string;
    user: AuthState['user'];
  }>('/auth/discord', null, {
    method: 'POST',
    body: JSON.stringify({ code }),
  });

  report(72, 'Signing into activity…');
  await discordSdk.commands.authenticate({ access_token: result.access_token });
  report(82, 'Authenticated');

  return {
    accessToken: result.access_token,
    user: result.user,
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
