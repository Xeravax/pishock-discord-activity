/**
 * Bot DMs and community-server join. A bot can only DM someone who shares a server with
 * it (or allows DMs from the app) — otherwise Discord answers 50007 and the recap stays
 * in-app only, with an offer to join the community server via OAuth `guilds.join`.
 */
const API = 'https://discord.com/api/v10';

export type DmResult = 'sent' | 'failed';

export async function sendDirectMessage(
  botToken: string | null,
  recipientId: string,
  message: { content?: string; embeds?: unknown[] },
): Promise<DmResult> {
  if (!botToken) return 'failed';
  const headers = { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' };
  try {
    const ch = await fetch(`${API}/users/@me/channels`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ recipient_id: recipientId }),
    });
    if (!ch.ok) return 'failed';
    const { id } = (await ch.json()) as { id?: string };
    if (!id) return 'failed';
    const res = await fetch(`${API}/channels/${id}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...message, allowed_mentions: { parse: [] } }),
    });
    return res.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}

export class CommunityJoinError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

/**
 * Exchange an OAuth code that carries `guilds.join` (the user just approved it) and add
 * them to the community guild. The access token is used once and never stored.
 */
export async function joinCommunityGuild(input: {
  clientId: string;
  clientSecret: string;
  botToken: string | null;
  guildId: string;
  code: string;
  expectedUserId: string;
}): Promise<'joined' | 'already'> {
  if (!input.botToken) throw new CommunityJoinError('Bot is not configured', 503, 'BOT_MISSING');
  const tokenRes = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      grant_type: 'authorization_code',
      code: input.code,
    }),
  });
  if (!tokenRes.ok) throw new CommunityJoinError('Discord did not accept the approval', 400, 'OAUTH_FAILED');
  const token = (await tokenRes.json()) as { access_token?: string; scope?: string };
  if (!token.access_token || !String(token.scope ?? '').split(' ').includes('guilds.join')) {
    throw new CommunityJoinError('Joining the server was not approved', 400, 'SCOPE_MISSING');
  }
  const me = await fetch(`${API}/users/@me`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  const user = me.ok ? ((await me.json()) as { id?: string }) : null;
  if (!user?.id || user.id !== input.expectedUserId) {
    throw new CommunityJoinError('That approval belongs to a different account', 403, 'USER_MISMATCH');
  }
  const put = await fetch(`${API}/guilds/${input.guildId}/members/${user.id}`, {
    method: 'PUT',
    headers: { Authorization: `Bot ${input.botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: token.access_token }),
  });
  if (put.status === 201) return 'joined';
  if (put.status === 204) return 'already';
  throw new CommunityJoinError('Could not add you to the server', 502, 'JOIN_FAILED');
}
