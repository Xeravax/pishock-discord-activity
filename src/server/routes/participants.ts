import type { FastifyPluginAsync } from 'fastify';
import { ShockerOp } from '../../shared/constants.js';
import type { AppEnv } from '../env.js';
import { InstanceAuthError, verifyActivityInstance } from '../discord-instance.js';
import {
  ProxyAuthError,
  assertProxyPayloadMatchesUser,
  validateDiscordProxyHeaders,
} from '../discord-proxy-auth.js';
import {
  agentNameForExecutor,
  operateById,
  piShockLogError,
  PiShockApiError,
  publicPiShockError,
  redactPiShockSecrets,
} from '../pishock/client.js';
import { publishOperate } from '../pishock/broker.js';
import {
  assertModeAllowed,
  assertOperateRateLimit,
  clearHoldAutoEnd,
  clampDurationMs,
  clampIntensity,
  OperatePolicyError,
  scheduleHoldAutoEnd,
} from '../operate-policy.js';
import { bandForOperation, shareBandsFromRow } from '../limit-bands.js';
import { atLeastWarning, normalizeWarningLevel } from '../../shared/warning.js';
import type { WarningLevel } from '../../shared/warning.js';
import { shockWarningBody, ShockWarningError, warnBeforeShock } from '../pishock/shock-warning.js';
import {
  getCommandQueueEnabled,
  getCommandQueueSettings,
  getConsent,
  getEmergencyStopShockerIds,
  isEmergencyStopped,
  isExecutorBanned,
  listEnabledActivityShares,
  isQueueStarred,
  listQueueStars,
  loadPiShockCreds,
  logCommand,
} from '../session.js';
import { prisma } from '../db.js';
import { broadcastRealtime } from '../realtime.js';
import {
  resolveActivityLocation,
  type ActivityLocationContext,
  type ClientLocationHint,
} from '../discord-location.js';
import { commandQueue } from '../pishock/command-queue-runtime.js';
import { CommandQueueError, type QueuedOperation } from '../pishock/command-queue.js';
import {
  getPiShockPauseState,
  rememberPiShockPaused,
  shockerPauseBlocks,
  type PiShockPauseState,
} from '../pishock/pause.js';

const PARTICIPANT_STATUS_CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Math.min(Math.max(1, limit), items.length);
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await fn(item);
    }
  }
  if (workers > 0) {
    await Promise.all(Array.from({ length: workers }, () => worker()));
  }
  return results;
}

function executorLabel(user: { id: string; username?: string | null; global_name?: string | null }) {
  const name = user.global_name || user.username || 'unknown';
  return `${name} (${user.id})`;
}

async function auditParticipantCommand(input: {
  executorDiscordUserId: string;
  targetDiscordUserId: string;
  executorUsername?: string | null;
  executorGlobalName?: string | null;
  executorAvatar?: string | null;
  action: string;
  shockerId: number;
  shockerName?: string | null;
  hubClientId?: string | null;
  hubName?: string | null;
  shareCode?: string | null;
  intensity: number;
  durationMs: number;
  success: boolean;
  detail: string;
  location?: ActivityLocationContext | null;
}) {
  const loc = input.location;
  const base = {
    executorDiscordUserId: input.executorDiscordUserId,
    targetDiscordUserId: input.targetDiscordUserId,
    action: input.action,
    shockerId: input.shockerId,
    shockerName: input.shockerName,
    hubClientId: input.hubClientId,
    hubName: input.hubName,
    intensity: input.intensity,
    durationMs: input.durationMs,
    success: input.success,
    detail: input.detail,
    source: 'discord' as const,
    instanceId: loc?.instanceId,
    guildId: loc?.guildId,
    channelId: loc?.channelId,
    locationKind: loc?.locationKind,
    locationName: loc?.locationName,
    locationIconUrl: loc?.locationIconUrl,
  };
  // Executor log never receives the share code; owner/target row may store it server-side.
  await Promise.all([
    logCommand({ discordUserId: input.executorDiscordUserId, ...base }),
    logCommand({
      discordUserId: input.targetDiscordUserId,
      ...base,
      shareCode: input.shareCode ?? undefined,
    }),
  ]);

  const action = input.action.toLowerCase();
  if (
    input.success &&
    action !== 'participant_end' &&
    action !== 'end' &&
    action !== 'stop'
  ) {
    broadcastRealtime(
      {
        type: 'incoming_command',
        targetDiscordUserId: input.targetDiscordUserId,
        executorDiscordUserId: input.executorDiscordUserId,
        executorUsername: input.executorUsername ?? null,
        executorGlobalName: input.executorGlobalName ?? null,
        executorAvatar: input.executorAvatar ?? null,
        action: input.action,
        shockerId: input.shockerId,
        intensity: input.intensity,
        durationMs: input.durationMs,
        success: input.success,
        at: Date.now(),
      },
      { discordUserId: input.targetDiscordUserId },
    );
  }
}

export const participantRoutes: FastifyPluginAsync<{ env: AppEnv }> = async (app, opts) => {
  app.addHook('preHandler', async (req, reply) => {
    const path = (req.url.split('?')[0] ?? req.url);
    if (!path.startsWith('/api/participants')) return;
    try {
      const payload = validateDiscordProxyHeaders(opts.env, req);
      assertProxyPayloadMatchesUser(payload, req.discordUser.id);
    } catch (err) {
      if (err instanceof ProxyAuthError) {
        return reply.code(err.status).send({ error: err.message, code: 'PROXY_AUTH' });
      }
      throw err;
    }
  });

  app.post('/api/participants/status', async (req, reply) => {
    if (!req.hasConsent) {
      return reply.code(403).send({ error: 'Consent required', code: 'CONSENT_REQUIRED' });
    }

    const body = req.body as { discordUserIds?: string[]; instanceId?: string };
    const instanceId = body.instanceId ? String(body.instanceId) : '';
    try {
      await verifyActivityInstance(opts.env, instanceId, {
        requireUserId: req.discordUser.id,
        allowMissingBot: true,
      });
    } catch (err) {
      if (err instanceof InstanceAuthError) {
        return reply.code(err.status).send({ error: err.message, code: 'INSTANCE_AUTH' });
      }
      throw err;
    }

    const ids = [...new Set((body.discordUserIds ?? []).map(String).filter(Boolean))].slice(0, 50);
    const myStars = new Set(await listQueueStars(req.discordUser.id));
    const participants = await mapWithConcurrency(ids, PARTICIPANT_STATUS_CONCURRENCY, async (id) => {
      const [user, shares, bannedYou, targetCreds, hasConsent, theirSettings, theyStarredMe] =
        await Promise.all([
          prisma.discordUser.findUnique({ where: { id } }),
          listEnabledActivityShares(id),
          isExecutorBanned(id, req.discordUser.id),
          loadPiShockCreds(opts.env, id),
          getConsent(id),
          getCommandQueueSettings(id),
          isQueueStarred(id, req.discordUser.id),
        ]);
      const hasSession = Boolean(targetCreds);
      const pause: PiShockPauseState = targetCreds
        ? await getPiShockPauseState(id, targetCreds).catch(
            (): PiShockPauseState => ({ shockerIds: [], shareCodes: [], unknown: true }),
          )
        : { shockerIds: [], shareCodes: [], unknown: false };
      const shockerIsPaused = (shockerId: number) =>
        pause.unknown || pause.shockerIds.includes(shockerId);
      const theirPaused = theirSettings.enabled ? commandQueue.getPaused(id) : false;
      const theirHalted = theirSettings.enabled ? commandQueue.getHalted(id) : false;
      const eStops = new Set(await getEmergencyStopShockerIds(id));
      const active = shares.filter(
        (s: { enabled: boolean; paused: boolean }) => s.enabled && !s.paused,
      );
      const operable = active.filter(
        (s: { shockerId: number }) => !eStops.has(s.shockerId) && !shockerIsPaused(s.shockerId),
      );
      const allEStopped =
        active.length > 0 &&
        active.every((s: { shockerId: number }) => eStops.has(s.shockerId));
      const visibleShockers = bannedYou
        ? []
        : active.map(
            (s: {
              shockerId: number;
              shockerName: string;
              hubClientId: string | null;
              hubName?: string | null;
              deviceMaxIntensity: number;
              deviceMaxDurationMs: number;
              minIntensity: number;
              maxIntensity: number;
              minDurationMs: number;
              maxDurationMs: number;
              canShock: boolean;
              canVibrate: boolean;
              canBeep: boolean;
              canHold: boolean;
              paused: boolean;
            }) => {
              const stopped = eStops.has(s.shockerId);
              const devicePaused = shockerIsPaused(s.shockerId);
              const bands = shareBandsFromRow(s);
              return {
                shockerId: s.shockerId,
                shockerName: s.shockerName,
                hubClientId: s.hubClientId,
                hubName: s.hubName ?? null,
                deviceMaxIntensity: s.deviceMaxIntensity,
                deviceMaxDurationMs: s.deviceMaxDurationMs,
                minIntensity: bands.shock.minIntensity,
                maxIntensity: bands.shock.maxIntensity,
                minDurationMs: bands.shock.minDurationMs,
                maxDurationMs: bands.shock.maxDurationMs,
                vibMinIntensity: bands.vibrate.minIntensity,
                vibMaxIntensity: bands.vibrate.maxIntensity,
                vibMinDurationMs: bands.vibrate.minDurationMs,
                vibMaxDurationMs: bands.vibrate.maxDurationMs,
                beepMinIntensity: bands.beep.minIntensity,
                beepMaxIntensity: bands.beep.maxIntensity,
                beepMinDurationMs: bands.beep.minDurationMs,
                beepMaxDurationMs: bands.beep.maxDurationMs,
                requiredWarningLevel: bands.requiredWarningLevel,
                canShock: !stopped && !devicePaused && s.canShock,
                canVibrate: !stopped && !devicePaused && s.canVibrate,
                canBeep: !stopped && !devicePaused && s.canBeep,
                canHold: !stopped && !devicePaused && s.canHold,
                paused: devicePaused || s.paused,
                emergencyStop: stopped,
              };
            },
          );
      participants.push({
        discordUserId: id,
        username: user?.username ?? null,
        globalName: user?.globalName ?? null,
        avatar: user?.avatar ?? null,
        linked: hasSession,
        consent: hasConsent,
        available: hasSession && hasConsent && operable.length > 0 && !bannedYou,
        paused:
          shares.length > 0 &&
          shares.every((s: { paused: boolean; enabled: boolean }) => s.paused || !s.enabled),
        emergencyStop: !bannedYou && allEStopped,
        bannedYou,
        /** Caller's star — this person's commands to the caller get queue priority. */
        priority: myStars.has(id),
        /** Their queue / access rules when you target them. */
        queue: {
          enabled: theirSettings.enabled,
          starOnly: theirSettings.starOnly,
          starredByThem: theyStarredMe,
          canOperate:
            (!theirSettings.starOnly || theyStarredMe) &&
            !(theirSettings.enabled && theirHalted),
          paused: Boolean(theirPaused),
          halted: Boolean(theirHalted),
          maxPerSender: theirSettings.maxPerSender,
          progressMs: theirSettings.progressMs,
        },
        shockers: visibleShockers,
      };
    });
    return { participants };
  });

  app.post('/api/participants/:targetDiscordUserId/operate', async (req, reply) => {
    if (!req.hasConsent) {
      return reply.code(403).send({ error: 'Consent required', code: 'CONSENT_REQUIRED' });
    }

    try {
      assertOperateRateLimit(req.discordUser.id);
    } catch (err) {
      if (err instanceof OperatePolicyError) {
        return reply.code(err.status).send({ error: err.message, code: err.code });
      }
      throw err;
    }

    const targetDiscordUserId = String(
      (req.params as { targetDiscordUserId: string }).targetDiscordUserId,
    );
    const body = req.body as {
      instanceId?: string;
      locationHint?: ClientLocationHint | null;
      shockerId?: number;
      operation?: 'shock' | 'vibrate' | 'beep' | 'hold' | 'warning' | 'stop' | 'end';
      intensity?: number;
      durationMs?: number;
      hold?: boolean;
      warning?: boolean;
      warningLevel?: WarningLevel | string;
      clientId?: string | number;
    };

    const instanceId = body.instanceId ? String(body.instanceId) : '';
    let instanceInfo = null;
    try {
      instanceInfo = await verifyActivityInstance(opts.env, instanceId, {
        requireUserId: req.discordUser.id,
        requireUserIds: [targetDiscordUserId],
        allowMissingBot: true,
      });
    } catch (err) {
      if (err instanceof InstanceAuthError) {
        return reply.code(err.status).send({ error: err.message, code: 'INSTANCE_AUTH' });
      }
      throw err;
    }
    const location = await resolveActivityLocation(
      opts.env,
      instanceId,
      instanceInfo,
      body.locationHint ?? null,
    );

    if (await isExecutorBanned(targetDiscordUserId, req.discordUser.id)) {
      return reply.code(403).send({
        error: 'This user has blocked you from controlling their device',
        code: 'BANNED',
      });
    }

    const targetQueue = await getCommandQueueSettings(targetDiscordUserId);
    if (targetQueue.starOnly && !(await isQueueStarred(targetDiscordUserId, req.discordUser.id))) {
      return reply.code(403).send({
        error: 'This person only accepts commands from starred participants',
        code: 'STAR_ONLY',
      });
    }

    const targetConsent = await getConsent(targetDiscordUserId);
    if (!targetConsent) {
      return reply.code(403).send({ error: 'Target has not consented', code: 'TARGET_CONSENT' });
    }

    const targetCreds = await loadPiShockCreds(opts.env, targetDiscordUserId);
    if (!targetCreds) {
      return reply.code(404).send({ error: 'Target has no linked PiShock session', code: 'TARGET_UNLINKED' });
    }

    const shares = (await listEnabledActivityShares(targetDiscordUserId)).filter(
      (s: { enabled: boolean; paused: boolean }) => s.enabled && !s.paused,
    );
    if (shares.length === 0) {
      return reply.code(404).send({ error: 'Target is not available in this activity', code: 'TARGET_UNAVAILABLE' });
    }

    const shockerId = Number(body.shockerId ?? shares[0]!.shockerId);
    const share = shares.find((s: { shockerId: number }) => s.shockerId === shockerId);
    if (!share) {
      return reply.code(404).send({ error: 'Shocker is not shared in this activity' });
    }

    const operation = body.operation;
    if (!operation) {
      return reply.code(400).send({ error: 'Missing operation' });
    }
    if (operation === 'stop') {
      return reply
        .code(403)
        .send({ error: 'Emergency stop is only available to the device owner' });
    }

    // Only the stored hub — never body.clientId.
    // Activity shares always operate with the owner's API key (no PiShock share codes).
    const clientId = share.hubClientId ?? undefined;
    const agent = agentNameForExecutor(executorLabel(req.discordUser));
    const executorCreds = req.pishockCreds;

    if (operation === 'end') {
      if (await getCommandQueueEnabled(targetDiscordUserId)) {
        const handled = await commandQueue.handleSenderEnd(
          targetDiscordUserId,
          req.discordUser.id,
          shockerId,
        );
        if (handled.handled) {
          if (!handled.ended) {
            await auditParticipantCommand({
              executorDiscordUserId: req.discordUser.id,
              executorUsername: req.discordUser.username,
              executorGlobalName: req.discordUser.global_name ?? null,
              executorAvatar: req.discordUser.avatar ?? null,
              targetDiscordUserId,
              action: 'participant_end',
              shockerId,
              shockerName: share.shockerName,
              hubClientId: share.hubClientId ?? clientId ?? null,
              hubName: share.hubName ?? null,
              shareCode: null,
              intensity: 0,
              durationMs: 0,
              success: false,
              location,
              detail: JSON.stringify({
                via: 'queue',
                path: 'queue_end',
                ended: false,
                agent,
                instanceId,
              }),
            });
            return reply.code(502).send({
              error: 'Failed to end the command on the device',
              code: 'END_FAILED',
            });
          }
          await auditParticipantCommand({
            executorDiscordUserId: req.discordUser.id,
            executorUsername: req.discordUser.username,
            executorGlobalName: req.discordUser.global_name ?? null,
            executorAvatar: req.discordUser.avatar ?? null,
            targetDiscordUserId,
            action: 'participant_end',
            shockerId,
            shockerName: share.shockerName,
            hubClientId: share.hubClientId ?? clientId ?? null,
            hubName: share.hubName ?? null,
            shareCode: null,
            intensity: 0,
            durationMs: 0,
            success: true,
            location,
            detail: JSON.stringify({
              via: 'queue',
              path: 'queue_end',
              agent,
              instanceId,
            }),
          });
          return { ok: true, via: 'queue', ended: true };
        }
      }
      if (clientId == null) {
        return reply.code(400).send({ error: 'end requires a stored hub client id on the share' });
      }
      clearHoldAutoEnd(targetDiscordUserId, shockerId);
      const published = await publishOperate(targetCreds, {
        clientId,
        shockerId,
        operation: 'e',
        intensity: 0,
        durationMs: 0,
        end: true,
        agentName: agent,
      });
      await auditParticipantCommand({
        executorDiscordUserId: req.discordUser.id,
        executorUsername: req.discordUser.username,
        executorGlobalName: req.discordUser.global_name ?? null,
        executorAvatar: req.discordUser.avatar ?? null,
        targetDiscordUserId,
        action: 'participant_end',
        shockerId,
        shockerName: share.shockerName,
        hubClientId: share.hubClientId ?? clientId ?? null,
        hubName: share.hubName ?? null,
        shareCode: null,
        intensity: 0,
        durationMs: 0,
        success: published,
        location,
        detail: JSON.stringify({
          via: 'broker',
          path: 'target_session',
          agent,
          instanceId,
        }),
      });
      if (!published) {
        return reply.code(502).send({ error: 'Failed to end hold via broker' });
      }
      return { ok: true, via: 'broker', ended: true };
    }

    if (await isEmergencyStopped(targetDiscordUserId, shockerId)) {
      return reply.code(423).send({
        error: 'Owner has emergency stop engaged',
        code: 'EMERGENCY_STOP',
      });
    }

    const hold = Boolean(body.hold) || operation === 'hold';
    const warning = Boolean(body.warning) || operation === 'warning';
    try {
      assertModeAllowed(operation, hold, {
        canShock: share.canShock,
        canVibrate: share.canVibrate,
        canBeep: share.canBeep,
        canHold: share.canHold,
      });
    } catch (err) {
      if (err instanceof OperatePolicyError) {
        return reply.code(err.status).send({ error: err.message, code: err.code });
      }
      throw err;
    }

    const modes = shareBandsFromRow(share);
    const band = bandForOperation(modes, operation);
    const intensityCheck = Number(body.intensity ?? band.minIntensity);
    const durationCheck = Number(body.durationMs ?? Math.max(band.minDurationMs, 300));
    if (Number.isFinite(intensityCheck) && intensityCheck < band.minIntensity) {
      return reply.code(412).send({ error: 'Intensity below allowed minimum' });
    }
    if (Number.isFinite(intensityCheck) && intensityCheck > band.maxIntensity) {
      return reply.code(412).send({ error: 'Intensity exceeds allowed maximum' });
    }
    if (Number.isFinite(durationCheck) && durationCheck < band.minDurationMs) {
      return reply.code(416).send({ error: 'Duration below allowed minimum' });
    }
    if (Number.isFinite(durationCheck) && durationCheck > band.maxDurationMs) {
      return reply.code(416).send({ error: 'Duration exceeds allowed maximum' });
    }

    const intensity = clampIntensity(body.intensity, band.maxIntensity, band.minIntensity);
    const durationMs = clampDurationMs(body.durationMs, band.maxDurationMs, band.minDurationMs);

    const devicePaused = await shockerPauseBlocks(targetDiscordUserId, targetCreds, shockerId);
    if (devicePaused) {
      return reply.code(503).send({
        error: 'This shocker or share is paused on PiShock',
        code: 'PISHOCK_PAUSED',
      });
    }

    const requestedWarningLevel = normalizeWarningLevel(body.warningLevel);
    const effectiveWarningLevel = atLeastWarning(
      requestedWarningLevel,
      modes.requiredWarningLevel,
    );
    const shockOrHold = operation === 'shock' || operation === 'hold';
    if (shockOrHold && effectiveWarningLevel !== 'none' && !share.canVibrate) {
      return reply.code(405).send({
        error:
          modes.requiredWarningLevel !== 'none'
            ? 'Owner requires a warning vibe before shock, but vibrate is disabled'
            : 'Vibrate is disabled, so the warning before shock was not sent',
        code: 'WARNING_REQUIRED',
        ...(modes.requiredWarningLevel !== 'none'
          ? { requiredWarningLevel: modes.requiredWarningLevel }
          : {}),
      });
    }

    if (await getCommandQueueEnabled(targetDiscordUserId)) {
      const queuedOp: QueuedOperation =
        operation === 'shock' || operation === 'hold'
          ? operation === 'hold'
            ? 'hold'
            : 'shock'
          : operation === 'vibrate' || operation === 'warning'
            ? operation === 'warning'
              ? 'warning'
              : 'vibrate'
            : 'beep';
      try {
        const queued = await commandQueue.enqueue({
          ownerDiscordUserId: targetDiscordUserId,
          executorDiscordUserId: req.discordUser.id,
          executorUsername: req.discordUser.username ?? null,
          executorGlobalName: req.discordUser.global_name ?? null,
          executorAvatar: req.discordUser.avatar ?? null,
          operation: queuedOp,
          intensity,
          durationMs,
          hold,
          warning,
          warningLevel: requestedWarningLevel,
          shockerId,
          shareCode: null,
          hubClientId: share.hubClientId ?? clientId ?? null,
          instanceId,
          payload: {
            env: opts.env,
            location,
            executorHadSession: Boolean(executorCreds),
          },
        });
        return {
          ok: true,
          queued: true,
          itemId: queued.itemId,
          position: queued.position,
          paused: queued.paused,
          estimatedWaitMs: queued.estimatedWaitMs,
          estimatedStartAt: queued.estimatedStartAt,
        };
      } catch (err) {
        if (err instanceof CommandQueueError) {
          return reply.code(err.status).send({ error: err.message, code: err.code });
        }
        throw err;
      }
    }

    const op =
      operation === 'shock' || operation === 'hold'
        ? ShockerOp.Shock
        : operation === 'vibrate' || operation === 'warning'
          ? ShockerOp.Vibrate
          : ShockerOp.Beep;

    try {
      await warnBeforeShock({
        operation,
        requestedWarningLevel,
        requiredWarningLevel: modes.requiredWarningLevel,
        canVibrate: share.canVibrate,
        creds: targetCreds,
        clientId: clientId ?? null,
        shockerId,
        ownerDiscordUserId: targetDiscordUserId,
        vibrateBand: modes.vibrate,
      });
      if ((hold || warning) && clientId != null) {
        const published = await publishOperate(targetCreds, {
          clientId,
          shockerId,
          operation: op,
          intensity: Math.max(1, intensity),
          durationMs,
          hold,
          warning,
          end: false,
          agentName: agent,
        });
        if (published) {
          if (hold) {
            scheduleHoldAutoEnd(targetCreds, {
              ownerDiscordUserId: targetDiscordUserId,
              shockerId,
              clientId,
              durationMs,
              shareCode: null,
              agentName: agent,
            });
          }
          await auditParticipantCommand({
            executorDiscordUserId: req.discordUser.id,
            executorUsername: req.discordUser.username,
            executorGlobalName: req.discordUser.global_name ?? null,
            executorAvatar: req.discordUser.avatar ?? null,
            targetDiscordUserId,
            action: `participant_${operation}`,
            shockerId,
            shockerName: share.shockerName,
            hubClientId: share.hubClientId ?? clientId ?? null,
            hubName: share.hubName ?? null,
            shareCode: null,
            intensity,
            durationMs,
            success: true,
            location,
            detail: JSON.stringify({
              via: 'broker',
              path: 'target_session',
              agent,
              executor: req.discordUser.id,
              target: targetDiscordUserId,
              instanceId,
            }),
          });
          return { ok: true, via: 'broker', path: 'target_session' };
        }
      }

      await operateById(
        targetCreds,
        shockerId,
        op,
        Math.max(1, intensity),
        durationMs,
        agent,
      );

      await auditParticipantCommand({
        executorDiscordUserId: req.discordUser.id,
        executorUsername: req.discordUser.username,
        executorGlobalName: req.discordUser.global_name ?? null,
        executorAvatar: req.discordUser.avatar ?? null,
        targetDiscordUserId,
        action: `participant_${operation}`,
        shockerId,
        shockerName: share.shockerName,
        hubClientId: share.hubClientId ?? clientId ?? null,
        hubName: share.hubName ?? null,
        shareCode: null,
        intensity,
        durationMs,
        success: true,
        location,
        detail: JSON.stringify({
          via: 'operateById',
          path: 'target_session',
          agent,
          executor: req.discordUser.id,
          target: targetDiscordUserId,
          instanceId,
        }),
      });
      return { ok: true, via: 'operateById', path: 'target_session' };
    } catch (err) {
      await auditParticipantCommand({
        executorDiscordUserId: req.discordUser.id,
        executorUsername: req.discordUser.username,
        executorGlobalName: req.discordUser.global_name ?? null,
        executorAvatar: req.discordUser.avatar ?? null,
        targetDiscordUserId,
        action: `participant_${operation}`,
        shockerId,
        shockerName: share.shockerName,
        hubClientId: share.hubClientId ?? clientId ?? null,
        hubName: share.hubName ?? null,
        shareCode: null,
        intensity,
        durationMs,
        success: false,
        location,
        detail: JSON.stringify({
          error: piShockLogError(err),
          agent,
          executor: req.discordUser.id,
          target: targetDiscordUserId,
          instanceId,
        }),
      });
      if (err instanceof ShockWarningError) {
        return reply.code(err.status).send(shockWarningBody(err));
      }
      if (err instanceof PiShockApiError) {
        console.warn(
          `[pishock] participant operate ${err.status}: ${redactPiShockSecrets(err.body).slice(0, 200)}`,
        );
        if (err.status === 503) {
          rememberPiShockPaused(targetDiscordUserId, { shockerId, shareCode: null });
        }
        const pub = publicPiShockError(err, { relink: false });
        return reply.code(pub.status).send(
          pub.code ? { error: pub.error, code: pub.code } : { error: pub.error },
        );
      }
      throw err;
    }
  });
};
