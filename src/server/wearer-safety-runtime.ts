/**
 * Production wiring for wearer safety gates: singletons (cooldowns, escalation,
 * approvals, check-ins) bound to the DB and realtime hub.
 */
import {
  broadcastRealtime,
  broadcastRealtimeAll,
  broadcastToUsers,
  onPresenceChange,
  onlineUserIds,
} from './realtime.js';
import {
  addBudgetUsage,
  getBudgetState,
  getLastSeenAt,
  getWearerSafety,
  hasActiveShares,
  isQueueStarred,
  pauseAllActiveShares,
  resetBudget,
  touchLastSeen,
} from './session.js';
import {
  WearerGateError,
  budgetExhaustedAfter,
  checkBudget,
  checkWearerGates,
  createCooldownTracker,
  createEscalationTracker,
  isShockOperation,
  sessionBudgetShouldReset,
  type SafetyGate,
} from './wearer-safety.js';
import type { WearerSafetySettings } from './wearer-safety-settings.js';
import { createApprovalCenter, type ApprovalItem, type ApprovalSender } from './pishock/pending-approvals.js';
import { createCheckInManager } from './checkin-manager.js';

export const cooldowns = createCooldownTracker();
export const escalation = createEscalationTracker();

export const approvals = createApprovalCenter({
  emit: (event, toUserIds) => broadcastToUsers(toUserIds, event),
});

/** Shocker ids paused by a missed check-in, so "Resume" only undoes that pause. */
const pausedByCheckIn = new Map<string, number[]>();

export function takeCheckInPausedIds(ownerDiscordUserId: string): number[] {
  const ids = pausedByCheckIn.get(ownerDiscordUserId) ?? [];
  pausedByCheckIn.delete(ownerDiscordUserId);
  return ids;
}

let onCheckInMissed: ((ownerDiscordUserId: string) => Promise<void>) | null = null;

/** Queue clearing lives in the queue runtime; it registers itself here to avoid an import cycle. */
export function setCheckInMissedHandler(fn: (ownerDiscordUserId: string) => Promise<void>) {
  onCheckInMissed = fn;
}

export const checkIns = createCheckInManager({
  getSettings: async (owner) => {
    const s = await getWearerSafety(owner);
    return { enabled: s.checkInEnabled, intervalMs: s.checkInIntervalMs, graceMs: s.checkInGraceMs };
  },
  hasActiveShares,
  onDue: (owner, deadline) => {
    broadcastRealtime(
      { type: 'checkin_due', ownerDiscordUserId: owner, deadline, at: Date.now() },
      { discordUserId: owner },
    );
  },
  onMissed: async (owner) => {
    const ids = await pauseAllActiveShares(owner);
    pausedByCheckIn.set(owner, [...new Set([...(pausedByCheckIn.get(owner) ?? []), ...ids])]);
    approvals.cancelAllFor(owner);
    await onCheckInMissed?.(owner);
    broadcastRealtime(
      { type: 'checkin_missed', ownerDiscordUserId: owner, at: Date.now() },
      { discordUserId: owner },
    );
    broadcastRealtimeAll({
      type: 'activity_share_changed',
      ownerDiscordUserId: owner,
      reason: 'availability',
      at: Date.now(),
    });
  },
});

export type AdmitInput = {
  ownerDiscordUserId: string;
  sender: ApprovalSender;
  operation: string;
  durationMs: number;
  batchId: string | null;
  queueEnabled: boolean;
  item: ApprovalItem;
  bypass?: ReadonlySet<SafetyGate>;
};

export type Admission = {
  settings: WearerSafetySettings;
  bypassed: SafetyGate[];
  approved: boolean;
};

/**
 * Run favorites / cooldown / budget gates, then wait for approval when the wearer
 * has approve-each on. Throws WearerGateError on refusal. Records the cooldown slot
 * when admitted (queue-off only — the queue spaces its own items).
 */
export async function admitWearerCommand(input: AdmitInput): Promise<Admission> {
  const owner = input.ownerDiscordUserId;
  const settings = await getWearerSafety(owner);
  const gate = await checkWearerGates(
    {
      settings,
      isFavorite: () => isQueueStarred(owner, input.sender.id),
      getBudget: () => getBudgetState(owner, settings),
      cooldowns,
    },
    {
      ownerDiscordUserId: owner,
      executorDiscordUserId: input.sender.id,
      operation: input.operation,
      durationMs: input.durationMs,
      batchId: input.batchId,
      queueEnabled: input.queueEnabled,
      bypass: input.bypass,
    },
  );

  // Reserve the cooldown slot before waiting on approval so a sender can't stack prompts.
  if (!input.queueEnabled) cooldowns.record(owner, input.sender.id, input.batchId);

  let approved = false;
  if (gate.needsApproval) {
    const { outcome } = approvals.request({
      ownerDiscordUserId: owner,
      sender: input.sender,
      operation: input.operation,
      batchId: input.batchId,
      item: input.item,
      timeoutMs: settings.approvalTimeoutMs,
    });
    const result = await outcome;
    if (result === 'denied') {
      throw new WearerGateError('They declined this command', 403, 'APPROVAL_DENIED');
    }
    if (result === 'expired') {
      throw new WearerGateError('They did not respond in time', 408, 'APPROVAL_TIMEOUT');
    }
    if (result === 'canceled') {
      throw new WearerGateError('Approval was canceled', 423, 'APPROVAL_CANCELED');
    }
    approved = true;
  }
  return { settings, bypassed: gate.bypassed, approved };
}

/** Dispatch-time budget re-check for queued items (they were admitted earlier). */
export async function queuedItemWithinBudget(
  ownerDiscordUserId: string,
  operation: string,
  durationMs: number,
): Promise<boolean> {
  if (!isShockOperation(operation)) return true;
  const settings = await getWearerSafety(ownerDiscordUserId);
  if (!settings.budgetEnabled) return true;
  return checkBudget(settings, await getBudgetState(ownerDiscordUserId, settings), durationMs).ok;
}

/** After a command was delivered: budget usage + escalation baseline. */
export async function recordWearerHit(input: {
  ownerDiscordUserId: string;
  shockerId: number;
  operation: string;
  intensity: number;
  durationMs: number;
}): Promise<void> {
  if (!isShockOperation(input.operation)) return;
  escalation.record(input.ownerDiscordUserId, input.shockerId, input.intensity);
  const settings = await getWearerSafety(input.ownerDiscordUserId);
  if (!settings.budgetEnabled) return;
  const before = await getBudgetState(input.ownerDiscordUserId, settings);
  const after = await addBudgetUsage(input.ownerDiscordUserId, input.durationMs);
  if (!budgetExhaustedAfter(settings, before) && budgetExhaustedAfter(settings, after)) {
    broadcastRealtime(
      {
        type: 'budget_exhausted',
        ownerDiscordUserId: input.ownerDiscordUserId,
        usedShocks: after.usedShocks,
        usedShockMs: after.usedShockMs,
        at: Date.now(),
      },
      { discordUserId: input.ownerDiscordUserId },
    );
    broadcastRealtimeAll({ type: 'participants_invalidate', reason: 'budget', at: Date.now() });
  }
}

/** E-STOP engaged: close all open approval prompts for this wearer. */
export function onWearerEmergencyStop(ownerDiscordUserId: string): void {
  approvals.cancelAllFor(ownerDiscordUserId);
}

const LAST_SEEN_INTERVAL_MS = 60_000;
let started = false;

/** Presence → session budget refill, last-seen tracking, check-in timers. */
export function startWearerSafetyRuntime(): () => void {
  if (started) return () => undefined;
  started = true;

  const offPresence = onPresenceChange((change) => {
    const id = change.discordUserId;
    if (change.online) {
      void (async () => {
        const [settings, lastSeenAt] = await Promise.all([getWearerSafety(id), getLastSeenAt(id)]);
        if (settings.budgetEnabled && sessionBudgetShouldReset(settings, lastSeenAt, new Date())) {
          await resetBudget(id);
        }
        await touchLastSeen(id);
        await checkIns.refresh(id);
      })().catch((err) => {
        console.warn('[safety] presence online handler failed', err instanceof Error ? err.message : err);
      });
    } else {
      checkIns.stop(id);
      void touchLastSeen(id);
    }
  });

  const timer = setInterval(() => {
    const at = new Date();
    for (const id of onlineUserIds()) void touchLastSeen(id, at);
  }, LAST_SEEN_INTERVAL_MS);
  timer.unref?.();

  return () => {
    offPresence();
    clearInterval(timer);
    started = false;
  };
}
