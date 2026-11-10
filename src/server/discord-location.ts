import type { AppEnv } from './env.js';
import type { ActivityInstanceInfo } from './discord-instance.js';
import { verifyActivityInstance } from './discord-instance.js';

export type ActivityLocationContext = {
  instanceId: string | null;
  guildId: string | null;
  channelId: string | null;
  locationKind: string | null;
  locationName: string | null;
  locationIconUrl: string | null;
};

const EMPTY: ActivityLocationContext = {
  instanceId: null,
  guildId: null,
  channelId: null,
  locationKind: null,
  locationName: null,
  locationIconUrl: null,
};

type CacheEntry = { at: number; value: ActivityLocationContext };
const locationCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60_000;

function guildIconUrl(guildId: string, icon: string | null | undefined): string | null {
  if (!icon) return null;
  const ext = icon.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/icons/${guildId}/${icon}.${ext}?size=64`;
}

async function botGetJson(
  env: AppEnv,
  path: string,
): Promise<Record<string, unknown> | null> {
  if (!env.discordBotToken) return null;
  try {
    const res = await fetch(`https://discord.com/api/v10${path}`, {
      headers: { Authorization: `Bot ${env.discordBotToken}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export type ClientLocationHint = {
  guildId?: string | null;
  channelId?: string | null;
  locationKind?: string | null;
  locationName?: string | null;
  locationIconUrl?: string | null;
};

/** Strip untrusted client location hints (wrong guild/channel, non-Discord CDN icons). */
export function sanitizeClientHint(
  hint: ClientLocationHint | null | undefined,
  trustedGuildId: string | null,
  trustedChannelId: string | null,
): Pick<ActivityLocationContext, 'locationName' | 'locationIconUrl' | 'locationKind'> | null {
  if (!hint) return null;
  const hintGuild = hint.guildId != null ? String(hint.guildId) : null;
  const hintChannel = hint.channelId != null ? String(hint.channelId) : null;

  // Only accept name/icon when IDs match the activity instance (or instance had no IDs yet)
  if (trustedGuildId && hintGuild && hintGuild !== trustedGuildId) return null;
  if (trustedChannelId && hintChannel && hintChannel !== trustedChannelId) return null;
  if (trustedGuildId && hintGuild == null && hintChannel == null) return null;

  const name = hint.locationName != null ? String(hint.locationName).trim().slice(0, 120) : '';
  let iconUrl = hint.locationIconUrl != null ? String(hint.locationIconUrl).trim() : '';
  // Only allow Discord CDN icon URLs
  if (
    iconUrl &&
    !/^https:\/\/cdn\.discordapp\.com\/(icons|channel-icons)\//i.test(iconUrl)
  ) {
    iconUrl = '';
  }

  if (!name && !iconUrl) return null;
  return {
    locationKind: hint.locationKind != null ? String(hint.locationKind).slice(0, 32) : null,
    locationName: name || null,
    locationIconUrl: iconUrl || null,
  };
}

/**
 * Resolve a human-readable Discord location (guild or DM/group) for an activity instance.
 * Prefers a client hint (user OAuth guilds list) when IDs match; falls back to bot API.
 */
export async function resolveActivityLocation(
  env: AppEnv,
  instanceId: string | null | undefined,
  prefetched?: ActivityInstanceInfo | null,
  clientHint?: ClientLocationHint | null,
): Promise<ActivityLocationContext> {
  const id = instanceId ? String(instanceId).trim() : '';
  if (!id && !clientHint) return { ...EMPTY };

  const cacheKey = id || `hint:${clientHint?.guildId ?? ''}:${clientHint?.channelId ?? ''}`;
  if (!clientHint) {
    const cached = locationCache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.value;
    }
  }

  let instance = prefetched ?? null;
  if (!instance && id) {
    try {
      instance = await verifyActivityInstance(env, id, {
        allowMissingBot: true,
      });
    } catch {
      instance = null;
    }
  }

  const location = instance?.location;
  const guildId =
    (location?.guild_id ? String(location.guild_id) : null) ||
    (clientHint?.guildId ? String(clientHint.guildId) : null);
  const channelId =
    (location?.channel_id ? String(location.channel_id) : null) ||
    (clientHint?.channelId ? String(clientHint.channelId) : null);
  let locationKind = location?.kind
    ? String(location.kind)
    : guildId
      ? 'gc'
      : channelId
        ? 'dm'
        : null;

  let locationName: string | null = null;
  let locationIconUrl: string | null = null;

  const fromClient = sanitizeClientHint(clientHint, guildId, channelId);
  if (fromClient) {
    locationName = fromClient.locationName;
    locationIconUrl = fromClient.locationIconUrl;
    if (fromClient.locationKind) locationKind = fromClient.locationKind;
  }

  if ((!locationName || !locationIconUrl) && guildId) {
    const guild = await botGetJson(env, `/guilds/${encodeURIComponent(guildId)}`);
    if (guild) {
      if (!locationName && guild.name != null) locationName = String(guild.name);
      if (!locationIconUrl) {
        locationIconUrl = guildIconUrl(guildId, guild.icon != null ? String(guild.icon) : null);
      }
    }
  }

  if (!locationName && !guildId && channelId) {
    const channel = await botGetJson(env, `/channels/${encodeURIComponent(channelId)}`);
    if (channel) {
      const type = Number(channel.type);
      const name = channel.name != null ? String(channel.name).trim() : '';
      if (name) {
        locationName = name;
      } else if (type === 1) {
        locationName = 'Direct Message';
      } else if (type === 3) {
        locationName = 'Group DM';
      } else {
        locationName = 'Private Channel';
      }
      const icon = channel.icon != null ? String(channel.icon) : null;
      if (icon && !locationIconUrl) {
        locationIconUrl = `https://cdn.discordapp.com/channel-icons/${channelId}/${icon}.png?size=64`;
      }
    } else if (!locationName) {
      locationName = 'Direct Message';
    }
  }

  if (!locationName && guildId) locationName = 'Discord Server';

  const value: ActivityLocationContext = {
    instanceId: id || null,
    guildId,
    channelId,
    locationKind,
    locationName,
    locationIconUrl,
  };
  locationCache.set(cacheKey, { at: Date.now(), value });
  return value;
}
