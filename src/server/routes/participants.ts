import { parseBody, participantOperateBody, participantsStatusBody } from '../schemas/index.js';
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
  assertWithinCeilings,
  assertOperateRateLimit,
  beginPendingHold,
  cancelPendingHold,
  clearHoldAutoEnd,
  isPendingHoldCurrent,
  clampDurationMs,
  clampIntensity,
  OperatePolicyError,
  scheduleHoldAutoEnd,
} from '../operate-policy.js';
import { bandForOperation, personalBandsFromUser, shareBandsFromRow } from '../limit-bands.js';
import { atLeastWarning, normalizeWarningLevel, warningRank } from '../../shared/warning.js';
import type { WarningLevel } from '../../shared/warning.js';
import { shockWarningBody, ShockWarningError, warnBeforeShock } from '../pishock/shock-warning.js';
import {
  getAdminLimitConsent,
  findActivityShareByShocker,
  getCommandQueueEnabled,
  getCommandQueueSettings,
  getBudgetState,
  getConsent,
  getEffectivePersonLimit,
  getEmergencyStopShockerIds,
  getPersonalActivityLimits,
  getWearerSafety,
  isEmergencyStopped,
  isEmergencyStopLatched,
  isExecutorBanned,
  isGloballyBanned,
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
} from '../discord-location.js';
import { commandQueue } from '../pishock/command-queue-runtime.js';
import { CommandQueueError, type QueuedOperation } from '../pishock/command-queue.js';
import {
  getPiShockPauseState,
  rememberPiShockPaused,
  shockerPauseBlocks,
  type PiShockPauseState,
} from '../pishock/pause.js';
import { allActiveShockersEStopped } from '../pishock/estop-sync.js';
import {
  WearerGateError,
  applyEscalationCap,
  assertPersonAllows,
  buildEffectiveModes,
  checkBudget,
} from '../wearer-safety.js';
import {
  admitWearerCommand,
  cooldowns,
  escalation,
  recordWearerHit,
} from '../wearer-safety-runtime.js';
import type { PersonLimit } from '../wearer-safety-settings.js';
import {
  ADMIN_SOFT_GATES,
  hasLimitConsent,
  isAdmin,
  type BypassGate,
} from '../admin-bypass.js';
import { deviceOnlyModes } from '../wearer-safety.js';

type AdminAttempt = {
  targetDiscordUserId: string;
  operation: string;
  shockerId: number | null;
};

type ShareForModes = Parameters<typeof shareBandsFromRow>[0] & {
  deviceMaxIntensity: number;
  deviceMaxDurationMs: number;
};

/** Share ∩ wearer personal ∩ per-person (for this controller) ∩ device. */
function effectiveModes(
  share: ShareForModes,
  personalRow: Parameters<typeof personalBandsFromUser>[0],
  personLimit: PersonLimit | null,
) {
  const shareBands = shareBandsFromRow(share);
  const personal = personalBandsFromUser(personalRow);
  return buildEffectiveModes(
    shareBands,
    personal,
    { maxIntensity: share.deviceMaxIntensity, maxDurationMs: share.deviceMaxDurationMs },
    atLeastWarning(shareBands.requiredWarningLevel, personal.requiredWarningLevel),
    personLimit,
  );
}

/** Multishock fires share one batch id so cooldowns / approval prompts treat them as one. */
function batchIdFrom(req: { headers: Record<string, unknown> }, body: { batchId?: unknown }): string | null {
  const raw = body.batchId ?? req.headers['x-batch-id'];
  const id = typeof raw === 'string' ? raw.trim() : '';
  return /^[A-Za-z0-9_-]{6,64}$/.test(id) ? id : null;
}

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
  warningLevel?: WarningLevel | null;
  shareCode?: string | null;
  intensity: number;
  durationMs: number;
  success: boolean;
  detail: string;
  location?: ActivityLocationContext | null;
  /** Gates an admin bypassed for this command (empty = normal command). */
  bypassedGates?: BypassGate[];
}) {
  const loc = input.location;
  const bypassedGates = input.bypassedGates ?? [];
  const base = {
    executorDiscordUserId: input.executorDiscordUserId,
    targetDiscordUserId: input.targetDiscordUserId,
    action: input.action,
    shockerId: input.shockerId,
    shockerName: input.shockerName,
    hubClientId: input.hubClientId,
    hubName: input.hubName,
    warningLevel: input.warningLevel,
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
    adminBypass: bypassedGates.length > 0,
    bypassedGates,
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
    if (bypassedGates.length > 0) {
      broadcastRealtime(
        {
          type: 'admin_bypass',
          targetDiscordUserId: input.targetDiscordUserId,
          adminDiscordUserId: input.executorDiscordUserId,
          adminName: input.executorGlobalName ?? input.executorUsername ?? null,
          action: input.action,
          intensity: input.intensity,
          durationMs: input.durationMs,
          gates: bypassedGates,
          at: Date.now(),
        },
        { discordUserId: input.targetDiscordUserId },
      );
    }
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

  // Admin bypass attempts that were refused (E-STOP, block, pause…) are still logged.
  app.addHook('onResponse', async (req, reply) => {
    const attempt = (req as unknown as { adminBypassAttempt?: AdminAttempt }).adminBypassAttempt;
    if (!attempt || reply.statusCode < 400) return;
    await logCommand({
      discordUserId: attempt.targetDiscordUserId,
      executorDiscordUserId: req.discordUser.id,
      targetDiscordUserId: attempt.targetDiscordUserId,
      action: `participant_${attempt.operation}`,
      shockerId: attempt.shockerId ?? undefined,
      success: false,
      adminBypass: true,
      bypassedGates: [],
      detail: JSON.stringify({ adminBypass: 'refused', status: reply.statusCode }),
    }).catch(() => undefined);
  });

  app.post('/api/participants/status', async (req, reply) => {
    if (!req.hasConsent) {
      return reply.code(403).send({ error: 'Consent required', code: 'CONSENT_REQUIRED' });
    }

    const body = parseBody(participantsStatusBody, req, reply);
    if (!body) return reply;
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
      const [user, shares, blockedOrBanned, targetCreds, hasConsent, theirSettings, theyStarredMe, safety, appBanned] =
        await Promise.all([
          prisma.discordUser.findUnique({ where: { id } }),
          listEnabledActivityShares(id),
          isExecutorBanned(id, req.discordUser.id),
          loadPiShockCreds(opts.env, id),
          getConsent(id),
          getCommandQueueSettings(id),
          isQueueStarred(id, req.discordUser.id),
          getWearerSafety(id),
          isGloballyBanned(id),
        ]);
      // Banned from the app: shown as unavailable, not as "blocked you".
      const bannedYou = blockedOrBanned && !appBanned;
      const personLimit = await getEffectivePersonLimit(id, req.discordUser.id, safety);
      const budgetState = safety.budgetEnabled ? await getBudgetState(id, safety) : null;
      const budget = budgetState ? checkBudget(safety, budgetState, 0) : null;
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
      const ownerPersonalRow = await getPersonalActivityLimits(id);
      const eStops = new Set(await getEmergencyStopShockerIds(id));
      const active = shares.filter(
        (s: { enabled: boolean; paused: boolean }) => s.enabled && !s.paused,
      );
      const operable = active.filter(
        (s: { shockerId: number }) => !eStops.has(s.shockerId) && !shockerIsPaused(s.shockerId),
      );
      const allEStopped = allActiveShockersEStopped(active, eStops);
      const visibleShockers = blockedOrBanned
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
              maxIntensityStep?: number | null;
            }) => {
              const stopped = eStops.has(s.shockerId);
              const devicePaused = shockerIsPaused(s.shockerId);
              const bands = effectiveModes(s, ownerPersonalRow, personLimit);
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
                canShock: !stopped && !devicePaused && s.canShock && bands.personAllows.shock,
                canVibrate: !stopped && !devicePaused && s.canVibrate && bands.personAllows.vibrate,
                canBeep: !stopped && !devicePaused && s.canBeep && bands.personAllows.beep,
                maxIntensityStep: s.maxIntensityStep ?? null,
                canHold: !stopped && !devicePaused && s.canHold,
                paused: devicePaused || s.paused,
                emergencyStop: stopped,
              };
            },
          );
      return {
        discordUserId: id,
        username: user?.username ?? null,
        globalName: user?.globalName ?? null,
        avatar: user?.avatar ?? null,
        linked: hasSession,
        consent: hasConsent,
        available: hasSession && hasConsent && operable.length > 0 && !blockedOrBanned,
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
        /** Their extra-feature gates as they apply to the caller. */
        safety: {
          favoritesOnly: safety.favoritesOnly,
          approveEachCommand: safety.approveEachCommand,
          cooldownPerSenderMs: safety.cooldownPerSenderMs,
          cooldownGlobalMs: safety.cooldownGlobalMs,
          cooldownRemainingMs: theirSettings.enabled
            ? 0
            : cooldowns.retryAfter(
                id,
                req.discordUser.id,
                safety.cooldownPerSenderMs,
                safety.cooldownGlobalMs,
                null,
              ),
          budget: budget
            ? {
                exhausted: !budget.ok,
                remainingShocks: budget.ok ? budget.remainingShocks : 0,
                remainingShockMs: budget.ok ? budget.remainingShockMs : 0,
              }
            : null,
          /** True when the wearer set lower limits for the caller specifically. */
          personLimited: Boolean(personLimit),
          /** Others may spin the roulette wheel on them. */
          rouletteAllowed: safety.rouletteAllowed,
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
    const body = parseBody(participantOperateBody, req, reply);
    if (!body) return reply;
    const batchId = batchIdFrom(req, body);
    // Non-admins sending the flag are simply treated as normal commands.
    const asAdmin = body.adminBypass === true && isAdmin(opts.env.adminDiscordUserIds, req.discordUser.id);
    if (asAdmin) {
      (req as unknown as { adminBypassAttempt?: AdminAttempt }).adminBypassAttempt = {
        targetDiscordUserId: String((req.params as { targetDiscordUserId: string }).targetDiscordUserId),
        operation: String(body.operation ?? 'unknown'),
        shockerId: Number.isFinite(Number(body.shockerId)) ? Number(body.shockerId) : null,
      };
    }

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

    if (await isGloballyBanned(targetDiscordUserId)) {
      return reply.code(403).send({ error: 'This user is banned from the activity', code: 'TARGET_BANNED' });
    }
    if (await isExecutorBanned(targetDiscordUserId, req.discordUser.id)) {
      return reply.code(403).send({
        error: 'This user has blocked you from controlling their device',
        code: 'BANNED',
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
      cancelPendingHold(targetDiscordUserId, shockerId);
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

    const normalModes = effectiveModes(
      share,
      await getPersonalActivityLimits(targetDiscordUserId),
      await getEffectivePersonLimit(targetDiscordUserId, req.discordUser.id),
    );
    // Admin + the wearer's 3-step consent: only the PiShock device max applies.
    const limitOverride =
      asAdmin && hasLimitConsent(await getAdminLimitConsent(targetDiscordUserId));
    const modes = limitOverride
      ? deviceOnlyModes(
          { maxIntensity: share.deviceMaxIntensity, maxDurationMs: share.deviceMaxDurationMs },
          normalModes.requiredWarningLevel,
        )
      : normalModes;
    try {
      if (!limitOverride) assertPersonAllows(modes, operation);
    } catch (err) {
      if (err instanceof WearerGateError) return reply.code(err.status).send(err.toBody());
      throw err;
    }
    const band = bandForOperation(modes, operation);
    const normalBand = bandForOperation(normalModes, operation);
    const intensityCheck = Number(body.intensity ?? band.minIntensity);
    const durationCheck = Number(body.durationMs ?? clampDurationMs(undefined, band.maxDurationMs, band.minDurationMs));
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

    let intensity = clampIntensity(body.intensity, band.maxIntensity, band.minIntensity);
    const durationMs = clampDurationMs(body.durationMs, band.maxDurationMs, band.minDurationMs);
    let clampedReason: 'escalation' | null = null;
    const exceedsNormalLimits =
      limitOverride &&
      (intensity > normalBand.maxIntensity ||
        intensity < normalBand.minIntensity ||
        durationMs > normalBand.maxDurationMs ||
        durationMs < normalBand.minDurationMs ||
        !normalModes.personAllows[
          operation === 'vibrate' || operation === 'warning' ? 'vibrate' : operation === 'beep' ? 'beep' : 'shock'
        ]);
    if (!limitOverride && (operation === 'shock' || operation === 'hold')) {
      const capped = applyEscalationCap(
        intensity,
        escalation.cap(targetDiscordUserId, shockerId, share.maxIntensityStep, band.minIntensity),
      );
      intensity = capped.intensity;
      if (capped.clamped) clampedReason = 'escalation';
    }

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

    const queueEnabled = await getCommandQueueEnabled(targetDiscordUserId);
    let bypassedGates: BypassGate[] = [];
    try {
      const admission = await admitWearerCommand({
        ownerDiscordUserId: targetDiscordUserId,
        sender: {
          id: req.discordUser.id,
          username: req.discordUser.username ?? null,
          globalName: req.discordUser.global_name ?? null,
          avatar: req.discordUser.avatar ?? null,
        },
        operation,
        durationMs,
        batchId,
        queueEnabled,
        item: { shockerId, shockerName: share.shockerName ?? null, intensity, durationMs },
        bypass: asAdmin ? ADMIN_SOFT_GATES : undefined,
      });
      bypassedGates = [...admission.bypassed];
      if (exceedsNormalLimits) bypassedGates.push('limits');
    } catch (err) {
      if (err instanceof WearerGateError) return reply.code(err.status).send(err.toBody());
      throw err;
    }
    // Approval may have taken a while — the E-STOP latch always wins.
    if (await isEmergencyStopped(targetDiscordUserId, shockerId)) {
      return reply.code(423).send({
        error: 'Owner has emergency stop engaged',
        code: 'EMERGENCY_STOP',
      });
    }

    if (queueEnabled) {
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
      const jumpsLine = asAdmin && (await commandQueue.snapshot(targetDiscordUserId)).waiting.length > 0;
      if (jumpsLine) bypassedGates.push('queue');
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
            adminBypass: asAdmin,
            bypassedGates,
          },
          front: jumpsLine,
        });
        return {
          ok: true,
          queued: true,
          itemId: queued.itemId,
          position: queued.position,
          paused: queued.paused,
          estimatedWaitMs: queued.estimatedWaitMs,
          estimatedStartAt: queued.estimatedStartAt,
          clampedReason,
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

    let sentWarning: WarningLevel = 'none';
    try {
      if (hold && !clientId) {
        return reply.code(502).send({
          error: 'Hold requires a hub client id so it can be ended',
          code: 'BROKER_PUBLISH_FAILED',
        });
      }
      const pendingHold = hold ? beginPendingHold(targetDiscordUserId, shockerId) : null;
      sentWarning = await warnBeforeShock({
        operation,
        requestedWarningLevel,
        requiredWarningLevel: modes.requiredWarningLevel,
        canVibrate: share.canVibrate,
        creds: targetCreds,
        clientId: clientId ?? null,
        shockerId,
        ownerDiscordUserId: targetDiscordUserId,
        vibrateBand: modes.vibrate,
        gateOnShare: true,
      });
      if (pendingHold != null && !isPendingHoldCurrent(targetDiscordUserId, shockerId, pendingHold)) {
        return { ok: true, via: 'broker', canceled: true };
      }
      const shareNow = await findActivityShareByShocker(targetDiscordUserId, shockerId);
      if (!shareNow || !shareNow.enabled || shareNow.paused) {
        return reply.code(404).send({
          error: 'Share is not available',
          code: 'TARGET_UNAVAILABLE',
        });
      }
      try {
        assertModeAllowed(operation, hold, {
          canShock: shareNow.canShock,
          canVibrate: shareNow.canVibrate,
          canBeep: shareNow.canBeep,
          canHold: shareNow.canHold,
        });
      } catch (err) {
        if (err instanceof OperatePolicyError) {
          return reply.code(err.status).send({ error: err.message, code: err.code });
        }
        throw err;
      }
      const normalModesNow = effectiveModes(
        shareNow,
        await getPersonalActivityLimits(targetDiscordUserId),
        await getEffectivePersonLimit(targetDiscordUserId, req.discordUser.id),
      );
      // Consent can be revoked at any moment — re-check right before sending.
      const overrideNow =
        limitOverride && hasLimitConsent(await getAdminLimitConsent(targetDiscordUserId));
      const modesNow = overrideNow
        ? deviceOnlyModes(
            { maxIntensity: shareNow.deviceMaxIntensity, maxDurationMs: shareNow.deviceMaxDurationMs },
            normalModesNow.requiredWarningLevel,
          )
        : normalModesNow;
      if (!overrideNow) assertPersonAllows(modesNow, operation);
      if (operation === 'shock' || operation === 'hold') {
        const sentWarning = atLeastWarning(
          normalizeWarningLevel(body.warningLevel),
          modes.requiredWarningLevel,
        );
        if (warningRank(sentWarning) < warningRank(modesNow.requiredWarningLevel)) {
          throw new Error('Required warning changed before the shock was sent');
        }
      }
      const bandNow = bandForOperation(modesNow, operation);
      assertWithinCeilings(
        intensity,
        durationMs,
        bandNow.maxIntensity,
        bandNow.maxDurationMs,
        bandNow.minIntensity,
        bandNow.minDurationMs,
      );
      if (await isEmergencyStopped(targetDiscordUserId, shockerId)) {
        return reply.code(423).send({
          error: 'Owner has emergency stop engaged',
          code: 'EMERGENCY_STOP',
        });
      }
      if (await shockerPauseBlocks(targetDiscordUserId, targetCreds, shockerId)) {
        return reply.code(503).send({
          error: 'This shocker or share is paused on PiShock',
          code: 'PISHOCK_PAUSED',
        });
      }
      if (pendingHold != null && !isPendingHoldCurrent(targetDiscordUserId, shockerId, pendingHold)) {
        return { ok: true, via: 'broker', canceled: true };
      }
      if ((hold || warning) && clientId != null) {
        // Publish-time guard: a STOP that completed during an earlier await (e.g. the PiShock
        // pause lookup) must still block this command.
        if (isEmergencyStopLatched(targetDiscordUserId, shockerId)) {
          return reply.code(423).send({
            error: 'Owner has emergency stop engaged',
            code: 'EMERGENCY_STOP',
          });
        }
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
        if (pendingHold != null && shockerId != null && !isPendingHoldCurrent(targetDiscordUserId, shockerId, pendingHold)) {
          const ended = await publishOperate(targetCreds, {
            clientId: clientId!, shockerId, operation: 'e', intensity: 0, durationMs: 0,
            end: true, agentName: agent,
          });
          if (!ended) throw new Error('Failed to end canceled hold');
          return { ok: true, via: 'broker', canceled: true };
        }
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
            warningLevel: sentWarning,
            bypassedGates,
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
          await recordWearerHit({
            ownerDiscordUserId: targetDiscordUserId,
            shockerId,
            operation,
            intensity,
            durationMs,
          });
          return { ok: true, via: 'broker', path: 'target_session', clampedReason };
        }
        if (hold || warning) {
          return reply.code(502).send({
            error: 'Hold/warning requires broker; publish failed',
            code: 'BROKER_PUBLISH_FAILED',
          });
        }
      }

      if (hold) {
        return reply.code(502).send({
          error: 'Hold requires broker; publish failed',
          code: 'BROKER_PUBLISH_FAILED',
        });
      }

      // Publish-time guard: a STOP that completed during an earlier await (e.g. the PiShock
      // pause lookup) must still block this command.
      if (isEmergencyStopLatched(targetDiscordUserId, shockerId)) {
        return reply.code(423).send({
          error: 'Owner has emergency stop engaged',
          code: 'EMERGENCY_STOP',
        });
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
        warningLevel: sentWarning,
        bypassedGates,
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
      await recordWearerHit({
        ownerDiscordUserId: targetDiscordUserId,
        shockerId,
        operation,
        intensity,
        durationMs,
      });
      return { ok: true, via: 'operateById', path: 'target_session', clampedReason };
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
        warningLevel: sentWarning,
        bypassedGates,
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
      if (err instanceof WearerGateError) {
        return reply.code(err.status).send(err.toBody());
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
