import type { RelayCredentials } from './relay.js';

export type PendingPiShockConfirm = {
  userId: number;
  token: string;
  createdAt: number;
  hubNames: string[];
};

const pendingConfirmByDiscordUser = new Map<string, PendingPiShockConfirm>();

export const CONFIRM_TTL_MS = 10 * 60 * 1000;

export function setPendingConfirm(
  discordUserId: string,
  creds: RelayCredentials,
  hubNames: string[] = [],
) {
  pendingConfirmByDiscordUser.set(discordUserId, {
    userId: creds.UserId,
    token: creds.Token,
    createdAt: Date.now(),
    hubNames,
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
