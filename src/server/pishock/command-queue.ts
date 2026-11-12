import { randomUUID } from 'node:crypto';
import type { WarningLevel } from '../../shared/warning.js';
import { HOLD_AUTO_END_GRACE_MS } from '../operate-policy.js';

export const QUEUE_MAX_WAITING_TOTAL = 30;
/** Fallback when owner has not configured a per-sender waiting cap. */
export const QUEUE_MAX_WAITING_PER_SENDER = 3;
/** Owner-configured minimum time before the next queue item may start. */
export const QUEUE_PROGRESS_MIN_MS = 0;
export const QUEUE_PROGRESS_MAX_MS = 60_000;
export const QUEUE_MAX_PER_SENDER_MIN = 1;
/** Soft ceiling only — Prisma Int / abuse guard, not a product limit of 10. */
export const QUEUE_MAX_PER_SENDER_MAX = 1_000_000;

/**
 * How long the queue holds an item before advancing.
 * Never shorter than the command itself (plus hold grace), so ops don't overlap.
 */
export function resolveQueueAdvanceMs(durationMs: number, progressMs: number): number {
  const commandHold = Math.max(0, durationMs) + HOLD_AUTO_END_GRACE_MS;
  const configured = Math.max(
    QUEUE_PROGRESS_MIN_MS,
    Math.min(QUEUE_PROGRESS_MAX_MS, Math.floor(Number(progressMs) || 0)),
  );
  return Math.max(commandHold, configured);
}

export function clampQueueMaxPerSender(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return QUEUE_MAX_WAITING_PER_SENDER;
  return Math.max(QUEUE_MAX_PER_SENDER_MIN, Math.min(QUEUE_MAX_PER_SENDER_MAX, n));
}

export type QueueOwnerLimits = {
  progressMs: number;
  maxPerSender: number;
};

export type QueuedOperation = 'shock' | 'vibrate' | 'beep' | 'hold' | 'warning';

export type QueueItemPublic = {
  id: string;
  ownerDiscordUserId: string;
  executorDiscordUserId: string;
  executorUsername: string | null;
  executorGlobalName: string | null;
  executorAvatar: string | null;
  operation: QueuedOperation;
  intensity: number;
  durationMs: number;
  hold: boolean;
  warning: boolean;
  shockerId: number;
  enqueuedAt: number;
  priority: boolean;
};

export type QueueStatePublic = {
  ownerDiscordUserId: string;
  paused: boolean;
  /** When true, reject new enqueue; existing waiting/active items are kept. */
  halted: boolean;
  active: QueueItemPublic | null;
  /** Priority-ordered waiting list (starred first). */
  waiting: QueueItemPublic[];
  /** First waiting item, if any (same as waiting[0]). */
  next: QueueItemPublic | null;
  /** Ms until `next` may start (null when none / unknown). */
  nextStartsInMs: number | null;
  /** Wall-clock estimate for when `next` starts. */
  nextEstimatedStartAt: number | null;
};

export type QueueTicketEvent = {
  type: 'queue_ticket';
  ownerDiscordUserId: string;
  executorDiscordUserId: string;
  itemId: string;
  status: 'queued' | 'started' | 'done' | 'removed' | 'failed';
  position: number | null;
  paused: boolean;
  /** Estimated ms until this item starts (null when unknown / done). */
  estimatedWaitMs: number | null;
  /** Wall-clock estimate for when the item starts. */
  estimatedStartAt: number | null;
  at: number;
};

export type QueueEnqueueInput = {
  ownerDiscordUserId: string;
  executorDiscordUserId: string;
  executorUsername: string | null;
  executorGlobalName: string | null;
  executorAvatar: string | null;
  operation: QueuedOperation;
  intensity: number;
  durationMs: number;
  hold: boolean;
  warning: boolean;
  /** User-selected warning for a queued shock or hold. Execution raises it to the current requirement. */
  warningLevel?: WarningLevel;
  shockerId: number;
  shareCode: string | null;
  hubClientId: string | null;
  instanceId: string;
  /** Opaque payload kept for the executor (location, flags, etc.). */
  payload?: unknown;
};

export type QueueItemInternal = QueueEnqueueInput & {
  id: string;
  enqueuedAt: number;
  seq: number;
};

export class CommandQueueError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type CommandQueueDeps = {
  /** Whether this executor currently has priority for this owner. */
  isStarred: (ownerDiscordUserId: string, executorDiscordUserId: string) => boolean | Promise<boolean>;
  /** Owner queue timing / per-sender caps. */
  getLimits: (ownerDiscordUserId: string) => QueueOwnerLimits | Promise<QueueOwnerLimits>;
  /** Re-check before running a waiting item. Return false to drop it. */
  validateBeforeRun: (item: QueueItemInternal) => boolean | Promise<boolean>;
  /** Publish the command to the device. isCanceled is true after skip, clear, or emergency stop. */
  execute: (item: QueueItemInternal, isCanceled?: () => boolean) => Promise<void>;
  /**
   * Cut an active command short.
   * Return false when the device was not stopped; void/true means it was.
   */
  endActive: (item: QueueItemInternal) => Promise<boolean | void>;
  onStateChange: (state: QueueStatePublic) => void;
  onTicket: (ticket: QueueTicketEvent) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

type OwnerQueue = {
  paused: boolean;
  halted: boolean;
  waiting: QueueItemInternal[];
  active: QueueItemInternal | null;
  /** When the active item began occupying the slot (for ETA). */
  activeStartedAt: number | null;
  /** Planned advance hold for the active item. */
  activeAdvanceMs: number | null;
  /** Incremented to cancel in-flight sleep / advance loops. */
  generation: number;
  /** While set, skip and pump must not start the next waiting command. */
  advanceHeld: boolean;
  running: boolean;
  /** Resolvers waiting to interrupt the active duration sleep. */
  wake: Array<() => void>;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toPublic(item: QueueItemInternal, priority: boolean): QueueItemPublic {
  return {
    id: item.id,
    ownerDiscordUserId: item.ownerDiscordUserId,
    executorDiscordUserId: item.executorDiscordUserId,
    executorUsername: item.executorUsername,
    executorGlobalName: item.executorGlobalName,
    executorAvatar: item.executorAvatar,
    operation: item.operation,
    intensity: item.intensity,
    durationMs: item.durationMs,
    hold: item.hold,
    warning: item.warning,
    shockerId: item.shockerId,
    enqueuedAt: item.enqueuedAt,
    priority,
  };
}

/**
 * In-memory per-wearer command queue. Enabled/disabled is owned by the DB;
 * this module only serializes commands while the wearer has the queue on.
 */
export function createCommandQueue(deps: CommandQueueDeps) {
  const queues = new Map<string, OwnerQueue>();
  let seq = 0;
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? defaultSleep;

  function ensure(ownerDiscordUserId: string): OwnerQueue {
    let q = queues.get(ownerDiscordUserId);
    if (!q) {
      q = {
        paused: false,
        halted: false,
        waiting: [],
        active: null,
        activeStartedAt: null,
        activeAdvanceMs: null,
        generation: 0,
        advanceHeld: false,
        running: false,
        wake: [],
      };
      queues.set(ownerDiscordUserId, q);
    }
    return q;
  }

  function bumpGeneration(q: OwnerQueue): void {
    q.generation += 1;
    const waiters = q.wake.splice(0, q.wake.length);
    for (const resolve of waiters) resolve();
  }

  function clearActiveSlot(q: OwnerQueue): void {
    q.active = null;
    q.activeStartedAt = null;
    q.activeAdvanceMs = null;
  }

  async function sleepUntilDoneOrSkipped(ownerDiscordUserId: string, ms: number): Promise<void> {
    if (ms <= 0) return;
    const q = ensure(ownerDiscordUserId);
    await Promise.race([
      sleep(ms),
      new Promise<void>((resolve) => {
        q.wake.push(resolve);
      }),
    ]);
  }

  async function withPriorities(
    ownerDiscordUserId: string,
    items: QueueItemInternal[],
  ): Promise<QueueItemPublic[]> {
    const out: QueueItemPublic[] = [];
    for (const item of items) {
      const priority = Boolean(await deps.isStarred(ownerDiscordUserId, item.executorDiscordUserId));
      out.push(toPublic(item, priority));
    }
    return out;
  }

  async function snapshot(ownerDiscordUserId: string): Promise<QueueStatePublic> {
    const q = ensure(ownerDiscordUserId);
    const active = q.active
      ? toPublic(
          q.active,
          Boolean(await deps.isStarred(ownerDiscordUserId, q.active.executorDiscordUserId)),
        )
      : null;
    // One isStarred pass, then priority-order for UI / next-item ETA.
    const tagged = await withPriorities(ownerDiscordUserId, q.waiting);
    const byEnqueue = (a: QueueItemPublic, b: QueueItemPublic) => a.enqueuedAt - b.enqueuedAt;
    const waiting = [
      ...tagged.filter((item) => item.priority).sort(byEnqueue),
      ...tagged.filter((item) => !item.priority).sort(byEnqueue),
    ];
    const next = waiting[0] ?? null;
    const nextStartsInMs = next ? remainingActiveMs(q) : null;
    const nextEstimatedStartAt =
      nextStartsInMs == null ? null : now() + nextStartsInMs;
    return {
      ownerDiscordUserId,
      paused: q.paused,
      halted: q.halted,
      active,
      waiting,
      next,
      nextStartsInMs,
      nextEstimatedStartAt,
    };
  }

  async function emitState(ownerDiscordUserId: string): Promise<QueueStatePublic> {
    const state = await snapshot(ownerDiscordUserId);
    deps.onStateChange(state);
    return state;
  }

  function emitTicket(
    item: QueueItemInternal,
    status: QueueTicketEvent['status'],
    position: number | null,
    paused: boolean,
    eta?: { estimatedWaitMs: number | null; estimatedStartAt: number | null },
  ): void {
    deps.onTicket({
      type: 'queue_ticket',
      ownerDiscordUserId: item.ownerDiscordUserId,
      executorDiscordUserId: item.executorDiscordUserId,
      itemId: item.id,
      status,
      position,
      paused,
      estimatedWaitMs: eta?.estimatedWaitMs ?? (status === 'started' ? 0 : null),
      estimatedStartAt:
        eta?.estimatedStartAt ?? (status === 'started' ? now() : null),
      at: now(),
    });
  }

  function remainingActiveMs(q: OwnerQueue): number {
    if (!q.active || q.activeStartedAt == null || q.activeAdvanceMs == null) return 0;
    const elapsed = Math.max(0, now() - q.activeStartedAt);
    return Math.max(0, q.activeAdvanceMs - elapsed);
  }

  async function estimateWaitMs(
    ownerDiscordUserId: string,
    itemId: string,
  ): Promise<number | null> {
    const q = ensure(ownerDiscordUserId);
    const limits = await deps.getLimits(ownerDiscordUserId);
    if (q.active?.id === itemId) return 0;
    const ordered = await orderedWaiting(ownerDiscordUserId, q.waiting);
    const idx = ordered.findIndex((w) => w.id === itemId);
    if (idx < 0) return null;
    let wait = remainingActiveMs(q);
    for (let i = 0; i < idx; i++) {
      wait += resolveQueueAdvanceMs(ordered[i]!.durationMs, limits.progressMs);
    }
    return wait;
  }

  async function positionOf(ownerDiscordUserId: string, itemId: string): Promise<number | null> {
    const q = ensure(ownerDiscordUserId);
    if (q.active?.id === itemId) return 0;
    const ordered = await orderedWaiting(ownerDiscordUserId, q.waiting);
    const idx = ordered.findIndex((w) => w.id === itemId);
    return idx >= 0 ? idx + 1 : null;
  }

  async function notifyWaitingPositions(ownerDiscordUserId: string): Promise<void> {
    const q = ensure(ownerDiscordUserId);
    const ordered = await orderedWaiting(ownerDiscordUserId, q.waiting);
    const limits = await deps.getLimits(ownerDiscordUserId);
    let wait = remainingActiveMs(q);
    for (let i = 0; i < ordered.length; i++) {
      const item = ordered[i]!;
      const estimatedWaitMs = wait;
      emitTicket(item, 'queued', i + 1, q.paused, {
        estimatedWaitMs,
        estimatedStartAt: now() + estimatedWaitMs,
      });
      wait += resolveQueueAdvanceMs(item.durationMs, limits.progressMs);
    }
  }

  async function orderedWaiting(
    ownerDiscordUserId: string,
    waiting: QueueItemInternal[],
  ): Promise<QueueItemInternal[]> {
    const starred: QueueItemInternal[] = [];
    const open: QueueItemInternal[] = [];
    for (const item of waiting) {
      if (await deps.isStarred(ownerDiscordUserId, item.executorDiscordUserId)) {
        starred.push(item);
      } else {
        open.push(item);
      }
    }
    const bySeq = (a: QueueItemInternal, b: QueueItemInternal) => a.seq - b.seq;
    starred.sort(bySeq);
    open.sort(bySeq);
    return [...starred, ...open];
  }

  async function pickNext(ownerDiscordUserId: string): Promise<QueueItemInternal | null> {
    const q = ensure(ownerDiscordUserId);
    if (q.waiting.length === 0) return null;
    const ordered = await orderedWaiting(ownerDiscordUserId, q.waiting);
    const next = ordered[0] ?? null;
    if (!next) return null;
    q.waiting = q.waiting.filter((w) => w.id !== next.id);
    return next;
  }

  async function pump(ownerDiscordUserId: string): Promise<void> {
    const q = ensure(ownerDiscordUserId);
    if (q.running) return;
    q.running = true;
    try {
      while (true) {
        if (q.paused || q.advanceHeld) break;
        if (q.active) break;

        const gen = q.generation;
        const next = await pickNext(ownerDiscordUserId);
        if (!next) break;
        if (q.generation !== gen) {
          emitTicket(next, 'removed', null, q.paused, { estimatedWaitMs: null, estimatedStartAt: null });
          continue;
        }
        if (q.paused || q.advanceHeld) {
          q.waiting.push(next);
          break;
        }

        let ok = false;
        try {
          ok = await deps.validateBeforeRun(next);
        } catch {
          ok = false;
        }
        if (q.generation !== gen) {
          // hardClear / invalidate removed this item while it was off the waiting list.
          emitTicket(next, 'removed', null, q.paused, {
            estimatedWaitMs: null,
            estimatedStartAt: null,
          });
          continue;
        }
        if (!ok) {
          emitTicket(next, 'removed', null, q.paused, {
            estimatedWaitMs: null,
            estimatedStartAt: null,
          });
          await emitState(ownerDiscordUserId);
          await notifyWaitingPositions(ownerDiscordUserId);
          continue;
        }
        if (q.paused || q.advanceHeld) {
          q.waiting.push(next);
          break;
        }

        const limits = await deps.getLimits(ownerDiscordUserId);
        if (q.generation !== gen) {
          emitTicket(next, 'removed', null, q.paused, {
            estimatedWaitMs: null,
            estimatedStartAt: null,
          });
          continue;
        }
        if (q.paused || q.advanceHeld) {
          q.waiting.push(next);
          break;
        }
        const waitMs = resolveQueueAdvanceMs(next.durationMs, limits.progressMs);
        q.active = next;
        q.activeStartedAt = now();
        q.activeAdvanceMs = waitMs;
        emitTicket(next, 'started', 0, q.paused, {
          estimatedWaitMs: 0,
          estimatedStartAt: now(),
        });
        await emitState(ownerDiscordUserId);
        await notifyWaitingPositions(ownerDiscordUserId);

        let failed = false;
        try {
          await deps.execute(
            next,
            () => q.generation !== gen || q.active?.id !== next.id,
          );
        } catch {
          failed = true;
        }

        if (q.generation !== gen) {
          // Skip / emergency clear already handled tickets and cleared active.
          continue;
        }

        if (waitMs > 0 && !failed) {
          await sleepUntilDoneOrSkipped(ownerDiscordUserId, waitMs);
        }

        if (q.generation !== gen) {
          continue;
        }

        if (q.active?.id === next.id) {
          clearActiveSlot(q);
          emitTicket(next, failed ? 'failed' : 'done', null, q.paused, {
            estimatedWaitMs: null,
            estimatedStartAt: null,
          });
          await emitState(ownerDiscordUserId);
        }
      }
    } finally {
      q.running = false;
      // Another enqueue may have raced while we were leaving.
      if (!q.paused && !q.advanceHeld && !q.active && q.waiting.length > 0) {
        void pump(ownerDiscordUserId);
      }
    }
  }

  async function enqueue(input: QueueEnqueueInput): Promise<{
    itemId: string;
    position: number;
    paused: boolean;
    halted: boolean;
    estimatedWaitMs: number;
    estimatedStartAt: number;
    state: QueueStatePublic;
  }> {
    const q = ensure(input.ownerDiscordUserId);
    const limits = await deps.getLimits(input.ownerDiscordUserId);

    if (q.halted) {
      throw new CommandQueueError(
        'Their command queue is closed to new entries',
        423,
        'QUEUE_HALTED',
      );
    }

    if (q.waiting.length >= QUEUE_MAX_WAITING_TOTAL) {
      throw new CommandQueueError(
        'Command queue is full — try again shortly',
        429,
        'QUEUE_FULL',
      );
    }

    const senderWaiting = q.waiting.filter(
      (w) => w.executorDiscordUserId === input.executorDiscordUserId,
    );
    if (senderWaiting.length >= limits.maxPerSender) {
      throw new CommandQueueError(
        `You can only queue ${limits.maxPerSender} command${limits.maxPerSender === 1 ? '' : 's'} ahead for this person`,
        429,
        'QUEUE_SENDER_FULL',
      );
    }

    const item: QueueItemInternal = {
      ...input,
      id: randomUUID(),
      enqueuedAt: now(),
      seq: ++seq,
    };
    q.waiting.push(item);

    const state = await emitState(input.ownerDiscordUserId);
    const position = (await positionOf(input.ownerDiscordUserId, item.id)) ?? state.waiting.length;
    const estimatedWaitMs = (await estimateWaitMs(input.ownerDiscordUserId, item.id)) ?? 0;
    const estimatedStartAt = now() + estimatedWaitMs;
    emitTicket(item, 'queued', position, q.paused, { estimatedWaitMs, estimatedStartAt });
    await notifyWaitingPositions(input.ownerDiscordUserId);

    void pump(input.ownerDiscordUserId);

    return {
      itemId: item.id,
      position,
      paused: q.paused,
      halted: q.halted,
      estimatedWaitMs,
      estimatedStartAt,
      state,
    };
  }

  async function setPaused(ownerDiscordUserId: string, paused: boolean): Promise<QueueStatePublic> {
    const q = ensure(ownerDiscordUserId);
    q.paused = paused;
    const state = await emitState(ownerDiscordUserId);
    await notifyWaitingPositions(ownerDiscordUserId);
    if (!paused && !q.advanceHeld) void pump(ownerDiscordUserId);
    return state;
  }

  async function setHalted(ownerDiscordUserId: string, halted: boolean): Promise<QueueStatePublic> {
    const q = ensure(ownerDiscordUserId);
    q.halted = halted;
    return emitState(ownerDiscordUserId);
  }

  async function clearWaiting(ownerDiscordUserId: string): Promise<QueueStatePublic> {
    const q = ensure(ownerDiscordUserId);
    const removed = q.waiting.splice(0, q.waiting.length);
    for (const item of removed) {
      emitTicket(item, 'removed', null, q.paused);
    }
    return emitState(ownerDiscordUserId);
  }

  async function removeItem(
    ownerDiscordUserId: string,
    itemId: string,
  ): Promise<QueueStatePublic> {
    const q = ensure(ownerDiscordUserId);
    const idx = q.waiting.findIndex((w) => w.id === itemId);
    if (idx < 0) {
      throw new CommandQueueError('Queue item not found', 404, 'QUEUE_ITEM_NOT_FOUND');
    }
    const [item] = q.waiting.splice(idx, 1);
    if (item) emitTicket(item, 'removed', null, q.paused);
    await emitState(ownerDiscordUserId);
    await notifyWaitingPositions(ownerDiscordUserId);
    return snapshot(ownerDiscordUserId);
  }

  async function skipActive(
    ownerDiscordUserId: string,
  ): Promise<{ ended: boolean; state: QueueStatePublic }> {
    const q = ensure(ownerDiscordUserId);
    const active = q.active;
    if (!active) {
      return { ended: false, state: await emitState(ownerDiscordUserId) };
    }
    let ended = false;
    try {
      ended = (await deps.endActive(active)) !== false;
    } catch {
      ended = false;
    }
    if (!ended) {
      return { ended: false, state: await snapshot(ownerDiscordUserId) };
    }
    if (q.active !== active) {
      return { ended: true, state: await snapshot(ownerDiscordUserId) };
    }
    bumpGeneration(q);
    clearActiveSlot(q);
    emitTicket(active, 'removed', null, q.paused, {
      estimatedWaitMs: null,
      estimatedStartAt: null,
    });
    const state = await emitState(ownerDiscordUserId);
    if (!q.paused && !q.advanceHeld) void pump(ownerDiscordUserId);
    return { ended: true, state };
  }

  /**
   * Drop waiting items and cancel the active slot without waiting for duration.
   * Used by emergency stop and disabling the queue.
   */
  async function hardClear(
    ownerDiscordUserId: string,
    opts?: { endActiveDevice?: boolean },
  ): Promise<QueueStatePublic> {
    const q = ensure(ownerDiscordUserId);
    bumpGeneration(q);
    const removed = q.waiting.splice(0, q.waiting.length);
    for (const item of removed) {
      emitTicket(item, 'removed', null, q.paused, {
        estimatedWaitMs: null,
        estimatedStartAt: null,
      });
    }
    const active = q.active;
    clearActiveSlot(q);
    if (active) {
      if (opts?.endActiveDevice !== false) {
        try {
          await deps.endActive(active);
        } catch {
          // ignore
        }
      }
      emitTicket(active, 'removed', null, q.paused, {
        estimatedWaitMs: null,
        estimatedStartAt: null,
      });
    }
    return emitState(ownerDiscordUserId);
  }

  /**
   * Hold-release (`end`): if this sender's command is active, cut it short and advance.
   * If it is still waiting, remove it. Returns whether anything was handled.
   */
  async function handleSenderEnd(
    ownerDiscordUserId: string,
    executorDiscordUserId: string,
    shockerId: number,
  ): Promise<{ handled: boolean; ended: boolean; state: QueueStatePublic }> {
    const q = ensure(ownerDiscordUserId);
    if (
      q.active &&
      q.active.executorDiscordUserId === executorDiscordUserId &&
      q.active.shockerId === shockerId
    ) {
      const skipped = await skipActive(ownerDiscordUserId);
      return { handled: true, ended: skipped.ended, state: skipped.state };
    }

    const waitingMatch = q.waiting.find(
      (w) =>
        w.executorDiscordUserId === executorDiscordUserId &&
        w.shockerId === shockerId &&
        (w.hold || w.operation === 'hold'),
    );
    if (waitingMatch) {
      await removeItem(ownerDiscordUserId, waitingMatch.id);
      return { handled: true, ended: true, state: await snapshot(ownerDiscordUserId) };
    }

    return { handled: false, ended: false, state: await snapshot(ownerDiscordUserId) };
  }

  function holdAdvance(ownerDiscordUserId: string): void {
    ensure(ownerDiscordUserId).advanceHeld = true;
  }

  function releaseAdvance(ownerDiscordUserId: string): void {
    const q = queues.get(ownerDiscordUserId);
    if (!q) return;
    q.advanceHeld = false;
    if (!q.paused) void pump(ownerDiscordUserId);
  }

  /** Bump generation so an in-flight execute can see it was canceled before it publishes. */
  function invalidateInFlight(ownerDiscordUserId: string): void {
    const q = queues.get(ownerDiscordUserId);
    if (!q) return;
    bumpGeneration(q);
  }

  function getPaused(ownerDiscordUserId: string): boolean {
    return ensure(ownerDiscordUserId).paused;
  }

  function getHalted(ownerDiscordUserId: string): boolean {
    return ensure(ownerDiscordUserId).halted;
  }

  /** Test / shutdown helper. */
  function resetAll(): void {
    for (const q of queues.values()) {
      bumpGeneration(q);
      q.waiting = [];
      clearActiveSlot(q);
      q.paused = false;
      q.halted = false;
      q.advanceHeld = false;
      q.running = false;
    }
    queues.clear();
    seq = 0;
  }

  return {
    enqueue,
    setPaused,
    setHalted,
    clearWaiting,
    removeItem,
    skipActive,
    hardClear,
    holdAdvance,
    releaseAdvance,
    invalidateInFlight,
    handleSenderEnd,
    snapshot,
    getPaused,
    getHalted,
    resetAll,
  };
}

export type CommandQueue = ReturnType<typeof createCommandQueue>;
