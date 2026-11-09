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
  loadLogs,
  operateById,
  operateByShare,
  pauseLink,
  pauseShare,
} from '../pishock/client.js';
import { getOnlineMap, probeOnlineStatus, publishOperate } from '../pishock/broker.js';
import {
  clearPiShockSession,
  getPersonalActivityLimits,
  isEmergencyStopped,
  listCommandLogs,
  logCommand,
  setEmergencyStop,
} from '../session.js';
import { broadcastRealtimeAll } from '../realtime.js';

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

export const controlRoutes: FastifyPluginAsync<{ env: AppEnv }> = async (app) => {
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
    if (body.engaged && body.clientId != null) {
      await publishOperate(creds, {
        clientId: body.clientId,
        shockerId,
        operation: 'e',
        intensity: 0,
        durationMs: 0,
        end: true,
        agentName: 'Emergency Stop',
      });
    }

    const result = await setEmergencyStop(req.discordUser.id, shockerId, body.engaged);
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

    const body = req.body as {
      shockerId?: number;
      shareCode?: string;
      operation?: 'shock' | 'vibrate' | 'beep' | 'hold' | 'warning' | 'stop' | 'end';
      intensity?: number;
      durationMs?: number;
      canShock?: boolean;
      canVibrate?: boolean;
      canBeep?: boolean;
      canHold?: boolean;
      maxIntensity?: number;
      maxDuration?: number;
      clientId?: number | string;
      hold?: boolean;
      warning?: { Active: boolean; Min: number; Max: number } | null;
    };

    const operation = body.operation;
    if (!operation) {
      return reply.code(400).send({ error: 'Missing operation' });
    }
    if (!body.shockerId && !body.shareCode) {
      return reply.code(400).send({ error: 'Missing shockerId or shareCode' });
    }
    // Kill-switch is a latch via PUT /api/emergency-stop — not a one-shot operate
    if (operation === 'stop') {
      return reply.code(400).send({
        error: 'Use emergency-stop latch (press in / press out)',
        code: 'USE_EMERGENCY_STOP_LATCH',
      });
    }

    // Tap/Remote release: end the in-progress hold without latching emergency stop
    if (operation === 'end') {
      if (body.shockerId == null || body.clientId == null) {
        return reply.code(400).send({ error: 'end requires shockerId and clientId' });
      }
      const creds = req.pishockCreds!;
      const published = await publishOperate(creds, {
        clientId: body.clientId,
        shockerId: Number(body.shockerId),
        operation: 'e',
        intensity: 0,
        durationMs: 0,
        end: true,
        shareCode: body.shareCode,
        agentName: 'Tap Release',
      });
      await logCommand({
        discordUserId: req.discordUser.id,
        action: 'end',
        shockerId: Number(body.shockerId),
        shareCode: body.shareCode,
        intensity: 0,
        durationMs: 0,
        success: published,
        detail: published ? 'broker' : 'broker_failed',
      });
      if (!published) {
        return reply.code(502).send({ error: 'Failed to end hold via broker' });
      }
      return { ok: true, via: 'broker', ended: true };
    }

    if (body.shockerId != null && !body.shareCode) {
      if (await isEmergencyStopped(req.discordUser.id, Number(body.shockerId))) {
        return reply.code(423).send({
          error: 'Emergency stop is engaged — release STOP to allow commands',
          code: 'EMERGENCY_STOP',
        });
      }
    }

    const intensity = Math.max(0, Math.min(100, Number(body.intensity ?? 1)));
    // Official OperateById expects duration in milliseconds (e.g. 300, 1000)
    const durationMs = Math.max(16, Math.min(15_000, Number(body.durationMs ?? 300)));
    // Own-device Activity Limits (Discord app ceiling) — website shares keep their share maxes
    let maxIntensity = body.maxIntensity ?? 100;
    let maxDuration = body.maxDuration ?? 15_000;
    if (!body.shareCode) {
      const personal = await getPersonalActivityLimits(req.discordUser.id);
      maxIntensity = Math.min(maxIntensity, personal.activityMaxIntensity);
      maxDuration = Math.min(maxDuration, personal.activityMaxDurationMs);
    }
    const hold = Boolean(body.hold) || operation === 'hold';
    const warning = Boolean(body.warning?.Active) || operation === 'warning';

    if (intensity > maxIntensity) {
      return reply.code(412).send({ error: 'Intensity exceeds allowed maximum' });
    }
    if (durationMs > maxDuration) {
      return reply.code(416).send({ error: 'Duration exceeds allowed maximum' });
    }

    const flags = {
      shock: body.canShock !== false,
      vibrate: body.canVibrate !== false,
      beep: body.canBeep !== false,
      hold: body.canHold !== false,
    };

    if ((operation === 'shock' || operation === 'hold') && !flags.shock) {
      return reply.code(405).send({ error: 'Shock not allowed on this share' });
    }
    if ((operation === 'vibrate' || operation === 'warning') && !flags.vibrate) {
      return reply.code(405).send({ error: 'Vibrate not allowed on this share' });
    }
    if (operation === 'beep' && !flags.beep) {
      return reply.code(405).send({ error: 'Beep not allowed on this share' });
    }
    if (hold && !flags.hold) {
      return reply.code(405).send({ error: 'Hold not allowed on this share' });
    }

    const creds = req.pishockCreds!;
    try {
      const op =
        operation === 'shock' || operation === 'hold'
          ? ShockerOp.Shock
          : operation === 'vibrate' || operation === 'warning'
            ? ShockerOp.Vibrate
            : ShockerOp.Beep;

      // Prefer broker for owned V3 devices (same channel emergency stop cancels)
      if (body.shockerId != null && body.clientId != null && !body.shareCode) {
        const published = await publishOperate(creds, {
          clientId: body.clientId,
          shockerId: body.shockerId,
          operation: op,
          intensity: Math.max(1, intensity),
          durationMs,
          hold,
          warning,
        });
        if (published) {
          await logCommand({
            discordUserId: req.discordUser.id,
            action: operation,
            shockerId: body.shockerId,
            shareCode: body.shareCode,
            intensity,
            durationMs,
            success: true,
            detail: 'broker',
          });
          return { ok: true, via: 'broker' };
        }
      }

      if (hold || warning) {
        if (!body.shockerId) {
          return reply.code(400).send({ error: 'Hold/warning requires shockerId' });
        }
        const result = await clientOperate(creds, {
          ShockerId: body.shockerId,
          Intensity: Math.max(1, intensity),
          Duration: Math.max(1, Math.round(durationMs / 1000)),
          Op: op,
          Hold: hold,
          Warning: warning,
        });
        if (result.status !== 404 && result.status !== 405) {
          await logCommand({
            discordUserId: req.discordUser.id,
            action: operation,
            shockerId: body.shockerId,
            shareCode: body.shareCode,
            intensity,
            durationMs,
            success: true,
          });
          return { ok: true, via: 'client-operate' };
        }
      }

      if (body.shareCode) {
        await operateByShare(creds, body.shareCode, op, Math.max(1, intensity), durationMs);
      } else {
        await operateById(creds, body.shockerId!, op, Math.max(1, intensity), durationMs);
      }

      await logCommand({
        discordUserId: req.discordUser.id,
        action: operation,
        shockerId: body.shockerId,
        shareCode: body.shareCode,
        intensity,
        durationMs,
        success: true,
      });
      return { ok: true };
    } catch (err) {
      await logCommand({
        discordUserId: req.discordUser.id,
        action: operation,
        shockerId: body.shockerId,
        shareCode: body.shareCode,
        intensity,
        durationMs,
        success: false,
        detail: err instanceof Error ? err.message : String(err),
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
    const activity = await listCommandLogs(req.discordUser.id);
    let deviceLogs: unknown = null;
    if (req.pishockCreds) {
      try {
        const result = await loadLogs(req.pishockCreds);
        if (result.status !== 404 && result.status !== 405) {
          deviceLogs = result.data;
        }
      } catch (err) {
        if (err instanceof PiShockApiError && err.needsRelogin) {
          // Activity logs still useful without device logs
        }
        // Device logs optional
      }
    }
    return { activity, deviceLogs };
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
