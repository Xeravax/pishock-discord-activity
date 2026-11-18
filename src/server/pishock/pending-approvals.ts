/**
 * Approve-each mode: incoming commands wait (HTTP request held) until the wearer
 * accepts or denies them, or the timeout passes. All shockers of one multishock
 * fire (same sender + batchId) share a single prompt.
 *
 * In memory only — a restart drops pending prompts, which then resolve as expired
 * on the sender side because their HTTP request is gone too.
 */
import { randomUUID } from 'node:crypto';

export type ApprovalOutcome = 'accepted' | 'denied' | 'expired' | 'canceled';

export type ApprovalItem = {
  shockerId: number;
  shockerName: string | null;
  intensity: number;
  durationMs: number;
};

export type ApprovalSender = {
  id: string;
  username: string | null;
  globalName: string | null;
  avatar: string | null;
};

export type ApprovalRequestEvent = {
  type: 'approval_request';
  approvalId: string;
  ownerDiscordUserId: string;
  executorDiscordUserId: string;
  executorUsername: string | null;
  executorGlobalName: string | null;
  executorAvatar: string | null;
  operation: string;
  items: ApprovalItem[];
  expiresAt: number;
  at: number;
};

export type ApprovalResolvedEvent = {
  type: 'approval_resolved';
  approvalId: string;
  ownerDiscordUserId: string;
  executorDiscordUserId: string;
  outcome: ApprovalOutcome;
  at: number;
};

type Pending = {
  id: string;
  ownerId: string;
  sender: ApprovalSender;
  operation: string;
  batchKey: string | null;
  items: ApprovalItem[];
  expiresAt: number;
  createdAt: number;
  promise: Promise<ApprovalOutcome>;
  settle: (outcome: ApprovalOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** A batch only groups requests that arrive close together. */
export const APPROVAL_BATCH_WINDOW_MS = 2_000;

export type ApprovalCenterDeps = {
  now?: () => number;
  /** Deliver an event to the wearer (request) or wearer + sender (resolved). */
  emit: (event: ApprovalRequestEvent | ApprovalResolvedEvent, toUserIds: string[]) => void;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (t: ReturnType<typeof setTimeout>) => void;
};

export function createApprovalCenter(deps: ApprovalCenterDeps) {
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  });
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t));
  const pending = new Map<string, Pending>();

  function toEvent(p: Pending): ApprovalRequestEvent {
    return {
      type: 'approval_request',
      approvalId: p.id,
      ownerDiscordUserId: p.ownerId,
      executorDiscordUserId: p.sender.id,
      executorUsername: p.sender.username,
      executorGlobalName: p.sender.globalName,
      executorAvatar: p.sender.avatar,
      operation: p.operation,
      items: [...p.items],
      expiresAt: p.expiresAt,
      at: now(),
    };
  }

  function finish(p: Pending, outcome: ApprovalOutcome) {
    if (!pending.delete(p.id)) return;
    clearTimer(p.timer);
    p.settle(outcome);
    deps.emit(
      {
        type: 'approval_resolved',
        approvalId: p.id,
        ownerDiscordUserId: p.ownerId,
        executorDiscordUserId: p.sender.id,
        outcome,
        at: now(),
      },
      [p.ownerId, p.sender.id],
    );
  }

  function findBatch(ownerId: string, batchKey: string): Pending | undefined {
    for (const p of pending.values()) {
      if (p.ownerId === ownerId && p.batchKey === batchKey && now() - p.createdAt <= APPROVAL_BATCH_WINDOW_MS) {
        return p;
      }
    }
    return undefined;
  }

  return {
    /** Ask the wearer. Resolves with the outcome; never rejects. */
    request(input: {
      ownerDiscordUserId: string;
      sender: ApprovalSender;
      operation: string;
      batchId: string | null;
      item: ApprovalItem;
      timeoutMs: number;
    }): { approvalId: string; outcome: Promise<ApprovalOutcome> } {
      const batchKey = input.batchId ? `${input.sender.id}:${input.operation}:${input.batchId}` : null;
      const existing = batchKey ? findBatch(input.ownerDiscordUserId, batchKey) : undefined;
      if (existing) {
        existing.items.push(input.item);
        deps.emit(toEvent(existing), [existing.ownerId]);
        return { approvalId: existing.id, outcome: existing.promise };
      }

      let settle!: (o: ApprovalOutcome) => void;
      const promise = new Promise<ApprovalOutcome>((resolve) => {
        settle = resolve;
      });
      const id = randomUUID();
      const p: Pending = {
        id,
        ownerId: input.ownerDiscordUserId,
        sender: input.sender,
        operation: input.operation,
        batchKey,
        items: [input.item],
        createdAt: now(),
        expiresAt: now() + input.timeoutMs,
        promise,
        settle,
        timer: setTimer(() => {
          const live = pending.get(id);
          if (live) finish(live, 'expired');
        }, input.timeoutMs),
      };
      pending.set(id, p);
      deps.emit(toEvent(p), [p.ownerId]);
      return { approvalId: id, outcome: promise };
    },

    /** Wearer's answer. Returns false when the approval is unknown or not theirs. */
    resolve(ownerDiscordUserId: string, approvalId: string, accept: boolean): boolean {
      const p = pending.get(approvalId);
      if (!p || p.ownerId !== ownerDiscordUserId) return false;
      finish(p, accept ? 'accepted' : 'denied');
      return true;
    },

    /** E-STOP / turning approve-each off: close every open prompt for this wearer. */
    cancelAllFor(ownerDiscordUserId: string, outcome: ApprovalOutcome = 'canceled'): number {
      let n = 0;
      for (const p of [...pending.values()]) {
        if (p.ownerId === ownerDiscordUserId) {
          finish(p, outcome);
          n += 1;
        }
      }
      return n;
    },

    /** Open prompts for a wearer (client reload / PIP). */
    listFor(ownerDiscordUserId: string): ApprovalRequestEvent[] {
      return [...pending.values()].filter((p) => p.ownerId === ownerDiscordUserId).map(toEvent);
    },
  };
}

export type ApprovalCenter = ReturnType<typeof createApprovalCenter>;
