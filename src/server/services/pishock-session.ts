import { prisma } from '../db.js';
import { decryptToken, encryptToken, hashApiKey } from '../crypto.js';
import { type AppEnv } from '../env.js';
import {
  allowPiShockApiKey,
  invalidateControlSnapshot,
  isPiShockApiKeyRejected,
  onPiShockApiKeyRejected,
  type PiShockCreds,
} from '../pishock/client.js';
import { disconnectBroker, disconnectBrokerSessionsForToken } from '../pishock/broker.js';
import { deleteStoredProfileImages } from '../pishock/profile-images.js';

export async function savePiShockSession(
  env: AppEnv,
  discordUserId: string,
  input: {
    userId: number;
    username: string;
    apiKey: string;
    /** Soft hint only — null means keep until PiShock rejects the key. */
    expiresAt?: Date | null;
    apiKeyId?: number | null;
  },
) {
  const enc = encryptToken(env.tokenKey, input.apiKey);
  const apiKeyHash = hashApiKey(input.apiKey);
  allowPiShockApiKey(input.apiKey);
  const displaced = await prisma.$transaction(async (tx) => {
    const conflicts = await tx.piShockSession.findMany({
      where: {
        discordUserId: { not: discordUserId },
        OR: [{ pishockUserId: input.userId }, { apiKeyHash }],
      },
      select: { discordUserId: true },
    });
    if (conflicts.length > 0) {
      await tx.piShockSession.deleteMany({
        where: { discordUserId: { in: conflicts.map((row) => row.discordUserId) } },
      });
    }
    await tx.piShockSession.upsert({
      where: { discordUserId },
      create: {
        discordUserId,
        pishockUserId: input.userId,
        pishockUsername: input.username,
        encryptedToken: enc.encryptedToken,
        tokenIv: enc.tokenIv,
        tokenAuthTag: enc.tokenAuthTag,
        expiresAt: input.expiresAt ?? null,
        apiKeyId: input.apiKeyId ?? null,
        apiKeyHash,
      },
      update: {
        pishockUserId: input.userId,
        pishockUsername: input.username,
        encryptedToken: enc.encryptedToken,
        tokenIv: enc.tokenIv,
        tokenAuthTag: enc.tokenAuthTag,
        expiresAt: input.expiresAt ?? null,
        apiKeyId: input.apiKeyId ?? null,
        apiKeyHash,
      },
    });
    return conflicts.map((row) => row.discordUserId);
  });
  for (const otherId of displaced) {
    console.warn(
      `[pishock] unlinked ${otherId} because PiShock account ${input.userId} was linked elsewhere`,
    );
    disconnectBroker(otherId);
  }
}

export async function loadPiShockCreds(
  env: AppEnv,
  discordUserId: string,
): Promise<PiShockCreds | null> {
  const row = await prisma.piShockSession.findUnique({ where: { discordUserId } });
  if (!row) return null;
  // No clock wipe — keys stay until PiShock rejects them (401 → clearPiShockSession).
  const token = decryptToken(env.tokenKey, row.encryptedToken, row.tokenIv, row.tokenAuthTag);
  if (isPiShockApiKeyRejected(token)) {
    // Compare-and-delete so a replacement key linked meanwhile is preserved.
    const deleted = await prisma.piShockSession.deleteMany({
      where: {
        discordUserId,
        encryptedToken: row.encryptedToken,
        tokenIv: row.tokenIv,
        tokenAuthTag: row.tokenAuthTag,
      },
    });
    if (deleted.count > 0) disconnectBroker(discordUserId);
    return null;
  }
  const apiKeyHash = hashApiKey(token);
  if (row.apiKeyHash !== apiKeyHash) {
    const displaced = await prisma.piShockSession.findMany({
      where: { apiKeyHash, discordUserId: { not: discordUserId } },
      select: { discordUserId: true },
    });
    if (displaced.length > 0) {
      // Re-check the hash: a row relinked to a different key meanwhile must survive.
      await prisma.piShockSession.deleteMany({
        where: {
          apiKeyHash,
          discordUserId: { in: displaced.map((other) => other.discordUserId) },
        },
      });
      for (const other of displaced) disconnectBroker(other.discordUserId);
    }
    // Only stamp the hash if this ciphertext is still the stored session.
    await prisma.piShockSession.updateMany({
      where: {
        discordUserId,
        encryptedToken: row.encryptedToken,
        tokenIv: row.tokenIv,
        tokenAuthTag: row.tokenAuthTag,
        OR: [{ apiKeyHash: null }, { apiKeyHash: { not: apiKeyHash } }],
      },
      data: { apiKeyHash },
    });
  }
  return {
    userId: row.pishockUserId,
    username: row.pishockUsername,
    token,
  };
}

export async function clearPiShockSession(discordUserId: string) {
  const row = await prisma.piShockSession.findUnique({
    where: { discordUserId },
    select: { pishockUserId: true },
  });
  if (row) invalidateControlSnapshot(row.pishockUserId);
  disconnectBroker(discordUserId);
  await prisma.piShockSession.deleteMany({ where: { discordUserId } });
  if (row) {
    const stillLinked = await prisma.piShockSession.findFirst({
      where: { pishockUserId: row.pishockUserId },
      select: { id: true },
    });
    if (!stillLinked) {
      await deleteStoredProfileImages(row.pishockUserId);
    }
  }
}

let rejectionHandlerInstalled = false;

/** Drop stored keys and broker sockets after PiShock confirms a 401. */
export function installPiShockKeyRejectionHandler(env: AppEnv) {
  if (rejectionHandlerInstalled) return;
  rejectionHandlerInstalled = true;
  onPiShockApiKeyRejected((token) => {
    disconnectBrokerSessionsForToken(token);
    void purgePiShockSessionsForRejectedKey(env, token).catch((err) => {
      console.warn(
        '[pishock] failed to clear rejected API key session',
        err instanceof Error ? err.message : err,
      );
    });
  });
}

async function deleteRejectedKeySession(
  discordUserId: string,
  pishockUserId: number,
  where: {
    apiKeyHash: string | null;
    encryptedToken?: string;
    tokenIv?: string;
    tokenAuthTag?: string;
  },
) {
  const removed = await prisma.piShockSession.deleteMany({
    where: { discordUserId, ...where },
  });
  if (removed.count < 1) return;
  console.warn(`[pishock] clearing session for ${discordUserId} after API key 401`);
  disconnectBroker(discordUserId);
  const stillLinked = await prisma.piShockSession.findFirst({
    where: { pishockUserId },
    select: { id: true },
  });
  if (!stillLinked) await deleteStoredProfileImages(pishockUserId);
}

async function purgePiShockSessionsForRejectedKey(env: AppEnv, token: string) {
  const hash = hashApiKey(token);
  const rows = await prisma.piShockSession.findMany({
    where: { OR: [{ apiKeyHash: hash }, { apiKeyHash: null }] },
    select: {
      discordUserId: true,
      pishockUserId: true,
      encryptedToken: true,
      tokenIv: true,
      tokenAuthTag: true,
      apiKeyHash: true,
    },
  });
  for (const row of rows) {
    if (row.apiKeyHash === hash) {
      await deleteRejectedKeySession(row.discordUserId, row.pishockUserId, { apiKeyHash: hash });
      continue;
    }
    let stored = '';
    try {
      stored = decryptToken(env.tokenKey, row.encryptedToken, row.tokenIv, row.tokenAuthTag);
    } catch {
      continue;
    }
    if (stored === token) {
      await deleteRejectedKeySession(row.discordUserId, row.pishockUserId, {
        apiKeyHash: null,
        encryptedToken: row.encryptedToken,
        tokenIv: row.tokenIv,
        tokenAuthTag: row.tokenAuthTag,
      });
      continue;
    }
    await prisma.piShockSession
      .updateMany({
        where: {
          discordUserId: row.discordUserId,
          apiKeyHash: null,
          encryptedToken: row.encryptedToken,
          tokenIv: row.tokenIv,
          tokenAuthTag: row.tokenAuthTag,
        },
        data: { apiKeyHash: hashApiKey(stored) },
      })
      .catch(() => {
        // Another row already owns this hash.
      });
  }
}
