import { randomUUID } from 'node:crypto';
import { HOLD_AUTO_END_GRACE_MS } from '../operate-policy.js';

export const QUEUE_MAX_WAITING_TOTAL = 30;
export const QUEUE_MAX_WAITING_PER_SENDER = 3;

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
  active: QueueItemPublic | null;
  waiting: QueueItemPublic[];
};

export type QueueTicketEvent = {
  type: 'queue_ticket';
  ownerDiscordUserId: string;
  executorDiscordUserId: string;
  itemId: string;
  status: 'queued' | 'started' | 'done' | 'removed' | 'failed';
  position: number | null;
  paused: boolean;
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
  /** Re-check before running a waiting item. Return false to drop it. */
  validateBeforeRun: (item: QueueItemInternal) => boolean | Promise<boolean>;
  /** Publish the command to the device. */
  execute: (item: QueueItemInternal) => Promise<void>;
  /** Cut an active command short (broker end). */
  endActive: (item: QueueItemInternal) => Promise<void>;
  onStateChange: (state: QueueStatePublic) => void;
  onTicket: (ticket: QueueTicketEvent) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

type OwnerQueue = {
  paused: boolean;
  waiting: QueueItemInternal[];
  active: QueueItemInternal | null;
  /** Incremented to cancel in-flight sleep / advance loops. */
  generation: number;
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
        waiting: [],
        active: null,
        generation: 0,
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
    const waiting = await withPriorities(ownerDiscordUserId, q.waiting);
    return {
      ownerDiscordUserId,
      paused: q.paused,
      active,
      waiting,
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
  ): void {
    deps.onTicket({
      type: 'queue_ticket',
      ownerDiscordUserId: item.ownerDiscordUserId,
      executorDiscordUserId: item.executorDiscordUserId,
      itemId: item.id,
      status,
      position,
      paused,
      at: now(),
    });
  }

  async function positionOf(ownerDiscordUserId: string, itemId: string): Promise<number | null> {
    const state = await snapshot(ownerDiscordUserId);
    if (state.active?.id === itemId) return 0;
    const idx = state.waiting.findIndex((w) => w.id === itemId);
    return idx >= 0 ? idx + 1 : null;
  }

  async function notifyWaitingPositions(ownerDiscordUserId: string): Promise<void> {
    const q = ensure(ownerDiscordUserId);
    const ordered = await orderedWaiting(ownerDiscordUserId, q.waiting);
    for (let i = 0; i < ordered.length; i++) {
      emitTicket(ordered[i]!, 'queued', i + 1, q.paused);
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
        if (q.paused) break;
        if (q.active) break;

        const next = await pickNext(ownerDiscordUserId);
        if (!next) break;

        const gen = q.generation;
        const ok = await deps.validateBeforeRun(next);
        if (!ok) {
          emitTicket(next, 'removed', null, q.paused);
          await emitState(ownerDiscordUserId);
          await notifyWaitingPositions(ownerDiscordUserId);
          continue;
        }

        q.active = next;
        emitTicket(next, 'started', 0, q.paused);
        await emitState(ownerDiscordUserId);
        await notifyWaitingPositions(ownerDiscordUserId);

        let failed = false;
        try {
          await deps.execute(next);
        } catch {
          failed = true;
        }

        if (q.generation !== gen) {
          // Skip / emergency clear already handled tickets and cleared active.
          continue;
        }

        const waitMs = Math.max(0, next.durationMs + HOLD_AUTO_END_GRACE_MS);
        if (waitMs > 0 && !failed) {
          await sleepUntilDoneOrSkipped(ownerDiscordUserId, waitMs);
        }

        if (q.generation !== gen) {
          continue;
        }

        if (q.active?.id === next.id) {
          q.active = null;
          emitTicket(next, failed ? 'failed' : 'done', null, q.paused);
          await emitState(ownerDiscordUserId);
        }
      }
    } finally {
      q.running = false;
      // Another enqueue may have raced while we were leaving.
      if (!q.paused && !q.active && q.waiting.length > 0) {
        void pump(ownerDiscordUserId);
      }
    }
  }

  async function enqueue(input: QueueEnqueueInput): Promise<{
    itemId: string;
    position: number;
    paused: boolean;
    state: QueueStatePublic;
  }> {
    const q = ensure(input.ownerDiscordUserId);
    if (q.waiting.length >= QUEUE_MAX_WAITING_TOTAL) {
      throw new CommandQueueError(
        'Command queue is full — try again shortly',
        429,
        'QUEUE_FULL',
      );
    }
    const fromSender = q.waiting.filter(
      (w) => w.executorDiscordUserId === input.executorDiscordUserId,
    ).length;
    if (fromSender >= QUEUE_MAX_WAITING_PER_SENDER) {
      throw new CommandQueueError(
        'Too many of your commands are already waiting',
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
    emitTicket(item, 'queued', position, q.paused);
    await notifyWaitingPositions(input.ownerDiscordUserId);

    void pump(input.ownerDiscordUserId);

    return { itemId: item.id, position, paused: q.paused, state };
  }

  async function setPaused(ownerDiscordUserId: string, paused: boolean): Promise<QueueStatePublic> {
    const q = ensure(ownerDiscordUserId);
    q.paused = paused;
    const state = await emitState(ownerDiscordUserId);
    if (!paused) void pump(ownerDiscordUserId);
    return state;
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

  async function skipActive(ownerDiscordUserId: string): Promise<QueueStatePublic> {
    const q = ensure(ownerDiscordUserId);
    const active = q.active;
    if (!active) {
      return emitState(ownerDiscordUserId);
    }
    bumpGeneration(q);
    q.active = null;
    try {
      await deps.endActive(active);
    } catch {
      // Device may already be idle.
    }
    emitTicket(active, 'removed', null, q.paused);
    const state = await emitState(ownerDiscordUserId);
    if (!q.paused) void pump(ownerDiscordUserId);
    return state;
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
      emitTicket(item, 'removed', null, q.paused);
    }
    const active = q.active;
    q.active = null;
    if (active) {
      if (opts?.endActiveDevice !== false) {
        try {
          await deps.endActive(active);
        } catch {
          // ignore
        }
      }
      emitTicket(active, 'removed', null, q.paused);
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
  ): Promise<{ handled: boolean; state: QueueStatePublic }> {
    const q = ensure(ownerDiscordUserId);
    if (
      q.active &&
      q.active.executorDiscordUserId === executorDiscordUserId &&
      q.active.shockerId === shockerId
    ) {
      await skipActive(ownerDiscordUserId);
      return { handled: true, state: await snapshot(ownerDiscordUserId) };
    }

    const waitingMatch = q.waiting.find(
      (w) =>
        w.executorDiscordUserId === executorDiscordUserId &&
        w.shockerId === shockerId &&
        (w.hold || w.operation === 'hold'),
    );
    if (waitingMatch) {
      await removeItem(ownerDiscordUserId, waitingMatch.id);
      return { handled: true, state: await snapshot(ownerDiscordUserId) };
    }

    return { handled: false, state: await snapshot(ownerDiscordUserId) };
  }

  function getPaused(ownerDiscordUserId: string): boolean {
    return ensure(ownerDiscordUserId).paused;
  }

  /** Test / shutdown helper. */
  function resetAll(): void {
    for (const q of queues.values()) {
      bumpGeneration(q);
      q.waiting = [];
      q.active = null;
      q.paused = false;
      q.running = false;
    }
    queues.clear();
    seq = 0;
  }

  return {
    enqueue,
    setPaused,
    clearWaiting,
    removeItem,
    skipActive,
    hardClear,
    handleSenderEnd,
    snapshot,
    getPaused,
    resetAll,
  };
}

export type CommandQueue = ReturnType<typeof createCommandQueue>;
