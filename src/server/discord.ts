import type { AppEnv } from './env.js';
import { prisma } from './db.js';

export type DiscordUserInfo = {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
};

type CacheEntry = { user: DiscordUserInfo; expiresAt: number };
const tokenCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

export async function exchangeDiscordCode(env: AppEnv, code: string) {
  const body = new URLSearchParams({
    client_id: env.discordClientId,
    client_secret: env.discordClientSecret,
    grant_type: 'authorization_code',
    code,
  });

  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new DiscordAuthError(`Discord token exchange failed: ${tokenRes.status} ${text}`, 502);
  }

  const tokenData = (await tokenRes.json()) as {
    access_token: string;
    token_type: string;
    expires_in: number;
  };

  const user = await fetchDiscordUser(tokenData.access_token);
  await upsertDiscordUser(user);

  return {
    access_token: tokenData.access_token,
    token_type: tokenData.token_type,
    expires_in: tokenData.expires_in,
    user,
  };
}

export async function resolveBearerUser(accessToken: string): Promise<DiscordUserInfo> {
  const cached = tokenCache.get(accessToken);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  const user = await fetchDiscordUser(accessToken);
  await upsertDiscordUser(user);
  tokenCache.set(accessToken, { user, expiresAt: Date.now() + CACHE_TTL_MS });
  return user;
}

async function fetchDiscordUser(accessToken: string): Promise<DiscordUserInfo> {
  const res = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401 || res.status === 403) {
    throw new DiscordAuthError('Discord access token rejected', 401);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new DiscordAuthError(`Discord /users/@me failed: ${res.status} ${text}`, 502);
  }
  return (await res.json()) as DiscordUserInfo;
}

async function upsertDiscordUser(user: DiscordUserInfo) {
  await prisma.discordUser.upsert({
    where: { id: user.id },
    create: {
      id: user.id,
      username: user.username,
      globalName: user.global_name ?? null,
      avatar: user.avatar ?? null,
    },
    update: {
      username: user.username,
      globalName: user.global_name ?? null,
      avatar: user.avatar ?? null,
    },
  });
}

export class DiscordAuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
