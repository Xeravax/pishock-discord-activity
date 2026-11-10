import type { FastifyPluginAsync } from 'fastify';
import { ShockerOp } from '../../shared/constants.js';
import type { AppEnv } from '../env.js';
import {
  PiShockApiError,
  clientOperate,
  claimShareCodes,
  createLink,
  createShare,
  deleteLink,
  deleteShare,
  fetchControlSnapshot,
  operateById,
  operateByShare,
  pauseLink,
  pauseShare,
} from '../pishock/client.js';
import { getOnlineMap, probeOnlineStatus, publishOperate } from '../pishock/broker.js';
import { commandQueue } from '../pishock/command-queue-runtime.js';
import {
  assertModeAllowed,
  assertOperateRateLimit,
  assertWithinCeilings,
  clearHoldAutoEnd,
  clampDurationMs,
  clampIntensity,
  findShockerInSnapshot,
  OperatePolicyError,
  resolveOwnOperatePolicy,
  scheduleHoldAutoEnd,
  verifyOwnedClientId,
} from '../operate-policy.js';
import {
  clearPiShockSession,
  listCommandLogs,
  listPublicCommandLogs,
  logCommand,
  setEmergencyStop,
  syncWebsiteDeviceLogs,
} from '../session.js';
import { broadcastRealtimeAll } from '../realtime.js';
import {
  resolveActivityLocation,
  type ActivityLocationContext,
  type ClientLocationHint,
} from '../discord-location.js';

/** Activity feed row: always attribute to the device owner so the public log can dedupe. */
async function logOperateEvent(input: {
  executorDiscordUserId: string;
  ownerDiscordUserId: string;
  action: string;
  shockerId?: number | null;
  shareCode?: string | null;
  intensity: number;
  durationMs: number;
  success: boolean;
  detail?: string;
  location?: ActivityLocationContext | null;
}) {
  const loc = input.location;
  await logCommand({
    discordUserId: input.ownerDiscordUserId,
    executorDiscordUserId: input.executorDiscordUserId,
    targetDiscordUserId: input.ownerDiscordUserId,
    action: input.action,
    shockerId: input.shockerId ?? undefined,
    shareCode: input.shareCode ?? undefined,
    intensity: input.intensity,
    durationMs: input.durationMs,
    success: input.success,
    detail: input.detail,
    source: 'discord',
    instanceId: loc?.instanceId,
    guildId: loc?.guildId,
    channelId: loc?.channelId,
    locationKind: loc?.locationKind,
    locationName: loc?.locationName,
    locationIconUrl: loc?.locationIconUrl,
  });
}

function requireSession(req: { hasConsent: boolean; pishockCreds: unknown }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
  if (!req.hasConsent) {
    return reply.code(403).send({ error: 'Consent required', code: 'CONSENT_REQUIRED' });
  }
  if (!req.pishockCreds) {
    return reply.code(401).send({ error: 'PiShock login required', code: 'PISHOCK_RELOGIN' });
  }
  return null;
}

async function handlePiShockError(
  err: unknown,
  discordUserId: string,
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
) {
  if (err instanceof PiShockApiError) {
    if (err.needsRelogin) {
      await clearPiShockSession(discordUserId);
      return reply.code(401).send({ error: 'PiShock session expired', code: 'PISHOCK_RELOGIN' });
    }
    return reply.code(err.status).send({ error: err.message, body: err.body });
  }
  throw err;
}

export const controlRoutes: FastifyPluginAsync<{ env: AppEnv }> = async (app, opts) => {
  app.get('/api/devices', async (req, reply) => {
    const blocked = requireSession(req, reply);
    if (blocked) return blocked;
    try {
      const snapshot = await fetchControlSnapshot(req.pishockCreds!);
      return {
        ...snapshot,
        online: getOnlineMap(req.discordUser.id),
      };
    } catch (err) {
      return handlePiShockError(err, req.discordUser.id, reply);
    }
  });

  /**
   * Owner kill-switch latch. Engaged = cut current op + reject all further commands for this
   * shocker (including Discord Shockers) until the owner releases it.
   */
  app.put('/api/emergency-stop', async (req, reply) => {
    const blocked = requireSession(req, reply);
    if (blocked) return blocked;

    const body = req.body as {
      shockerId?: number;
      engaged?: boolean;
      clientId?: number | string;
    };
    const shockerId = Number(body.shockerId);
    if (!Number.isFinite(shockerId) || shockerId <= 0) {
      return reply.code(400).send({ error: 'shockerId required' });
    }
    if (typeof body.engaged !== 'boolean') {
      return reply.code(400).send({ error: 'engaged boolean required' });
    }

    const creds = req.pishockCreds!;
    let snapshot;
    try {
      snapshot = await fetchControlSnapshot(creds);
    } catch (err) {
      return handlePiShockError(err, req.discordUser.id, reply);
    }
    if (!findShockerInSnapshot(snapshot, shockerId)) {
      return reply.code(404).send({ error: 'Shocker not found on this PiShock account' });
    }

    const clientId =
      verifyOwnedClientId(snapshot, body.clientId) ??
      (() => {
        const row = findShockerInSnapshot(snapshot, shockerId);
        return row ? String(row.ClientId ?? row.clientId ?? '') || null : null;
      })();

    if (body.engaged && clientId) {
      clearHoldAutoEnd(req.discordUser.id, shockerId);
      await publishOperate(creds, {
        clientId,
        shockerId,
        operation: 'e',
        intensity: 0,
        durationMs: 0,
        end: true,
        agentName: 'Emergency Stop',
      });
    }

    const result = await setEmergencyStop(req.discordUser.id, shockerId, body.engaged);
    if (body.engaged) {
      // Device already cut above; drop waiting + active queue slots for this wearer.
      await commandQueue.hardClear(req.discordUser.id, { endActiveDevice: false });
    }
    await logCommand({
      discordUserId: req.discordUser.id,
      action: body.engaged ? 'emergency_stop_on' : 'emergency_stop_off',
      shockerId,
      intensity: 0,
      durationMs: 0,
      success: true,
      detail: body.engaged ? 'latched' : 'released',
    });
    broadcastRealtimeAll({
      type: 'emergency_stop',
      ownerDiscordUserId: req.discordUser.id,
      shockerId,
      engaged: result.engaged,
      emergencyStopShockerIds: result.emergencyStopShockerIds,
      at: Date.now(),
    });
    return { ok: true, ...result };
  });

  app.post('/api/operate', async (req, reply) => {
    const blocked = requireSession(req, reply);
    if (blocked) return blocked;

    try {
      assertOperateRateLimit(req.discordUser.id);
    } catch (err) {
      if (err instanceof OperatePolicyError) {
        return reply.code(err.status).send({ error: err.message, code: err.code });
      }
      throw err;
    }

    const body = req.body as {
      shockerId?: number;
      shareCode?: string;
      operation?: 'shock' | 'vibrate' | 'beep' | 'hold' | 'warning' | 'stop' | 'end';
      intensity?: number;
      durationMs?: number;
      // Intentionally ignored for policy — kept only so old clients do not break parsing
      canShock?: boolean;
      canVibrate?: boolean;
      canBeep?: boolean;
      canHold?: boolean;
      maxIntensity?: number;
      maxDuration?: number;
      clientId?: number | string;
      hold?: boolean;
      warning?: { Active: boolean; Min: number; Max: number } | null;
      instanceId?: string;
      locationHint?: ClientLocationHint | null;
    };

    const operation = body.operation;
    if (!operation) {
      return reply.code(400).send({ error: 'Missing operation' });
    }
    if (!body.shockerId && !body.shareCode) {
      return reply.code(400).send({ error: 'Missing shockerId or shareCode' });
    }
    if (operation === 'stop') {
      return reply.code(400).send({
        error: 'Use emergency-stop latch (press in / press out)',
        code: 'USE_EMERGENCY_STOP_LATCH',
      });
    }

    const creds = req.pishockCreds!;
    const location = await resolveActivityLocation(
      opts.env,
      body.instanceId ? String(body.instanceId) : null,
      null,
      body.locationHint ?? null,
    );
    let policy;
    try {
      policy = await resolveOwnOperatePolicy(req.discordUser.id, creds, {
        shockerId: body.shockerId,
        shareCode: body.shareCode,
      });
    } catch (err) {
      if (err instanceof OperatePolicyError) {
        return reply.code(err.status).send({ error: err.message, code: err.code });
      }
      return handlePiShockError(err, req.discordUser.id, reply);
    }

    const shockerId = policy.shockerId ?? (body.shockerId != null ? Number(body.shockerId) : null);
    const shareCode = policy.shareCode;
    // Never trust body.clientId — only the resolved hub from PiShock / ActivityShare
    const clientId = policy.hubClientId;

    // Tap/Remote release: end the in-progress hold without latching emergency stop
    if (operation === 'end') {
      if (shockerId == null || clientId == null) {
        return reply.code(400).send({ error: 'end requires a known shocker and hub client' });
      }
      clearHoldAutoEnd(policy.ownerDiscordUserId, shockerId);
      const published = await publishOperate(creds, {
        clientId,
        shockerId,
        operation: 'e',
        intensity: 0,
        durationMs: 0,
        end: true,
        shareCode: shareCode ?? undefined,
        agentName: 'Tap Release',
      });
      await logOperateEvent({
        executorDiscordUserId: req.discordUser.id,
        ownerDiscordUserId: policy.ownerDiscordUserId,
        action: 'end',
        shockerId,
        shareCode: policy.crossUser ? null : shareCode,
        intensity: 0,
        durationMs: 0,
        success: published,
        detail: published ? 'broker' : 'broker_failed',
        location,
      });
      if (!published) {
        return reply.code(502).send({ error: 'Failed to end hold via broker' });
      }
      return { ok: true, via: 'broker', ended: true };
    }

    const hold = Boolean(body.hold) || operation === 'hold';
    const warning = Boolean(body.warning?.Active) || operation === 'warning';
    try {
      assertModeAllowed(operation, hold, policy.flags);
    } catch (err) {
      if (err instanceof OperatePolicyError) {
        return reply.code(err.status).send({ error: err.message, code: err.code });
      }
      throw err;
    }

    try {
      assertWithinCeilings(
        body.intensity,
        body.durationMs,
        policy.maxIntensity,
        policy.maxDurationMs,
      );
    } catch (err) {
      if (err instanceof OperatePolicyError) {
        return reply.code(err.status).send({ error: err.message });
      }
      throw err;
    }

    const intensity = clampIntensity(body.intensity, policy.maxIntensity);
    const durationMs = clampDurationMs(body.durationMs, policy.maxDurationMs);

    try {
      const op =
        operation === 'shock' || operation === 'hold'
          ? ShockerOp.Shock
          : operation === 'vibrate' || operation === 'warning'
            ? ShockerOp.Vibrate
            : ShockerOp.Beep;

      // Prefer broker for owned V3 devices (same channel emergency stop cancels)
      if (shockerId != null && clientId != null && !shareCode) {
        const published = await publishOperate(creds, {
          clientId,
          shockerId,
          operation: op,
          intensity: Math.max(1, intensity),
          durationMs,
          hold,
          warning,
        });
        if (published) {
          if (hold) {
            scheduleHoldAutoEnd(creds, {
              ownerDiscordUserId: policy.ownerDiscordUserId,
              shockerId,
              clientId,
              durationMs,
              shareCode,
            });
          }
          await logOperateEvent({
            executorDiscordUserId: req.discordUser.id,
            ownerDiscordUserId: policy.ownerDiscordUserId,
            action: operation,
            shockerId,
            shareCode: policy.crossUser ? null : shareCode,
            intensity,
            durationMs,
            success: true,
            detail: 'broker',
            location,
      });
          return { ok: true, via: 'broker' };
        }
      }

      if ((hold || warning) && shockerId != null && clientId != null) {
        const published = await publishOperate(creds, {
          clientId,
          shockerId,
          operation: op,
          intensity: Math.max(1, intensity),
          durationMs,
          hold,
          warning,
          shareCode: shareCode ?? undefined,
        });
        if (published) {
          if (hold) {
            scheduleHoldAutoEnd(creds, {
              ownerDiscordUserId: policy.ownerDiscordUserId,
              shockerId,
              clientId,
              durationMs,
              shareCode,
            });
          }
          await logOperateEvent({
            executorDiscordUserId: req.discordUser.id,
            ownerDiscordUserId: policy.ownerDiscordUserId,
            action: operation,
            shockerId,
            shareCode: policy.crossUser ? null : shareCode,
            intensity,
            durationMs,
            success: true,
            detail: 'broker',
            location,
      });
          return { ok: true, via: 'broker' };
        }
      }

      if (hold || warning) {
        if (shockerId == null) {
          return reply.code(400).send({ error: 'Hold/warning requires shockerId' });
        }
        const result = await clientOperate(creds, {
          ShockerId: shockerId,
          Intensity: Math.max(1, intensity),
          Duration: Math.max(1, Math.round(durationMs / 1000)),
          Op: op,
          Hold: hold,
          Warning: warning,
        });
        if (result.status !== 404 && result.status !== 405) {
          await logOperateEvent({
            executorDiscordUserId: req.discordUser.id,
            ownerDiscordUserId: policy.ownerDiscordUserId,
            action: operation,
            shockerId,
            shareCode: policy.crossUser ? null : shareCode,
            intensity,
            durationMs,
            success: true,
            location,
      });
          return { ok: true, via: 'client-operate' };
        }
      }

      if (shareCode) {
        await operateByShare(creds, shareCode, op, Math.max(1, intensity), durationMs);
      } else {
        await operateById(creds, shockerId!, op, Math.max(1, intensity), durationMs);
      }

      await logOperateEvent({
        executorDiscordUserId: req.discordUser.id,
        ownerDiscordUserId: policy.ownerDiscordUserId,
        action: operation,
        shockerId,
        shareCode: policy.crossUser ? null : shareCode,
        intensity,
        durationMs,
        success: true,
        location,
      });
      return { ok: true };
    } catch (err) {
      await logOperateEvent({
        executorDiscordUserId: req.discordUser.id,
        ownerDiscordUserId: policy.ownerDiscordUserId,
        action: operation,
        shockerId,
        shareCode: policy.crossUser ? null : shareCode,
        intensity,
        durationMs,
        success: false,
        detail: err instanceof Error ? err.message : String(err),
        location,
      });
      return handlePiShockError(err, req.discordUser.id, reply);
    }
  });

  app.post('/api/pause', async (req, reply) => {
    const blocked = requireSession(req, reply);
    if (blocked) return blocked;
    const body = req.body as {
      shareId?: number;
      linkId?: number;
      pauseState?: boolean | null;
    };
    try {
      if (body.shareId != null) {
        const result = await pauseShare(req.pishockCreds!, body.shareId, body.pauseState ?? null);
        if (result.status === 404 || result.status === 405) {
          return reply.code(result.status).send({ error: 'Pause share route unavailable' });
        }
        await logCommand({
          discordUserId: req.discordUser.id,
          action: 'pause_share',
          success: true,
          detail: `shareId=${body.shareId}`,
        });
        return { ok: true };
      }
      if (body.linkId != null) {
        const result = await pauseLink(req.pishockCreds!, body.linkId, body.pauseState ?? null);
        if (result.status === 404 || result.status === 405) {
          return reply.code(result.status).send({ error: 'Pause link route unavailable' });
        }
        await logCommand({
          discordUserId: req.discordUser.id,
          action: 'pause_link',
          success: true,
          detail: `linkId=${body.linkId}`,
        });
        return { ok: true };
      }
      return reply.code(400).send({ error: 'shareId or linkId required' });
    } catch (err) {
      return handlePiShockError(err, req.discordUser.id, reply);
    }
  });

  app.get('/api/links', async (req, reply) => {
    const blocked = requireSession(req, reply);
    if (blocked) return blocked;
    try {
      const snapshot = await fetchControlSnapshot(req.pishockCreds!);
      return { links: snapshot.links };
    } catch (err) {
      return handlePiShockError(err, req.discordUser.id, reply);
    }
  });

  app.post('/api/links', async (req, reply) => {
    const blocked = requireSession(req, reply);
    if (blocked) return blocked;
    try {
      const result = await createLink(req.pishockCreds!, req.body as Record<string, unknown>);
      if (result.status === 404 || result.status === 405) {
        return reply.code(result.status).send({ error: 'Create link unavailable' });
      }
      return { ok: true };
    } catch (err) {
      return handlePiShockError(err, req.discordUser.id, reply);
    }
  });

  app.delete('/api/links/:linkId', async (req, reply) => {
    const blocked = requireSession(req, reply);
    if (blocked) return blocked;
    const linkId = Number((req.params as { linkId: string }).linkId);
    try {
      const result = await deleteLink(req.pishockCreds!, linkId);
      if (result.status === 404 || result.status === 405) {
        return reply.code(result.status).send({ error: 'Delete link unavailable' });
      }
      return { ok: true };
    } catch (err) {
      return handlePiShockError(err, req.discordUser.id, reply);
    }
  });

  app.post('/api/shares', async (req, reply) => {
    const blocked = requireSession(req, reply);
    if (blocked) return blocked;
    try {
      const result = await createShare(req.pishockCreds!, req.body as Record<string, unknown>);
      if (result.status === 404 || result.status === 405) {
        return reply.code(result.status).send({ error: 'Create share unavailable' });
      }
      return { ok: true, data: result.data };
    } catch (err) {
      return handlePiShockError(err, req.discordUser.id, reply);
    }
  });

  /** Redeem someone else's share code into this PiShock account. */
  app.put('/api/shares', async (req, reply) => {
    const blocked = requireSession(req, reply);
    if (blocked) return blocked;
    const body = req.body as { code?: string; ShareCode?: string; Shares?: string[] };
    const codes = Array.isArray(body.Shares)
      ? body.Shares
      : [body.code ?? body.ShareCode ?? '']
          .map((c) => String(c).trim())
          .filter(Boolean);
    if (codes.length === 0) {
      return reply.code(400).send({ error: 'Missing share code' });
    }
    try {
      const result = await claimShareCodes(req.pishockCreds!, codes);
      if (result.status === 404 || result.status === 405) {
        return reply.code(result.status).send({ error: 'Claim share unavailable' });
      }
      return { ok: true, data: result.data };
    } catch (err) {
      if (err instanceof PiShockApiError) {
        if (err.status === 410) {
          return reply.code(410).send({ error: 'Share code already claimed' });
        }
        if (err.status === 412) {
          return reply.code(412).send({ error: 'Invalid or empty share code' });
        }
        if (err.status === 416) {
          return reply.code(416).send({ error: 'Too many share codes' });
        }
      }
      return handlePiShockError(err, req.discordUser.id, reply);
    }
  });

  app.delete('/api/shares/:shareId', async (req, reply) => {
    const blocked = requireSession(req, reply);
    if (blocked) return blocked;
    const shareId = Number((req.params as { shareId: string }).shareId);
    try {
      const result = await deleteShare(req.pishockCreds!, shareId);
      if (result.status === 404 || result.status === 405) {
        return reply.code(result.status).send({ error: 'Delete share unavailable' });
      }
      return { ok: true };
    } catch (err) {
      return handlePiShockError(err, req.discordUser.id, reply);
    }
  });

  app.get('/api/logs', async (req, reply) => {
    if (!req.hasConsent) {
      return reply.code(403).send({ error: 'Consent required', code: 'CONSENT_REQUIRED' });
    }
    const query = req.query as { limit?: string };
    const limit = Number(query.limit ?? 200);

    // Import PiShock website/panel device logs into the shared feed when linked
    if (req.pishockCreds) {
      try {
        await syncWebsiteDeviceLogs(req.discordUser.id, req.pishockCreds);
      } catch {
        // optional — public Discord feed still useful
      }
    }

    const [publicFeed, activity] = await Promise.all([
      listPublicCommandLogs(Number.isFinite(limit) ? limit : 200),
      listCommandLogs(req.discordUser.id, 50),
    ]);
    return {
      public: publicFeed,
      /** @deprecated prefer `public` — kept for PIP / personal hydration */
      activity,
    };
  });

  /**
   * Short request/response online probe.
   * Discord's activity proxy times out long-lived SSE (524), so clients poll this instead.
   */
  app.get('/api/broker/status', async (req, reply) => {
    const blocked = requireSession(req, reply);
    if (blocked) return blocked;

    const query = req.query as { clientIds?: string; waitMs?: string };
    const clientIds = (query.clientIds ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const waitMs = Number(query.waitMs ?? 2500);

    try {
      const result = await probeOnlineStatus(
        req.discordUser.id,
        req.pishockCreds!,
        clientIds,
        Number.isFinite(waitMs) ? waitMs : 2500,
      );
      return { ok: true, ...result, at: Date.now() };
    } catch (err) {
      return handlePiShockError(err, req.discordUser.id, reply);
    }
  });
};

