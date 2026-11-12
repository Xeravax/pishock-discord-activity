import type { FastifyPluginAsync } from 'fastify';
import { ShockerOp } from '../../shared/constants.js';
import type { AppEnv } from '../env.js';
import {
  PiShockApiError,
  piShockLogError,
  publicPiShockError,
  redactPiShockSecrets,
  claimShareCodes,
  createShare,
  deleteShare,
  fetchControlSnapshot,
  operateById,
  operateByShare,
  pauseShare,
} from '../pishock/client.js';
import {
  ensureLogCapture,
  getOnlineMap,
  probeOnlineStatus,
  publishOperate,
} from '../pishock/broker.js';
import { commandQueue } from '../pishock/command-queue-runtime.js';
import {
  annotateShockersWithPause,
  getPiShockPauseState,
  isPiShockSharePaused,
  rememberPiShockPaused,
  shockerPauseBlocks,
  type PiShockPauseState,
} from '../pishock/pause.js';
import {
  assertModeAllowed,
  assertOperateRateLimit,
  assertWithinCeilings,
  beginPendingHold,
  cancelPendingHold,
  clearHoldAutoEnd,
  clampDurationMs,
  clampIntensity,
  isPendingHoldCurrent,
  findHubNameInSnapshot,
  findShockerInSnapshot,
  OperatePolicyError,
  shockerIdOf,
  shockerNameOf,
  resolveOwnOperatePolicy,
  scheduleHoldAutoEnd,
  verifyOwnedClientId,
} from '../operate-policy.js';
import { bandForOperation } from '../limit-bands.js';
import { shockWarningBody, ShockWarningError, warnBeforeShock } from '../pishock/shock-warning.js';
import type { WarningLevel } from '../../shared/warning.js';
import {
  clearPiShockSession,
  listCommandLogs,
  listPublicCommandLogs,
  getEmergencyStopShockerIds,
  loadPiShockCreds,
  logCommand,
  setEmergencyStops,
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
  shockerName?: string | null;
  hubClientId?: string | null;
  hubName?: string | null;
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
    shockerName: input.shockerName,
    hubClientId: input.hubClientId,
    hubName: input.hubName,
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
    console.warn(
      `[pishock] ${discordUserId} ${err.status}: ${redactPiShockSecrets(err.body).slice(0, 200)}`,
    );
    if (err.needsRelogin) {
      await clearPiShockSession(discordUserId);
    }
    const pub = publicPiShockError(err);
    return reply.code(pub.status).send(
      pub.code ? { error: pub.error, code: pub.code } : { error: pub.error },
    );
  }
  throw err;
}

function snapshotShockerIds(shockers: unknown[]): number[] {
  const ids: number[] = [];
  for (const raw of shockers) {
    if (!raw || typeof raw !== 'object') continue;
    const id = shockerIdOf(raw as Record<string, unknown>);
    if (id != null) ids.push(id);
  }
  return ids;
}

/** Cut the active queued command when the emergency-stop publish itself failed. */
async function stopActiveQueuedDevice(ownerDiscordUserId: string, shockerIds: number[]) {
  commandQueue.holdAdvance(ownerDiscordUserId);
  const state = await commandQueue.snapshot(ownerDiscordUserId);
  if (!state.active || !shockerIds.includes(state.active.shockerId)) return;
  await commandQueue.skipActive(ownerDiscordUserId);
}

export const controlRoutes: FastifyPluginAsync<{ env: AppEnv }> = async (app, opts) => {
  app.get('/api/devices', async (req, reply) => {
    const blocked = requireSession(req, reply);
    if (blocked) return blocked;
    try {
      const snapshot = await fetchControlSnapshot(req.pishockCreds!);
      const clientIds = collectHubClientIds(snapshot.hubs);
      ensureLogCapture(req.discordUser.id, req.pishockCreds!, clientIds);
      const [emergencyStopShockerIds, pause] = await Promise.all([
        getEmergencyStopShockerIds(req.discordUser.id),
        getPiShockPauseState(req.discordUser.id, req.pishockCreds!).catch(
          (): PiShockPauseState => ({ shockerIds: [], shareCodes: [], unknown: true }),
        ),
      ]);
      const pausedIds = pause.unknown
        ? snapshotShockerIds(snapshot.shockers ?? [])
        : pause.shockerIds;
      return {
        ...snapshot,
        shockers: annotateShockersWithPause(snapshot.shockers ?? [], pausedIds),
        online: getOnlineMap(req.discordUser.id),
        emergencyStopShockerIds,
        pausedShockerIds: pausedIds,
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
      shockerIds?: number[];
      engaged?: boolean;
      clientId?: number | string;
    };
    const requested = [
      ...(Array.isArray(body.shockerIds) ? body.shockerIds : []),
      body.shockerId,
    ]
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0)
      .map((id) => Math.floor(id));
    const shockerIds = [...new Set(requested)];
    if (shockerIds.length === 0) {
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
    for (const shockerId of shockerIds) {
      if (!findShockerInSnapshot(snapshot, shockerId)) {
        return reply.code(404).send({ error: 'Shocker not found on this PiShock account' });
      }
    }

    let cutFailures = 0;
    if (body.engaged) {
      commandQueue.holdAdvance(req.discordUser.id);
      commandQueue.invalidateInFlight(req.discordUser.id);
      try {
        const cuts: Array<{ shockerId: number; clientId: string | null }> = [];
        for (const shockerId of shockerIds) {
          const row = findShockerInSnapshot(snapshot, shockerId);
          // Prefer the hub attached to this shocker; body.clientId is only a fallback.
          const rowClientId = row
            ? String(row.ClientId ?? row.clientId ?? '').trim() || null
            : null;
          const bodyClientId =
            shockerIds.length === 1 ? verifyOwnedClientId(snapshot, body.clientId) : null;
          cuts.push({ shockerId, clientId: rowClientId ?? bodyClientId });
        }
        for (const cut of cuts) {
          if (!cut.clientId) {
            cutFailures += 1;
            await stopActiveQueuedDevice(req.discordUser.id, [cut.shockerId]);
            continue;
          }
          const published = await publishOperate(creds, {
            clientId: cut.clientId,
            shockerId: cut.shockerId,
            operation: 'e',
            intensity: 0,
            durationMs: 0,
            end: true,
            agentName: 'Emergency Stop',
          });
          if (!published) {
            cutFailures += 1;
            await stopActiveQueuedDevice(req.discordUser.id, [cut.shockerId]);
            continue;
          }
          clearHoldAutoEnd(req.discordUser.id, cut.shockerId);
        }
        // Latch and clear pending work even when an immediate cut fails.
        await commandQueue.hardClear(req.discordUser.id, { endActiveDevice: false });
      } finally {
        commandQueue.releaseAdvance(req.discordUser.id);
      }
    }

    const result = await setEmergencyStops(req.discordUser.id, shockerIds, body.engaged);
    if (body.engaged && cutFailures > 0) {
      broadcastRealtimeAll({
        type: 'emergency_stop',
        ownerDiscordUserId: req.discordUser.id,
        shockerId: shockerIds[0]!,
        engaged: true,
        emergencyStopShockerIds: result.emergencyStopShockerIds,
        at: Date.now(),
      });
      return reply.code(502).send({
        error:
          cutFailures === shockerIds.length
            ? 'Failed to cut the shocker'
            : 'Emergency stop latched, but one or more cuts failed',
        code: 'EMERGENCY_STOP_FAILED',
        emergencyStopShockerIds: result.emergencyStopShockerIds,
        cutFailures,
      });
    }
    for (const shockerId of shockerIds) {
      const row = findShockerInSnapshot(snapshot, shockerId);
      const hubClientId = row
        ? String(row.ClientId ?? row.clientId ?? '').trim() || null
        : null;
      await logCommand({
        discordUserId: req.discordUser.id,
        action: body.engaged ? 'emergency_stop_on' : 'emergency_stop_off',
        shockerId,
        shockerName: row ? shockerNameOf(row) : null,
        hubClientId,
        hubName: findHubNameInSnapshot(snapshot, hubClientId),
        intensity: 0,
        durationMs: 0,
        success: true,
        detail: body.engaged
          ? shockerIds.length > 1
            ? 'latched-all'
            : 'latched'
          : shockerIds.length > 1
            ? 'released-all'
            : 'released',
      });
    }
    const primaryId = shockerIds[0]!;
    broadcastRealtimeAll({
      type: 'emergency_stop',
      ownerDiscordUserId: req.discordUser.id,
      shockerId: primaryId,
      engaged: result.engagedIds.includes(primaryId),
      emergencyStopShockerIds: result.emergencyStopShockerIds,
      at: Date.now(),
    });
    return {
      ok: true,
      engaged: result.engagedIds.includes(primaryId),
      emergencyStopShockerIds: result.emergencyStopShockerIds,
    };
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
      warningLevel?: WarningLevel | string;
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
      policy = await resolveOwnOperatePolicy(
        req.discordUser.id,
        creds,
        {
          shockerId: body.shockerId,
          shareCode: body.shareCode,
        },
        {
          loadOwnerPiShockCreds: (ownerId) => loadPiShockCreds(opts.env, ownerId),
          ownerShockerPauseBlocks: (ownerId, ownerCreds, id) =>
            shockerPauseBlocks(ownerId, ownerCreds, id),
        },
      );
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
      cancelPendingHold(policy.ownerDiscordUserId, shockerId);
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
        shockerName: policy.shockerName,
        hubClientId: policy.hubClientId,
        hubName: policy.hubName,
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

    // Refuse before hitting PiShock when the site already reports this shocker/share paused.
    if (shockerId != null || shareCode) {
      const pausedByShocker =
        shockerId != null
          ? await shockerPauseBlocks(req.discordUser.id, creds, shockerId)
          : false;
      const pausedByShare = shareCode
        ? await isPiShockSharePaused(req.discordUser.id, creds, shareCode)
        : false;
      if (pausedByShocker || pausedByShare) {
        rememberPiShockPaused(req.discordUser.id, { shockerId, shareCode });
        return reply.code(503).send({
          error: 'This shocker or share is paused on PiShock',
          code: 'PISHOCK_PAUSED',
        });
      }
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

    const band = bandForOperation(policy.bands, operation);
    try {
      assertWithinCeilings(
        body.intensity,
        body.durationMs,
        band.maxIntensity,
        band.maxDurationMs,
        band.minIntensity,
        band.minDurationMs,
      );
    } catch (err) {
      if (err instanceof OperatePolicyError) {
        return reply.code(err.status).send({ error: err.message });
      }
      throw err;
    }

    const intensity = clampIntensity(body.intensity, band.maxIntensity, band.minIntensity);
    const durationMs = clampDurationMs(body.durationMs, band.maxDurationMs, band.minDurationMs);

    const pendingHold =
      hold && shockerId != null ? beginPendingHold(policy.ownerDiscordUserId, shockerId) : null;
    try {
      await warnBeforeShock({
        operation,
        requestedWarningLevel: body.warningLevel,
        requiredWarningLevel: policy.requiredWarningLevel,
        canVibrate: policy.flags.canVibrate,
        creds,
        clientId,
        shockerId,
        shareCode,
        ownerDiscordUserId: policy.ownerDiscordUserId,
        vibrateBand: policy.bands.vibrate,
        gateOnShare: policy.crossUser,
      });
      if (
        pendingHold != null &&
        shockerId != null &&
        !isPendingHoldCurrent(policy.ownerDiscordUserId, shockerId, pendingHold)
      ) {
        return { ok: true, via: 'broker', canceled: true };
      }

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
            shockerName: policy.shockerName,
            hubClientId: policy.hubClientId,
            hubName: policy.hubName,
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
            shockerName: policy.shockerName,
            hubClientId: policy.hubClientId,
            hubName: policy.hubName,
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
        // Hold/warning require broker PUBLISH — no legacy do.pishock.com fallback.
        await logOperateEvent({
          executorDiscordUserId: req.discordUser.id,
          ownerDiscordUserId: policy.ownerDiscordUserId,
          action: operation,
          shockerId,
          shockerName: policy.shockerName,
          hubClientId: policy.hubClientId,
          hubName: policy.hubName,
          shareCode: policy.crossUser ? null : shareCode,
          intensity,
          durationMs,
          success: false,
          detail: 'broker_failed',
          location,
        });
        return reply.code(502).send({
          error: 'Hold/warning requires broker; publish failed',
          code: 'BROKER_PUBLISH_FAILED',
        });
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
        shockerName: policy.shockerName,
        hubClientId: policy.hubClientId,
        hubName: policy.hubName,
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
        shockerName: policy.shockerName,
        hubClientId: policy.hubClientId,
        hubName: policy.hubName,
        shareCode: policy.crossUser ? null : shareCode,
        intensity,
        durationMs,
        success: false,
        detail: piShockLogError(err),
        location,
      });
      if (err instanceof ShockWarningError) {
        return reply.code(err.status).send(shockWarningBody(err));
      }
      if (err instanceof PiShockApiError && err.status === 503) {
        rememberPiShockPaused(policy.ownerDiscordUserId, {
          shockerId,
          shareCode,
        });
      }
      return handlePiShockError(err, req.discordUser.id, reply);
    }
  });

  app.post('/api/pause', async (req, reply) => {
    const blocked = requireSession(req, reply);
    if (blocked) return blocked;
    const body = req.body as {
      shareId?: number;
      pauseState?: boolean | null;
    };
    try {
      if (body.shareId == null) {
        return reply.code(400).send({ error: 'shareId required' });
      }
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

    // Website/device history is ephemeral — live broker `-log` ingest fills source=website rows.

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
      ensureLogCapture(req.discordUser.id, req.pishockCreds!, clientIds);
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

function collectHubClientIds(hubs: unknown[]): string[] {
  const ids: string[] = [];
  for (const hub of hubs) {
    if (!hub || typeof hub !== 'object') continue;
    const row = hub as Record<string, unknown>;
    const raw = row.HubId ?? row.hubId ?? row.ClientId ?? row.clientId ?? row.id ?? row.Id;
    if (raw == null || raw === '') continue;
    ids.push(String(raw));
  }
  return ids;
}

