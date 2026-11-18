import { randomUUID } from 'node:crypto';
import type { AppEnv } from '../env.js';
import { broadcastRealtime } from '../realtime.js';
import {
  assertModeAllowed,
  assertWithinCeilings,
  clearHoldAutoEnd,
  clampDurationMs,
  clampIntensity,
  resolveDeviceCeilingsFromPiShock,
  scheduleHoldAutoEnd,
} from '../operate-policy.js';
import { bandForOperation, personalBandsFromUser, shareBandsFromRow } from '../limit-bands.js';
import { atLeastWarning, normalizeWarningLevel, warningRank, type WarningLevel } from '../../shared/warning.js';
import {
  findActivityShareByShocker,
  getAdminLimitConsent,
  getCommandQueueSettings,
  getConsent,
  getEffectivePersonLimit,
  getPersonalActivityLimits,
  getWearerSafety,
  isEmergencyStopped,
  isExecutorBanned,
  isQueueStarred,
  listEnabledActivityShares,
  loadPiShockCreds,
  logCommand,
} from '../session.js';
import {
  agentNameForExecutor,
  operateById,
  piShockLogError,
  PiShockApiError,
  redactPiShockSecrets,
  type PiShockCreds,
} from './client.js';
import { rememberPiShockPaused, shockerPauseBlocks } from './pause.js';
import { warnBeforeShock } from './shock-warning.js';
import { publishOperate } from './broker.js';
import { ShockerOp } from '../../shared/constants.js';
import {
  createCommandQueue,
  type QueueEnqueueInput,
  type QueueItemInternal,
  type QueueStatePublic,
  type QueuedOperation,
} from './command-queue.js';
import type { ActivityLocationContext } from '../discord-location.js';
import {
  applyEscalationCap,
  assertPersonAllows,
  buildEffectiveModes,
  deviceOnlyModes,
} from '../wearer-safety.js';
import { hasLimitConsent, type BypassGate } from '../admin-bypass.js';
import {
  escalation,
  queuedItemWithinBudget,
  recordWearerHit,
  setCheckInMissedHandler,
} from '../wearer-safety-runtime.js';

export type QueuedOperatePayload = {
  env: AppEnv;
  location: ActivityLocationContext | null;
  /** Executor had a PiShock session at enqueue time; re-checked at run. */
  executorHadSession: boolean;
  /** Admin bypass was used at enqueue (admin verified server-side then). */
  adminBypass?: boolean;
  bypassedGates?: BypassGate[];
};

function bypassedFor(item: QueueItemInternal): BypassGate[] {
  return (item.payload as QueuedOperatePayload | undefined)?.bypassedGates ?? [];
}

function executorLabel(user: {
  username?: string | null;
  globalName?: string | null;
  global_name?: string | null;
  id: string;
}) {
  const name = user.globalName || user.global_name || user.username || 'unknown';
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

function queuedModes(
  share: Parameters<typeof shareBandsFromRow>[0] & { deviceMaxIntensity: number; deviceMaxDurationMs: number },
  personalRow: Parameters<typeof personalBandsFromUser>[0],
  personLimit: Awaited<ReturnType<typeof getEffectivePersonLimit>>,
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

function opFor(operation: QueuedOperation) {
  if (operation === 'shock' || operation === 'hold') return ShockerOp.Shock;
  if (operation === 'vibrate' || operation === 'warning') return ShockerOp.Vibrate;
  return ShockerOp.Beep;
}

async function validateQueuedItem(item: QueueItemInternal): Promise<boolean> {
  const settings = await getCommandQueueSettings(item.ownerDiscordUserId);
  if (!settings.enabled) {
    return false;
  }
  const bypassed = bypassedFor(item);
  if (settings.starOnly && !bypassed.includes('favorites')) {
    if (!(await isQueueStarred(item.ownerDiscordUserId, item.executorDiscordUserId))) {
      return false;
    }
  }
  if (await isExecutorBanned(item.ownerDiscordUserId, item.executorDiscordUserId)) {
    return false;
  }
  if (
    !bypassed.includes('budget') &&
    !(await queuedItemWithinBudget(item.ownerDiscordUserId, item.operation, item.durationMs))
  ) {
    return false;
  }
  if (!(await getConsent(item.ownerDiscordUserId))) {
    return false;
  }
  if (await isEmergencyStopped(item.ownerDiscordUserId, item.shockerId)) {
    return false;
  }
  const queuedPayload = item.payload as QueuedOperatePayload | undefined;
  if (queuedPayload?.env) {
    const ownerCreds = await loadPiShockCreds(queuedPayload.env, item.ownerDiscordUserId);
    if (ownerCreds) {
      if (await shockerPauseBlocks(item.ownerDiscordUserId, ownerCreds, item.shockerId)) {
        return false;
      }
    }
  }
  const shares = (await listEnabledActivityShares(item.ownerDiscordUserId)).filter(
    (s: { enabled: boolean; paused: boolean; shockerId: number }) =>
      s.enabled && !s.paused && s.shockerId === item.shockerId,
  );
  return shares.length > 0;
}

async function resolveQueueHubClientId(
  item: QueueItemInternal,
  creds: PiShockCreds,
): Promise<string | null> {
  const stored = item.hubClientId?.trim();
  if (stored) return stored;
  const share = await findActivityShareByShocker(item.ownerDiscordUserId, item.shockerId);
  const fromShare = share?.hubClientId?.trim();
  if (fromShare) return fromShare;
  try {
    const ceilings = await resolveDeviceCeilingsFromPiShock(creds, item.shockerId);
    return ceilings.hubClientId?.trim() || null;
  } catch (err) {
    console.warn(
      '[queue] hub lookup failed',
      redactPiShockSecrets(err instanceof Error ? err.message : String(err)),
    );
    return null;
  }
}

async function endQueuedItem(item: QueueItemInternal): Promise<boolean> {
  const payload = item.payload as QueuedOperatePayload | undefined;
  if (!payload?.env) return false;

  const targetCreds = await loadPiShockCreds(payload.env, item.ownerDiscordUserId);
  if (!targetCreds) return false;

  const clientId = await resolveQueueHubClientId(item, targetCreds);
  if (!clientId) {
    console.warn(
      `[queue] cannot end shocker ${item.shockerId} without a hub client id`,
    );
    return false;
  }

  const agent = agentNameForExecutor(
    executorLabel({
      id: item.executorDiscordUserId,
      username: item.executorUsername,
      globalName: item.executorGlobalName,
    }),
  );

  const published = await publishOperate(targetCreds, {
    clientId,
    shockerId: item.shockerId,
    operation: 'e',
    intensity: 0,
    durationMs: 0,
    end: true,
    agentName: agent,
  });
  if (published) clearHoldAutoEnd(item.ownerDiscordUserId, item.shockerId);
  return published;
}

async function executeQueuedItem(
  item: QueueItemInternal,
  isCanceled?: () => boolean,
): Promise<void> {
  const payload = item.payload as QueuedOperatePayload | undefined;
  if (!payload?.env) {
    throw new Error('Missing queue payload');
  }

  const targetCreds = await loadPiShockCreds(payload.env, item.ownerDiscordUserId);
  if (!targetCreds) {
    throw new Error('Target unlinked');
  }

  const clientId = await resolveQueueHubClientId(item, targetCreds);
  const agent = agentNameForExecutor(
    executorLabel({
      id: item.executorDiscordUserId,
      username: item.executorUsername,
      globalName: item.executorGlobalName,
    }),
  );
  const hold = item.hold || item.operation === 'hold';
  const warning = item.warning || item.operation === 'warning';
  const op = opFor(item.operation);
  const location = payload.location;

  const auditBase = {
    executorDiscordUserId: item.executorDiscordUserId,
    executorUsername: item.executorUsername,
    executorGlobalName: item.executorGlobalName,
    executorAvatar: item.executorAvatar,
    targetDiscordUserId: item.ownerDiscordUserId,
    action: `participant_${item.operation}`,
    shockerId: item.shockerId,
    shockerName: null as string | null,
    hubClientId: clientId,
    hubName: null as string | null,
    warningLevel: null as WarningLevel | null,
    shareCode: null as string | null,
    intensity: item.intensity,
    durationMs: item.durationMs,
    location,
    bypassedGates: bypassedFor(item),
  };

  try {
    const share = await findActivityShareByShocker(item.ownerDiscordUserId, item.shockerId);
    if (!share || !share.enabled || share.paused) {
      throw new Error('Share no longer allows this operation');
    }
    assertModeAllowed(item.operation, hold, {
      canShock: share.canShock,
      canVibrate: share.canVibrate,
      canBeep: share.canBeep,
      canHold: share.canHold,
    });
    const safety = await getWearerSafety(item.ownerDiscordUserId);
    const personLimit = await getEffectivePersonLimit(
      item.ownerDiscordUserId,
      item.executorDiscordUserId,
      safety,
    );
    const normalModes = queuedModes(
      share,
      await getPersonalActivityLimits(item.ownerDiscordUserId),
      personLimit,
    );
    // Admin limit override only while the wearer's consent still stands (it can be revoked).
    const limitOverride =
      Boolean(payload.adminBypass) &&
      hasLimitConsent(await getAdminLimitConsent(item.ownerDiscordUserId));
    const modes = limitOverride
      ? deviceOnlyModes(
          { maxIntensity: share.deviceMaxIntensity, maxDurationMs: share.deviceMaxDurationMs },
          normalModes.requiredWarningLevel,
        )
      : normalModes;
    if (!limitOverride) {
      assertPersonAllows(modes, item.operation);
      // Consent was revoked after enqueue: the command is clamped, so nothing exceeded limits.
      auditBase.bypassedGates = auditBase.bypassedGates.filter((g) => g !== 'limits');
    }
    const band = bandForOperation(modes, item.operation);
    let intensity = Math.max(
      1,
      clampIntensity(item.intensity, band.maxIntensity, band.minIntensity),
    );
    if (!limitOverride && (item.operation === 'shock' || item.operation === 'hold')) {
      intensity = applyEscalationCap(
        intensity,
        escalation.cap(item.ownerDiscordUserId, item.shockerId, share.maxIntensityStep, band.minIntensity),
      ).intensity;
    }
    const durationMs = clampDurationMs(item.durationMs, band.maxDurationMs, band.minDurationMs);
    auditBase.shockerName = share.shockerName ?? null;
    auditBase.hubClientId = clientId ?? share.hubClientId ?? null;
    auditBase.hubName = share.hubName ?? null;
    auditBase.intensity = intensity;
    auditBase.durationMs = durationMs;

    if (hold && !clientId) {
      throw new Error('Hold requires a hub client id so it can be ended');
    }

    if (isCanceled?.() || await isEmergencyStopped(item.ownerDiscordUserId, item.shockerId)) return;
    if (isCanceled?.()) return;
    const sentWarning = await warnBeforeShock({
      operation: item.operation,
      requestedWarningLevel: item.warningLevel,
      requiredWarningLevel: modes.requiredWarningLevel,
      canVibrate: share.canVibrate,
      creds: targetCreds,
      clientId,
      shockerId: item.shockerId,
      ownerDiscordUserId: item.ownerDiscordUserId,
      vibrateBand: modes.vibrate,
      gateOnShare: true,
    });
    auditBase.warningLevel = sentWarning === 'none' ? null : sentWarning;
    if (isCanceled?.()) return;

    const shareNow = await findActivityShareByShocker(item.ownerDiscordUserId, item.shockerId);
    if (!shareNow || !shareNow.enabled || shareNow.paused) {
      throw new Error('Share no longer allows this operation');
    }
    assertModeAllowed(item.operation, hold, {
      canShock: shareNow.canShock,
      canVibrate: shareNow.canVibrate,
      canBeep: shareNow.canBeep,
      canHold: shareNow.canHold,
    });
    const normalModesNow = queuedModes(
      shareNow,
      await getPersonalActivityLimits(item.ownerDiscordUserId),
      await getEffectivePersonLimit(item.ownerDiscordUserId, item.executorDiscordUserId),
    );
    const overrideNow =
      limitOverride && hasLimitConsent(await getAdminLimitConsent(item.ownerDiscordUserId));
    const modesNow = overrideNow
      ? deviceOnlyModes(
          { maxIntensity: shareNow.deviceMaxIntensity, maxDurationMs: shareNow.deviceMaxDurationMs },
          normalModesNow.requiredWarningLevel,
        )
      : normalModesNow;
    if (!overrideNow) assertPersonAllows(modesNow, item.operation);
    if (item.operation === 'shock' || item.operation === 'hold') {
      const sentWarning = atLeastWarning(
        normalizeWarningLevel(item.warningLevel),
        modes.requiredWarningLevel,
      );
      if (warningRank(sentWarning) < warningRank(modesNow.requiredWarningLevel)) {
        throw new Error('Required warning changed before the shock was sent');
      }
    }
    const bandNow = bandForOperation(modesNow, item.operation);
    assertWithinCeilings(
      intensity,
      durationMs,
      bandNow.maxIntensity,
      bandNow.maxDurationMs,
      bandNow.minIntensity,
      bandNow.minDurationMs,
    );
    if (isCanceled?.()) return;

    if ((hold || warning) && clientId != null) {
      const published = await publishOperate(targetCreds, {
        clientId,
        shockerId: item.shockerId,
        operation: op,
        intensity,
        durationMs,
        hold,
        warning,
        end: false,
        agentName: agent,
      });
      if (published) {
        if (hold) {
          scheduleHoldAutoEnd(targetCreds, {
            ownerDiscordUserId: item.ownerDiscordUserId,
            shockerId: item.shockerId,
            clientId,
            durationMs,
            shareCode: null,
            agentName: agent,
          });
        }
        await auditParticipantCommand({
          ...auditBase,
          success: true,
          detail: JSON.stringify({
            via: 'broker',
            path: 'target_session',
            agent,
            executor: item.executorDiscordUserId,
            target: item.ownerDiscordUserId,
            instanceId: item.instanceId,
            queued: true,
          }),
        });
        await recordWearerHit({
          ownerDiscordUserId: item.ownerDiscordUserId,
          shockerId: item.shockerId,
          operation: item.operation,
          intensity,
          durationMs,
        });
        return;
      }
    }

    if (hold) {
      throw new Error(
        clientId
          ? 'Failed to start hold on the hub'
          : 'Hold requires a hub client id so it can be ended',
      );
    }
    if (isCanceled?.()) return;
    await operateById(targetCreds, item.shockerId, op, intensity, durationMs, agent);
    await auditParticipantCommand({
      ...auditBase,
      success: true,
      detail: JSON.stringify({
        via: 'operateById',
        path: 'target_session',
        agent,
        executor: item.executorDiscordUserId,
        target: item.ownerDiscordUserId,
        instanceId: item.instanceId,
        queued: true,
      }),
    });
    await recordWearerHit({
      ownerDiscordUserId: item.ownerDiscordUserId,
      shockerId: item.shockerId,
      operation: item.operation,
      intensity,
      durationMs,
    });
  } catch (err) {
    if (err instanceof PiShockApiError && err.status === 503) {
      rememberPiShockPaused(item.ownerDiscordUserId, {
        shockerId: item.shockerId,
        shareCode: null,
      });
    }
    await auditParticipantCommand({
      ...auditBase,
      success: false,
      detail: JSON.stringify({
        error: piShockLogError(err),
        agent,
        executor: item.executorDiscordUserId,
        target: item.ownerDiscordUserId,
        instanceId: item.instanceId,
        queued: true,
      }),
    });
    throw err;
  }
}

async function emitQueueState(state: QueueStatePublic): Promise<void> {
  const settings = await getCommandQueueSettings(state.ownerDiscordUserId);
  broadcastRealtime(
    {
      type: 'queue_state',
      ownerDiscordUserId: state.ownerDiscordUserId,
      enabled: settings.enabled,
      progressMs: settings.progressMs,
      maxPerSender: settings.maxPerSender,
      starOnly: settings.starOnly,
      paused: state.paused,
      halted: state.halted,
      active: state.active,
      waiting: state.waiting,
      next: state.next,
      nextStartsInMs: state.nextStartsInMs,
      nextEstimatedStartAt: state.nextEstimatedStartAt,
      at: Date.now(),
    },
    { discordUserId: state.ownerDiscordUserId },
  );
}

export const commandQueue = createCommandQueue({
  isStarred: (owner, executor) => isQueueStarred(owner, executor),
  getLimits: async (owner) => {
    const [s, safety] = await Promise.all([getCommandQueueSettings(owner), getWearerSafety(owner)]);
    return {
      progressMs: s.progressMs,
      maxPerSender: s.maxPerSender,
      cooldownGlobalMs: safety.cooldownGlobalMs,
      cooldownPerSenderMs: safety.cooldownPerSenderMs,
    };
  },
  validateBeforeRun: validateQueuedItem,
  execute: executeQueuedItem,
  endActive: endQueuedItem,
  onStateChange: (state) => {
    // Fire-and-forget: a failed settings read must not become an unhandled rejection.
    emitQueueState(state).catch((err: unknown) => {
      console.error('[command-queue] failed to emit queue state', err);
    });
  },
  onTicket: (ticket) => {
    broadcastRealtime(ticket, { discordUserId: ticket.executorDiscordUserId });
  },
});

// Missed check-in: drop everything waiting and cut the active command short.
setCheckInMissedHandler(async (owner) => {
  await commandQueue.hardClear(owner);
});

/**
 * Send a command the server built itself (roulette results). It takes exactly the queued
 * path: with the wearer's queue on it is enqueued (and re-validated at dispatch);
 * otherwise it is re-validated now (consent, ban, favorites, budget, E-STOP, pause, share)
 * and run through executeQueuedItem (bands, per-person limits, escalation, warning,
 * ceilings, E-STOP re-check). Callers must run admitWearerCommand first.
 */
export async function submitServerCommand(
  input: QueueEnqueueInput,
  queueEnabled: boolean,
): Promise<'queued' | 'sent' | 'unavailable'> {
  if (queueEnabled) {
    await commandQueue.enqueue(input);
    return 'queued';
  }
  const item: QueueItemInternal = { ...input, id: randomUUID(), enqueuedAt: Date.now(), seq: 0 };
  if (!(await validateQueuedItem(item))) return 'unavailable';
  await executeQueuedItem(item);
  return 'sent';
}
