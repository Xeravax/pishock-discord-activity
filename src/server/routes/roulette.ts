import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { AppEnv } from '../env.js';
import { InstanceAuthError, verifyActivityInstance } from '../discord-instance.js';
import { resolveActivityLocation, type ActivityLocationContext, type ClientLocationHint } from '../discord-location.js';
import { broadcastToUsers, usersInInstance } from '../realtime.js';
import {
  getCommandQueueEnabled,
  getConsent,
  getEffectivePersonLimit,
  getPersonalActivityLimits,
  getWearerSafety,
  isExecutorBanned,
  listEnabledActivityShares,
  logCommand,
} from '../session.js';
import { atLeastWarning } from '../../shared/warning.js';
import { personalBandsFromUser, shareBandsFromRow } from '../limit-bands.js';
import { WearerGateError, buildEffectiveModes } from '../wearer-safety.js';
import { admitWearerCommand, escalation, registerEmergencyStopHook } from '../wearer-safety-runtime.js';
import {
  commandQueue,
  executeQueuedItem,
  validateQueuedItem,
  type QueuedOperatePayload,
} from '../pishock/command-queue-runtime.js';
import { CommandQueueError, type QueueItemInternal } from '../pishock/command-queue.js';
import {
  ROULETTE_ACTIONS,
  buildSegments,
  createRouletteCenter,
  type RouletteAction,
  type RouletteBands,
  type RouletteSegment,
  type SpinPayload,
} from '../roulette.js';

type SpinMeta = {
  env: AppEnv;
  instanceId: string;
  location: ActivityLocationContext | null;
  starter: { id: string; username: string | null; globalName: string | null; avatar: string | null };
  hubClientId: string | null;
  shockerName: string | null;
};

function emitResult(spin: SpinPayload, outcome: 'sent' | 'queued' | 'safe' | 'refused', message: string | null) {
  broadcastToUsers([...spin.viewers, spin.targetDiscordUserId], {
    type: 'roulette_result',
    spinId: spin.spinId,
    targetDiscordUserId: spin.targetDiscordUserId,
    outcome,
    message,
    at: Date.now(),
  });
}

/** The landed segment goes through every normal gate (approval, budget, E-STOP, queue…). */
async function executeSpin(spin: SpinPayload, segment: RouletteSegment): Promise<void> {
  const meta = spin.meta as SpinMeta;
  const owner = spin.targetDiscordUserId;
  if (!(await getWearerSafety(owner)).rouletteAllowed) {
    emitResult(spin, 'refused', 'They turned roulette off.');
    return;
  }
  if (segment.action === 'safe') {
    await logCommand({
      discordUserId: owner,
      executorDiscordUserId: meta.starter.id,
      targetDiscordUserId: owner,
      action: 'roulette_safe',
      shockerId: spin.shockerId,
      success: true,
      instanceId: meta.instanceId,
      detail: JSON.stringify({ roulette: spin.spinId, viewers: spin.viewers }),
    });
    emitResult(spin, 'safe', null);
    return;
  }

  const queueEnabled = await getCommandQueueEnabled(owner);
  try {
    await admitWearerCommand({
      ownerDiscordUserId: owner,
      sender: meta.starter,
      operation: segment.action,
      durationMs: segment.durationMs,
      batchId: null,
      queueEnabled,
      item: {
        shockerId: spin.shockerId,
        shockerName: meta.shockerName,
        intensity: segment.intensity,
        durationMs: segment.durationMs,
      },
    });
  } catch (err) {
    emitResult(spin, 'refused', err instanceof Error ? err.message : String(err));
    return;
  }

  const payload: QueuedOperatePayload = {
    env: meta.env,
    location: meta.location,
    executorHadSession: false,
  };
  const input = {
    ownerDiscordUserId: owner,
    executorDiscordUserId: meta.starter.id,
    executorUsername: meta.starter.username,
    executorGlobalName: meta.starter.globalName,
    executorAvatar: meta.starter.avatar,
    operation: segment.action,
    intensity: segment.intensity,
    durationMs: segment.durationMs,
    hold: false,
    warning: false,
    warningLevel: 'none' as const,
    shockerId: spin.shockerId,
    shareCode: null,
    hubClientId: meta.hubClientId,
    instanceId: meta.instanceId,
    payload,
  };
  try {
    if (queueEnabled) {
      await commandQueue.enqueue(input);
      emitResult(spin, 'queued', null);
      return;
    }
    const item: QueueItemInternal = { ...input, id: randomUUID(), enqueuedAt: Date.now(), seq: 0 };
    if (!(await validateQueuedItem(item))) {
      emitResult(spin, 'refused', 'Their shocker is not available right now.');
      return;
    }
    await executeQueuedItem(item);
    emitResult(spin, 'sent', null);
  } catch (err) {
    const message =
      err instanceof CommandQueueError || err instanceof WearerGateError || err instanceof Error
        ? err.message
        : String(err);
    emitResult(spin, 'refused', message);
  }
}

const roulette = createRouletteCenter({
  emitSpin: (spin) => {
    broadcastToUsers(spin.viewers, {
      type: 'roulette_spin',
      spinId: spin.spinId,
      targetDiscordUserId: spin.targetDiscordUserId,
      starterDiscordUserId: spin.starterDiscordUserId,
      segments: spin.segments,
      resultIndex: spin.resultIndex,
      startAt: spin.startAt,
      spinMs: spin.spinMs,
      at: Date.now(),
    });
  },
  emitVoteOpen: (vote) => {
    const actions = [...new Set(vote.segments.map((s) => s.action))];
    broadcastToUsers(usersInInstance(vote.instanceId), {
      type: 'roulette_vote_open',
      voteId: vote.voteId,
      targetDiscordUserId: vote.targetDiscordUserId,
      starterDiscordUserId: vote.starterDiscordUserId,
      actions,
      endsAt: vote.endsAt,
      at: Date.now(),
    });
  },
  emitVoteClosed: (vote, outcome, tally) => {
    broadcastToUsers([...usersInInstance(vote.instanceId), vote.targetDiscordUserId], {
      type: 'roulette_vote_closed',
      voteId: vote.voteId,
      targetDiscordUserId: vote.targetDiscordUserId,
      outcome,
      yes: tally.yes,
      no: tally.no,
      at: Date.now(),
    });
  },
  execute: executeSpin,
});

registerEmergencyStopHook((owner) => {
  roulette.cancelForTarget(owner);
});

export const rouletteRoutes: FastifyPluginAsync<{ env: AppEnv }> = async (app, opts) => {
  app.post('/api/roulette', async (req, reply) => {
    if (!req.hasConsent) {
      return reply.code(403).send({ error: 'Consent required', code: 'CONSENT_REQUIRED' });
    }
    const body = (req.body ?? {}) as {
      targetDiscordUserId?: string;
      shockerId?: number;
      actions?: unknown;
      mode?: string;
      instanceId?: string;
      locationHint?: ClientLocationHint | null;
    };
    const target = String(body.targetDiscordUserId ?? '');
    const instanceId = String(body.instanceId ?? '');
    if (!/^\d{1,25}$/.test(target) || target === req.discordUser.id) {
      return reply.code(400).send({ error: 'Pick someone else to spin for' });
    }
    let info = null;
    try {
      info = await verifyActivityInstance(opts.env, instanceId, {
        requireUserId: req.discordUser.id,
        requireUserIds: [target],
        allowMissingBot: true,
      });
    } catch (err) {
      if (err instanceof InstanceAuthError) {
        return reply.code(err.status).send({ error: err.message, code: 'INSTANCE_AUTH' });
      }
      throw err;
    }
    const safety = await getWearerSafety(target);
    if (!safety.rouletteAllowed) {
      return reply.code(403).send({ error: 'They have not turned roulette on', code: 'ROULETTE_OFF' });
    }
    if (!(await getConsent(target))) {
      return reply.code(403).send({ error: 'Target has not consented', code: 'TARGET_CONSENT' });
    }
    if (await isExecutorBanned(target, req.discordUser.id)) {
      return reply.code(403).send({ error: 'This user has blocked you', code: 'BANNED' });
    }
    const shares = (await listEnabledActivityShares(target)).filter((s) => s.enabled && !s.paused);
    const share = shares.find((s) => s.shockerId === Number(body.shockerId)) ?? shares[0];
    if (!share) {
      return reply.code(404).send({ error: 'They have no shocker available', code: 'TARGET_UNAVAILABLE' });
    }

    const shareBands = shareBandsFromRow(share);
    const personal = personalBandsFromUser(await getPersonalActivityLimits(target));
    const modes = buildEffectiveModes(
      shareBands,
      personal,
      { maxIntensity: share.deviceMaxIntensity, maxDurationMs: share.deviceMaxDurationMs },
      atLeastWarning(shareBands.requiredWarningLevel, personal.requiredWarningLevel),
      await getEffectivePersonLimit(target, req.discordUser.id, safety),
    );
    const bands: RouletteBands = {};
    if (share.canShock && modes.personAllows.shock) bands.shock = modes.shock;
    if (share.canVibrate && modes.personAllows.vibrate) bands.vibrate = modes.vibrate;
    if (share.canBeep && modes.personAllows.beep) bands.beep = modes.beep;
    const requested = (Array.isArray(body.actions) ? body.actions : ROULETTE_ACTIONS).filter(
      (a): a is RouletteAction => ROULETTE_ACTIONS.includes(a as RouletteAction),
    );
    const segments = buildSegments({
      actions: requested,
      bands,
      shockCap: escalation.cap(target, share.shockerId, share.maxIntensityStep, modes.shock.minIntensity),
    });
    if (!segments.length) {
      return reply.code(400).send({ error: 'None of the chosen actions are allowed for them' });
    }

    const meta: SpinMeta = {
      env: opts.env,
      instanceId,
      location: await resolveActivityLocation(opts.env, instanceId, info, body.locationHint ?? null),
      starter: {
        id: req.discordUser.id,
        username: req.discordUser.username ?? null,
        globalName: req.discordUser.global_name ?? null,
        avatar: req.discordUser.avatar ?? null,
      },
      hubClientId: share.hubClientId ?? null,
      shockerName: share.shockerName ?? null,
    };
    const base = {
      targetDiscordUserId: target,
      starterDiscordUserId: req.discordUser.id,
      shockerId: share.shockerId,
      segments,
      meta,
    };
    if (body.mode === 'vote') {
      try {
        const vote = roulette.startVote({ ...base, instanceId });
        return { ok: true, mode: 'vote', voteId: vote.voteId, endsAt: vote.endsAt };
      } catch (err) {
        return reply.code(409).send({ error: err instanceof Error ? err.message : String(err) });
      }
    }
    const spin = roulette.startSolo(base);
    return { ok: true, mode: 'solo', spinId: spin.spinId };
  });

  app.post('/api/roulette/:voteId/vote', async (req, reply) => {
    if (!req.hasConsent) {
      return reply.code(403).send({ error: 'Consent required', code: 'CONSENT_REQUIRED' });
    }
    const { voteId } = req.params as { voteId: string };
    const body = (req.body ?? {}) as { yes?: unknown };
    const vote = roulette.getVote(String(voteId));
    if (!vote) return reply.code(404).send({ error: 'This vote has ended' });
    if (!usersInInstance(vote.instanceId).includes(req.discordUser.id)) {
      return reply.code(403).send({ error: 'Only people in this activity can vote' });
    }
    const tally = roulette.vote(vote.voteId, req.discordUser.id, body.yes === true);
    if (!tally) return reply.code(403).send({ error: 'The wearer can veto but not vote' });
    return { ok: true, tally };
  });

  app.post('/api/roulette/:voteId/veto', async (req, reply) => {
    const { voteId } = req.params as { voteId: string };
    if (!roulette.veto(String(voteId), req.discordUser.id)) {
      return reply.code(404).send({ error: 'Nothing to veto' });
    }
    return { ok: true };
  });
};
