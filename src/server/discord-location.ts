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

/**
 * Resolve a human-readable Discord location (guild or DM/group) for an activity instance.
 */
export async function resolveActivityLocation(
  env: AppEnv,
  instanceId: string | null | undefined,
  prefetched?: ActivityInstanceInfo | null,
): Promise<ActivityLocationContext> {
  const id = instanceId ? String(instanceId).trim() : '';
  if (!id) return { ...EMPTY };

  const cached = locationCache.get(id);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }

  let instance = prefetched ?? null;
  if (!instance) {
    try {
      instance = await verifyActivityInstance(env, id, {
        allowMissingBot: true,
      });
    } catch {
      instance = null;
    }
  }

  const location = instance?.location;
  const guildId = location?.guild_id ? String(location.guild_id) : null;
  const channelId = location?.channel_id ? String(location.channel_id) : null;
  const locationKind = location?.kind ? String(location.kind) : guildId ? 'gc' : null;

  let locationName: string | null = null;
  let locationIconUrl: string | null = null;

  if (guildId) {
    const guild = await botGetJson(env, `/guilds/${encodeURIComponent(guildId)}`);
    if (guild) {
      locationName = guild.name != null ? String(guild.name) : null;
      locationIconUrl = guildIconUrl(guildId, guild.icon != null ? String(guild.icon) : null);
    }
    if (!locationName) locationName = 'Discord Server';
  } else if (channelId) {
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
      // Group DMs sometimes expose an icon hash
      const icon = channel.icon != null ? String(channel.icon) : null;
      if (icon) {
        locationIconUrl = `https://cdn.discordapp.com/channel-icons/${channelId}/${icon}.png?size=64`;
      }
    } else {
      locationName = 'Direct Message';
    }
  }

  const value: ActivityLocationContext = {
    instanceId: id,
    guildId,
    channelId,
    locationKind,
    locationName,
    locationIconUrl,
  };
  locationCache.set(id, { at: Date.now(), value });
  return value;
}
