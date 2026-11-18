import type { AppEnv } from './env.js';
import { verifyActivityInstance } from './discord-instance.js';
import type { LogViewer } from './log-privacy.js';

/**
 * Resolve where a log viewer currently is, for "same server / same channel" log scopes.
 *
 * The instance is verified with Discord (the viewer must be a participant), so a
 * client cannot claim someone else's channel just by sending its instance id.
 * Results are cached briefly because the PIP view polls logs every few seconds.
 */
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; guildId: string | null; channelId: string | null }>();

export async function resolveLogViewer(
  env: AppEnv,
  viewerId: string,
  instanceId: string | null | undefined,
): Promise<LogViewer> {
  const id = typeof instanceId === 'string' ? instanceId.trim() : '';
  if (!id || id.length > 128) return { id: viewerId, guildId: null, channelId: null };

  const key = `${viewerId}:${id}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { id: viewerId, guildId: hit.guildId, channelId: hit.channelId };
  }

  let guildId: string | null = null;
  let channelId: string | null = null;
  try {
    const info = await verifyActivityInstance(env, id, {
      requireUserId: viewerId,
      allowMissingBot: true,
    });
    guildId = info?.location?.guild_id ? String(info.location.guild_id) : null;
    channelId = info?.location?.channel_id ? String(info.location.channel_id) : null;
  } catch {
    // Unknown / unverifiable location: scoped rows simply stay hidden for this viewer.
  }

  if (cache.size > 5_000) cache.clear();
  cache.set(key, { at: Date.now(), guildId, channelId });
  return { id: viewerId, guildId, channelId };
}
