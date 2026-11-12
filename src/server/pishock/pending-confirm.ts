import type { RelayCredentials } from './relay.js';

export type CreatedApiKeyDraft = {
  apiKey: string;
  apiKeyId: number | null;
  expiry: Date | null;
  name: string | null;
};

export type PendingPiShockConfirm = {
  userId: number;
  /** Short-lived website session token — never persisted. */
  token: string;
  username: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  createdAt: number;
  hubNames: string[];
  /** Key already minted for this confirm. Retries must reuse it. */
  createdApiKey: string | null;
  createdApiKeyId: number | null;
  createdExpiry: Date | null;
  createdApiKeyName: string | null;
};

const pendingConfirmByDiscordUser = new Map<string, PendingPiShockConfirm>();

type ConfirmFlight = {
  /** Identifies this attempt. finishConfirmAttempt clears the flag only for this attempt. */
  attempt: number;
  /** Cleared by cancel and manual link so a late save or restore no longer owns the confirm. */
  ownerGeneration: number | null;
  pending: PendingPiShockConfirm;
};

const confirmFlights = new Map<string, ConfirmFlight>();
let confirmGenerationSeq = 0;

export const CONFIRM_TTL_MS = 10 * 60 * 1000;

function writePendingConfirm(
  discordUserId: string,
  creds: RelayCredentials,
  hubNames: string[],
  profile: { username: string; avatarUrl?: string | null; bannerUrl?: string | null },
  created: CreatedApiKeyDraft | null | undefined,
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
            name: prev.createdApiKeyName,
          }
        : null
      : created;
  pendingConfirmByDiscordUser.set(discordUserId, {
    userId: creds.UserId,
    token: creds.Token,
    username: profile.username,
    avatarUrl: profile.avatarUrl ?? (sameUser ? prev?.avatarUrl ?? null : null),
    bannerUrl: profile.bannerUrl ?? (sameUser ? prev?.bannerUrl ?? null : null),
    createdAt: Date.now(),
    hubNames,
    createdApiKey: drafted?.apiKey ?? null,
    createdApiKeyId: drafted?.apiKeyId ?? null,
    createdExpiry: drafted?.expiry ?? null,
    createdApiKeyName: drafted?.name ?? null,
  });
}

export function setPendingConfirm(
  discordUserId: string,
  creds: RelayCredentials,
  hubNames: string[] = [],
  profile: string | { username: string; avatarUrl?: string | null; bannerUrl?: string | null } = '',
  created?: CreatedApiKeyDraft | null,
) {
  if (confirmFlights.has(discordUserId)) return;
  const normalized =
    typeof profile === 'string'
      ? { username: profile, avatarUrl: null, bannerUrl: null }
      : profile;
  writePendingConfirm(discordUserId, creds, hubNames, normalized, created);
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
  const flight = confirmFlights.get(discordUserId);
  if (flight) flight.ownerGeneration = null;
}

export function isConfirmInFlight(discordUserId: string): boolean {
  return confirmFlights.has(discordUserId);
}

export function getConfirmFlight(discordUserId: string): PendingPiShockConfirm | null {
  const flight = confirmFlights.get(discordUserId);
  if (!flight || flight.ownerGeneration == null) return null;
  return flight.pending;
}

/**
 * Take the pending row and own it for this attempt.
 * A second call while createApiKey is still running returns 'busy'.
 */
export function beginConfirmAttempt(
  discordUserId: string,
): (PendingPiShockConfirm & { generation: number }) | 'busy' | null {
  if (confirmFlights.has(discordUserId)) return 'busy';
  const row = getPendingConfirm(discordUserId);
  if (!row) return null;
  pendingConfirmByDiscordUser.delete(discordUserId);
  const generation = ++confirmGenerationSeq;
  confirmFlights.set(discordUserId, {
    attempt: generation,
    ownerGeneration: generation,
    pending: row,
  });
  return { ...row, generation };
}

export function confirmAttemptOwns(discordUserId: string, generation: number): boolean {
  return confirmFlights.get(discordUserId)?.ownerGeneration === generation;
}

/** Put the pending row back only when this attempt still owns the confirm. */
export function restoreOwnedPendingConfirm(
  discordUserId: string,
  generation: number,
  creds: RelayCredentials,
  hubNames: string[],
  profile: string | { username: string; avatarUrl?: string | null; bannerUrl?: string | null },
  created: CreatedApiKeyDraft | null,
): boolean {
  if (!confirmAttemptOwns(discordUserId, generation)) return false;
  const normalized =
    typeof profile === 'string'
      ? { username: profile, avatarUrl: null, bannerUrl: null }
      : profile;
  writePendingConfirm(discordUserId, creds, hubNames, normalized, created);
  const flight = confirmFlights.get(discordUserId);
  const written = pendingConfirmByDiscordUser.get(discordUserId);
  if (flight && written) flight.pending = written;
  return true;
}

export function finishConfirmAttempt(discordUserId: string, generation: number) {
  const flight = confirmFlights.get(discordUserId);
  if (flight?.attempt === generation) confirmFlights.delete(discordUserId);
}
