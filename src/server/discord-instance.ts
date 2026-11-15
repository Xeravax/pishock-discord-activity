import type { AppEnv } from './env.js';

export type ActivityInstanceInfo = {
  application_id: string;
  instance_id: string;
  launch_id?: string;
  users: string[];
  location?: {
    id?: string;
    kind?: string;
    channel_id?: string;
    guild_id?: string;
  };
};

export class InstanceAuthError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

/**
 * Verify a Discord Activity instance is live and (optionally) that users are in it.
 * Requires DISCORD_BOT_TOKEN. Missing-bot bypass is only allowed when env.allowMissingBotInstanceCheck.
 */
export async function verifyActivityInstance(
  env: AppEnv,
  instanceId: string,
  opts?: {
    requireUserId?: string;
    /** Additional Discord user ids that must also be present in the instance. */
    requireUserIds?: string[];
    allowMissingBot?: boolean;
  },
): Promise<ActivityInstanceInfo | null> {
  if (!instanceId || typeof instanceId !== 'string') {
    throw new InstanceAuthError('Missing activity instanceId', 400);
  }

  const allowMissingBot = Boolean(opts?.allowMissingBot && env.allowMissingBotInstanceCheck);
  if (!env.discordBotToken) {
    if (allowMissingBot) return null;
    throw new InstanceAuthError(
      'DISCORD_BOT_TOKEN is required for Discord participant actions',
      503,
    );
  }

  const url = `https://discord.com/api/v10/applications/${env.discordClientId}/activity-instances/${encodeURIComponent(instanceId)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bot ${env.discordBotToken}` },
  });

  if (res.status === 404) {
    throw new InstanceAuthError('Activity instance is not active', 403);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new InstanceAuthError(`Activity instance check failed: ${res.status} ${text}`, 502);
  }

  const data = (await res.json()) as ActivityInstanceInfo;
  const users = Array.isArray(data.users) ? data.users.map(String) : [];
  data.users = users;

  if (opts?.requireUserId && !users.includes(opts.requireUserId)) {
    throw new InstanceAuthError('You are not a participant in this activity instance', 403);
  }

  for (const uid of opts?.requireUserIds ?? []) {
    if (!users.includes(uid)) {
      throw new InstanceAuthError(
        'Target is not a participant in this activity instance',
        403,
      );
    }
  }

  return data;
}
