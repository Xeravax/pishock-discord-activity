import type { RelayCredentials } from './relay.js';

export type CreatedApiKeyDraft = {
  apiKey: string;
  apiKeyId: number | null;
  expiry: Date | null;
};

export type PendingPiShockConfirm = {
  userId: number;
  /** Short-lived website session token — never persisted. */
  token: string;
  username: string;
  createdAt: number;
  hubNames: string[];
  /** Key already minted for this confirm. Retries must reuse it. */
  createdApiKey: string | null;
  createdApiKeyId: number | null;
  createdExpiry: Date | null;
};

const pendingConfirmByDiscordUser = new Map<string, PendingPiShockConfirm>();

export const CONFIRM_TTL_MS = 10 * 60 * 1000;

export function setPendingConfirm(
  discordUserId: string,
  creds: RelayCredentials,
  hubNames: string[] = [],
  username = '',
  created?: CreatedApiKeyDraft | null,
) {
  const prev = pendingConfirmByDiscordUser.get(discordUserId);
  const sameUser = prev != null && prev.userId === creds.UserId;
  const drafted =
    created === undefined
      ? sameUser && prev?.createdApiKey
        ? {
            apiKey: prev.createdApiKey,
            apiKeyId: prev.createdApiKeyId,
            expiry: prev.createdExpiry,
          }
        : null
      : created;
  pendingConfirmByDiscordUser.set(discordUserId, {
    userId: creds.UserId,
    token: creds.Token,
    username,
    createdAt: Date.now(),
    hubNames,
    createdApiKey: drafted?.apiKey ?? null,
    createdApiKeyId: drafted?.apiKeyId ?? null,
    createdExpiry: drafted?.expiry ?? null,
  });
}

export function getPendingConfirm(discordUserId: string): PendingPiShockConfirm | null {
  const row = pendingConfirmByDiscordUser.get(discordUserId);
  if (!row) return null;
  if (Date.now() - row.createdAt > CONFIRM_TTL_MS) {
    pendingConfirmByDiscordUser.delete(discordUserId);
    return null;
  }
  return row;
}

export function takePendingConfirm(discordUserId: string): PendingPiShockConfirm | null {
  const row = getPendingConfirm(discordUserId);
  if (!row) return null;
  pendingConfirmByDiscordUser.delete(discordUserId);
  return row;
}

export function clearPendingConfirm(discordUserId: string) {
  pendingConfirmByDiscordUser.delete(discordUserId);
}
