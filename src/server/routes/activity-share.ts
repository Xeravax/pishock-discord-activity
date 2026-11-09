import type { FastifyPluginAsync } from 'fastify';
import type { AppEnv } from '../env.js';
import { createShare } from '../pishock/client.js';
import {
  getPersonalActivityLimits,
  listActivityBans,
  listActivityShares,
  replaceActivityBans,
  replaceActivityShares,
  setPersonalActivityLimits,
} from '../session.js';
import { broadcastRealtimeAll } from '../realtime.js';

export const activityShareRoutes: FastifyPluginAsync<{ env: AppEnv }> = async (app) => {
  app.get('/api/activity/share', async (req, reply) => {
    if (!req.hasConsent) {
      return reply.code(403).send({ error: 'Consent required', code: 'CONSENT_REQUIRED' });
    }
    if (!req.pishockCreds) {
      return reply.code(401).send({ error: 'PiShock login required', code: 'PISHOCK_RELOGIN' });
    }
    const [shares, bans, personal] = await Promise.all([
      listActivityShares(req.discordUser.id),
      listActivityBans(req.discordUser.id),
      getPersonalActivityLimits(req.discordUser.id),
    ]);
    return {
      shares: shares.map(serializeShare),
      bannedDiscordUserIds: bans.map((b: { bannedDiscordUserId: string }) => b.bannedDiscordUserId),
      available: shares.some((s: { enabled: boolean; paused: boolean }) => s.enabled && !s.paused),
      personal,
    };
  });

  app.get('/api/activity/settings', async (req, reply) => {
    if (!req.hasConsent) {
      return reply.code(403).send({ error: 'Consent required', code: 'CONSENT_REQUIRED' });
    }
    if (!req.pishockCreds) {
      return reply.code(401).send({ error: 'PiShock login required', code: 'PISHOCK_RELOGIN' });
    }
    const [shares, personal] = await Promise.all([
      listActivityShares(req.discordUser.id),
      getPersonalActivityLimits(req.discordUser.id),
    ]);
    return {
      personal,
      shares: shares.map(serializeShare),
    };
  });

  app.put('/api/activity/settings', async (req, reply) => {
    if (!req.hasConsent) {
      return reply.code(403).send({ error: 'Consent required', code: 'CONSENT_REQUIRED' });
    }
    if (!req.pishockCreds) {
      return reply.code(401).send({ error: 'PiShock login required', code: 'PISHOCK_RELOGIN' });
    }

    const body = req.body as {
      personal?: { activityMaxIntensity?: number; activityMaxDurationMs?: number };
      shares?: Array<{
        shockerId?: number;
        shockerName?: string;
        hubClientId?: string | null;
        shareCode?: string | null;
        deviceMaxIntensity?: number;
        deviceMaxDurationMs?: number;
        enabled?: boolean;
        paused?: boolean;
        maxIntensity?: number;
        maxDurationMs?: number;
        canShock?: boolean;
        canVibrate?: boolean;
        canBeep?: boolean;
        canHold?: boolean;
      }>;
      bannedDiscordUserIds?: string[];
    };

    if (body.personal) {
      await setPersonalActivityLimits(req.discordUser.id, body.personal);
    }

    const existing = await listActivityShares(req.discordUser.id);
    const existingByShocker = new Map(existing.map((s) => [s.shockerId, s]));
    const incoming = Array.isArray(body.shares) ? body.shares : null;

    let shares = existing;
    if (incoming) {
      const normalized = [];
      for (const s of incoming) {
        const shockerId = Number(s.shockerId);
        if (!Number.isFinite(shockerId) || shockerId <= 0) {
          return reply.code(400).send({ error: 'Each share requires a valid shockerId' });
        }
        const prev = existingByShocker.get(shockerId);
        let shareCode = s.shareCode ?? prev?.shareCode ?? null;
        const deviceMaxIntensity = Math.max(
          1,
          Math.min(100, Number(s.deviceMaxIntensity ?? prev?.deviceMaxIntensity ?? 100)),
        );
        const deviceMaxDurationMs = Math.max(
          16,
          Math.min(15_000, Number(s.deviceMaxDurationMs ?? prev?.deviceMaxDurationMs ?? 15_000)),
        );

        if (!shareCode && req.pishockCreds) {
          try {
            const created = await createShare(req.pishockCreds, {
              ShockerId: shockerId,
              MaxIntensity: Math.max(1, Math.min(deviceMaxIntensity, Number(s.maxIntensity ?? deviceMaxIntensity))),
              MaxDuration: Math.max(
                1,
                Math.min(15, Math.round(Number(s.maxDurationMs ?? deviceMaxDurationMs) / 1000)),
              ),
              CanShock: s.canShock !== false,
              CanVibrate: s.canVibrate !== false,
              CanBeep: s.canBeep !== false,
            });
            shareCode = extractShareCode(created.data) ?? shareCode;
          } catch {
            // optional
          }
        }

        normalized.push({
          shockerId,
          shockerName: String(s.shockerName || `Shocker ${shockerId}`).slice(0, 120),
          hubClientId: s.hubClientId != null ? String(s.hubClientId) : null,
          shareCode,
          deviceMaxIntensity,
          deviceMaxDurationMs,
          enabled: s.enabled !== false,
          paused: Boolean(s.paused),
          maxIntensity: s.maxIntensity,
          maxDurationMs: s.maxDurationMs,
          canShock: s.canShock,
          canVibrate: s.canVibrate,
          canBeep: s.canBeep,
          canHold: s.canHold,
        });
      }
      shares = await replaceActivityShares(req.discordUser.id, normalized);
    }

    if (Array.isArray(body.bannedDiscordUserIds)) {
      await replaceActivityBans(
        req.discordUser.id,
        body.bannedDiscordUserIds.map(String).filter((id) => id && id !== req.discordUser.id),
      );
    }

    const personal = await getPersonalActivityLimits(req.discordUser.id);
    broadcastRealtimeAll({
      type: 'activity_share_changed',
      ownerDiscordUserId: req.discordUser.id,
      at: Date.now(),
    });
    return {
      personal,
      shares: shares.map(serializeShare),
    };
  });

  app.put('/api/activity/share', async (req, reply) => {
    if (!req.hasConsent) {
      return reply.code(403).send({ error: 'Consent required', code: 'CONSENT_REQUIRED' });
    }
    if (!req.pishockCreds) {
      return reply.code(401).send({ error: 'PiShock login required', code: 'PISHOCK_RELOGIN' });
    }

    const body = req.body as {
      shares?: Array<{
        shockerId?: number;
        shockerName?: string;
        hubClientId?: string | null;
        shareCode?: string | null;
        deviceMaxIntensity?: number;
        deviceMaxDurationMs?: number;
        enabled?: boolean;
        paused?: boolean;
        maxIntensity?: number;
        maxDurationMs?: number;
        canShock?: boolean;
        canVibrate?: boolean;
        canBeep?: boolean;
        canHold?: boolean;
      }>;
      bannedDiscordUserIds?: string[];
    };

    const existing = await listActivityShares(req.discordUser.id);
    const existingByShocker = new Map(existing.map((s) => [s.shockerId, s]));

    const incoming = Array.isArray(body.shares) ? body.shares : [];
    const normalized = [];
    for (const s of incoming) {
      const shockerId = Number(s.shockerId);
      if (!Number.isFinite(shockerId) || shockerId <= 0) {
        return reply.code(400).send({ error: 'Each share requires a valid shockerId' });
      }
      const prev = existingByShocker.get(shockerId);
      let shareCode = s.shareCode ?? prev?.shareCode ?? null;
      const deviceMaxIntensity = Math.max(
        1,
        Math.min(100, Number(s.deviceMaxIntensity ?? prev?.deviceMaxIntensity ?? 100)),
      );
      const deviceMaxDurationMs = Math.max(
        16,
        Math.min(15_000, Number(s.deviceMaxDurationMs ?? prev?.deviceMaxDurationMs ?? 15_000)),
      );

      if (!shareCode && req.pishockCreds) {
        try {
          const created = await createShare(req.pishockCreds, {
            ShockerId: shockerId,
            MaxIntensity: Math.max(1, Math.min(deviceMaxIntensity, Number(s.maxIntensity ?? deviceMaxIntensity))),
            MaxDuration: Math.max(
              1,
              Math.min(15, Math.round(Number(s.maxDurationMs ?? deviceMaxDurationMs) / 1000)),
            ),
            CanShock: s.canShock !== false,
            CanVibrate: s.canVibrate !== false,
            CanBeep: s.canBeep !== false,
          });
          shareCode = extractShareCode(created.data) ?? shareCode;
        } catch {
          // Fall back to target-session OperateById path when share creation fails
        }
      }

      normalized.push({
        shockerId,
        shockerName: String(s.shockerName || `Shocker ${shockerId}`).slice(0, 120),
        hubClientId: s.hubClientId != null ? String(s.hubClientId) : null,
        shareCode,
        deviceMaxIntensity,
        deviceMaxDurationMs,
        enabled: s.enabled !== false,
        paused: Boolean(s.paused),
        maxIntensity: s.maxIntensity,
        maxDurationMs: s.maxDurationMs,
        canShock: s.canShock,
        canVibrate: s.canVibrate,
        canBeep: s.canBeep,
        canHold: s.canHold,
      });
    }

    const shares = await replaceActivityShares(req.discordUser.id, normalized);
    let bans = await listActivityBans(req.discordUser.id);
    if (Array.isArray(body.bannedDiscordUserIds)) {
      bans = await replaceActivityBans(
        req.discordUser.id,
        body.bannedDiscordUserIds.map(String).filter((id) => id && id !== req.discordUser.id),
      );
    }

    broadcastRealtimeAll({
      type: 'activity_share_changed',
      ownerDiscordUserId: req.discordUser.id,
      at: Date.now(),
    });
    return {
      shares: shares.map(serializeShare),
      bannedDiscordUserIds: bans.map((b: { bannedDiscordUserId: string }) => b.bannedDiscordUserId),
      available: shares.some((s: { enabled: boolean; paused: boolean }) => s.enabled && !s.paused),
    };
  });
};

function extractShareCode(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  const direct = row.ShareCode ?? row.shareCode ?? row.Code ?? row.code;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = extractShareCode(item);
      if (found) return found;
    }
  }
  return null;
}

function serializeShare(s: {
  shockerId: number;
  shockerName: string;
  hubClientId: string | null;
  shareCode: string | null;
  deviceMaxIntensity: number;
  deviceMaxDurationMs: number;
  enabled: boolean;
  paused: boolean;
  maxIntensity: number;
  maxDurationMs: number;
  canShock: boolean;
  canVibrate: boolean;
  canBeep: boolean;
  canHold: boolean;
}) {
  return {
    shockerId: s.shockerId,
    shockerName: s.shockerName,
    hubClientId: s.hubClientId,
    hasShareCode: Boolean(s.shareCode),
    deviceMaxIntensity: s.deviceMaxIntensity,
    deviceMaxDurationMs: s.deviceMaxDurationMs,
    enabled: s.enabled,
    paused: s.paused,
    maxIntensity: s.maxIntensity,
    maxDurationMs: s.maxDurationMs,
    canShock: s.canShock,
    canVibrate: s.canVibrate,
    canBeep: s.canBeep,
    canHold: s.canHold,
  };
}
