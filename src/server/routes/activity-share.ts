import type { FastifyPluginAsync } from 'fastify';
import type { AppEnv } from '../env.js';
import { createShare } from '../pishock/client.js';
import {
  ABS_MAX_DURATION_MS,
  ABS_MAX_INTENSITY,
  ABS_MIN_DURATION_MS,
  resolveDeviceCeilingsFromPiShock,
} from '../operate-policy.js';
import {
  getPersonalActivityLimits,
  listActivityBans,
  listActivityShares,
  replaceActivityBans,
  replaceActivityShares,
  setPersonalActivityLimits,
} from '../session.js';
import { broadcastRealtimeAll } from '../realtime.js';

type IncomingShare = {
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
};

type ExistingShare = Awaited<ReturnType<typeof listActivityShares>>[number];

async function normalizeShareRow(
  s: IncomingShare,
  prev: ExistingShare | undefined,
  creds: NonNullable<import('../pishock/client.js').PiShockCreds>,
): Promise<
  | { ok: true; row: Parameters<typeof replaceActivityShares>[1][number] }
  | { ok: false; error: string }
> {
  const shockerId = Number(s.shockerId);
  if (!Number.isFinite(shockerId) || shockerId <= 0) {
    return { ok: false, error: 'Each share requires a valid shockerId' };
  }

  const ceilings = await resolveDeviceCeilingsFromPiShock(creds, shockerId);
  const deviceMaxIntensity = ceilings.found
    ? ceilings.deviceMaxIntensity
    : Math.max(
        1,
        Math.min(ABS_MAX_INTENSITY, Number(prev?.deviceMaxIntensity ?? ABS_MAX_INTENSITY)),
      );
  const deviceMaxDurationMs = ceilings.found
    ? ceilings.deviceMaxDurationMs
    : Math.max(
        ABS_MIN_DURATION_MS,
        Math.min(ABS_MAX_DURATION_MS, Number(prev?.deviceMaxDurationMs ?? ABS_MAX_DURATION_MS)),
      );
  // Prefer live PiShock hub id; fall back to previously stored value only
  const hubClientId = ceilings.hubClientId ?? prev?.hubClientId ?? null;

  const canShock = s.canShock !== false;
  const canVibrate = s.canVibrate !== false;
  const canBeep = s.canBeep !== false;
  const canHold = s.canHold !== false;

  const maxIntensity = Math.max(
    1,
    Math.min(deviceMaxIntensity, Number(s.maxIntensity ?? prev?.maxIntensity ?? deviceMaxIntensity)),
  );
  const maxDurationMs = Math.max(
    ABS_MIN_DURATION_MS,
    Math.min(
      deviceMaxDurationMs,
      Number(s.maxDurationMs ?? prev?.maxDurationMs ?? deviceMaxDurationMs),
    ),
  );

  // Never accept a client-supplied share code — only keep prior server-created codes
  let shareCode = prev?.shareCode ?? null;
  const capsChanged =
    !shareCode ||
    (prev != null &&
      (prev.maxIntensity !== maxIntensity ||
        prev.maxDurationMs !== maxDurationMs ||
        prev.canShock !== canShock ||
        prev.canVibrate !== canVibrate ||
        prev.canBeep !== canBeep));

  if (!shareCode || capsChanged) {
    try {
      const created = await createShare(creds, {
        ShockerId: shockerId,
        MaxIntensity: maxIntensity,
        MaxDuration: Math.max(1, Math.min(15, Math.round(maxDurationMs / 1000))),
        CanShock: canShock,
        CanVibrate: canVibrate,
        CanBeep: canBeep,
      });
      const nextCode = extractShareCode(created.data);
      if (nextCode) shareCode = nextCode;
    } catch {
      // Fall back to target-session OperateById when share creation fails
    }
  }

  return {
    ok: true,
    row: {
      shockerId,
      shockerName: String(s.shockerName || prev?.shockerName || `Shocker ${shockerId}`).slice(0, 120),
      hubClientId,
      shareCode,
      deviceMaxIntensity,
      deviceMaxDurationMs,
      enabled: s.enabled !== false,
      paused: Boolean(s.paused),
      maxIntensity,
      maxDurationMs,
      canShock,
      canVibrate,
      canBeep,
      canHold,
    },
  };
}

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
      shares?: IncomingShare[];
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
        const result = await normalizeShareRow(s, existingByShocker.get(Number(s.shockerId)), req.pishockCreds);
        if (!result.ok) {
          return reply.code(400).send({ error: result.error });
        }
        normalized.push(result.row);
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
      shares?: IncomingShare[];
      bannedDiscordUserIds?: string[];
    };

    const existing = await listActivityShares(req.discordUser.id);
    const existingByShocker = new Map(existing.map((s) => [s.shockerId, s]));

    const incoming = Array.isArray(body.shares) ? body.shares : [];
    const normalized = [];
    for (const s of incoming) {
      const result = await normalizeShareRow(s, existingByShocker.get(Number(s.shockerId)), req.pishockCreds);
      if (!result.ok) {
        return reply.code(400).send({ error: result.error });
      }
      normalized.push(result.row);
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
