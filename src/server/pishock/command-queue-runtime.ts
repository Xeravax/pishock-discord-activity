import type { AppEnv } from '../env.js';
import { broadcastRealtime } from '../realtime.js';
import { clearHoldAutoEnd, scheduleHoldAutoEnd } from '../operate-policy.js';
import {
  findActivityShareByShocker,
  getCommandQueueSettings,
  getConsent,
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
  operateByShare,
  PiShockApiError,
  type PiShockCreds,
} from './client.js';
import { getPiShockPausedShockerIds, rememberPiShockPaused } from './pause.js';
import { publishOperate } from './broker.js';
import { ShockerOp } from '../../shared/constants.js';
import {
  createCommandQueue,
  type QueueItemInternal,
  type QueueStatePublic,
  type QueuedOperation,
} from './command-queue.js';
import type { ActivityLocationContext } from '../discord-location.js';

export type QueuedOperatePayload = {
  env: AppEnv;
  location: ActivityLocationContext | null;
  /** Executor had a PiShock session at enqueue time; re-checked at run. */
  executorHadSession: boolean;
};

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
  if (settings.starOnly) {
    if (!(await isQueueStarred(item.ownerDiscordUserId, item.executorDiscordUserId))) {
      return false;
    }
  }
  if (await isExecutorBanned(item.ownerDiscordUserId, item.executorDiscordUserId)) {
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
      const paused = await getPiShockPausedShockerIds(item.ownerDiscordUserId, ownerCreds);
      if (paused.includes(item.shockerId)) return false;
    }
  }
  const shares = (await listEnabledActivityShares(item.ownerDiscordUserId)).filter(
    (s: { enabled: boolean; paused: boolean; shockerId: number }) =>
      s.enabled && !s.paused && s.shockerId === item.shockerId,
  );
  return shares.length > 0;
}

async function endQueuedItem(item: QueueItemInternal): Promise<void> {
  clearHoldAutoEnd(item.ownerDiscordUserId, item.shockerId);
  const payload = item.payload as QueuedOperatePayload | undefined;
  if (!payload?.env || !item.hubClientId) return;

  const targetCreds = await loadPiShockCreds(payload.env, item.ownerDiscordUserId);
  if (!targetCreds) return;

  let executorCreds: PiShockCreds | null = null;
  if (payload.executorHadSession) {
    executorCreds = await loadPiShockCreds(payload.env, item.executorDiscordUserId);
  }
  const useSharePath = Boolean(item.shareCode && executorCreds);
  const agent = agentNameForExecutor(
    executorLabel({
      id: item.executorDiscordUserId,
      username: item.executorUsername,
      globalName: item.executorGlobalName,
    }),
  );

  await publishOperate(useSharePath ? executorCreds! : targetCreds, {
    clientId: item.hubClientId,
    shockerId: item.shockerId,
    operation: 'e',
    intensity: 0,
    durationMs: 0,
    end: true,
    shareCode: useSharePath ? item.shareCode! : undefined,
    agentName: agent,
  });
}

async function executeQueuedItem(item: QueueItemInternal): Promise<void> {
  const payload = item.payload as QueuedOperatePayload | undefined;
  if (!payload?.env) {
    throw new Error('Missing queue payload');
  }

  const targetCreds = await loadPiShockCreds(payload.env, item.ownerDiscordUserId);
  if (!targetCreds) {
    throw new Error('Target unlinked');
  }

  let executorCreds: PiShockCreds | null = null;
  if (payload.executorHadSession) {
    executorCreds = await loadPiShockCreds(payload.env, item.executorDiscordUserId);
  }

  const shareCode = item.shareCode;
  const useSharePath = Boolean(shareCode && executorCreds);
  const clientId = item.hubClientId ?? undefined;
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
  const intensity = Math.max(1, item.intensity);
  const durationMs = item.durationMs;
  const location = payload.location;

  const shareMeta = await findActivityShareByShocker(item.ownerDiscordUserId, item.shockerId);

  const auditBase = {
    executorDiscordUserId: item.executorDiscordUserId,
    executorUsername: item.executorUsername,
    executorGlobalName: item.executorGlobalName,
    executorAvatar: item.executorAvatar,
    targetDiscordUserId: item.ownerDiscordUserId,
    action: `participant_${item.operation}`,
    shockerId: item.shockerId,
    shockerName: shareMeta?.shockerName ?? null,
    hubClientId: item.hubClientId ?? shareMeta?.hubClientId ?? null,
    hubName: shareMeta?.hubName ?? null,
    shareCode,
    intensity: item.intensity,
    durationMs,
    location,
  };

  try {
    if ((hold || warning) && clientId != null) {
      const published = await publishOperate(useSharePath ? executorCreds! : targetCreds, {
        clientId,
        shockerId: item.shockerId,
        operation: op,
        intensity,
        durationMs,
        hold,
        warning,
        end: false,
        shareCode: useSharePath ? shareCode! : undefined,
        agentName: agent,
      });
      if (published) {
        if (hold) {
          scheduleHoldAutoEnd(useSharePath ? executorCreds! : targetCreds, {
            ownerDiscordUserId: item.ownerDiscordUserId,
            shockerId: item.shockerId,
            clientId,
            durationMs,
            shareCode: useSharePath ? shareCode : null,
            agentName: agent,
          });
        }
        await auditParticipantCommand({
          ...auditBase,
          success: true,
          detail: JSON.stringify({
            via: 'broker',
            path: useSharePath ? 'executor_share' : 'target_session',
            agent,
            executor: item.executorDiscordUserId,
            target: item.ownerDiscordUserId,
            instanceId: item.instanceId,
            queued: true,
          }),
        });
        return;
      }
    }

    if (useSharePath) {
      await operateByShare(executorCreds!, shareCode!, op, intensity, durationMs, agent);
      await auditParticipantCommand({
        ...auditBase,
        success: true,
        detail: JSON.stringify({
          via: 'operateByShare',
          path: 'executor_share',
          agent,
          executor: item.executorDiscordUserId,
          target: item.ownerDiscordUserId,
          instanceId: item.instanceId,
          queued: true,
        }),
      });
      return;
    }

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
  } catch (err) {
    if (err instanceof PiShockApiError && err.status === 503) {
      rememberPiShockPaused(item.ownerDiscordUserId, {
        shockerId: item.shockerId,
        shareCode: item.shareCode,
      });
    }
    await auditParticipantCommand({
      ...auditBase,
      success: false,
      detail: JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
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
      at: Date.now(),
    },
    { discordUserId: state.ownerDiscordUserId },
  );
}

export const commandQueue = createCommandQueue({
  isStarred: (owner, executor) => isQueueStarred(owner, executor),
  getLimits: async (owner) => {
    const s = await getCommandQueueSettings(owner);
    return {
      progressMs: s.progressMs,
      maxPerSender: s.maxPerSender,
    };
  },
  validateBeforeRun: validateQueuedItem,
  execute: executeQueuedItem,
  endActive: endQueuedItem,
  onStateChange: emitQueueState,
  onTicket: (ticket) => {
    broadcastRealtime(ticket, { discordUserId: ticket.executorDiscordUserId });
  },
});
