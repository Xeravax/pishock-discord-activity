import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CommandQueueError,
  QUEUE_MAX_WAITING_PER_SENDER,
  QUEUE_MAX_WAITING_TOTAL,
  createCommandQueue,
  resolveQueueAdvanceMs,
  type QueueEnqueueInput,
  type QueueItemInternal,
  type QueueTicketEvent,
} from '../src/server/pishock/command-queue.js';
import { HOLD_AUTO_END_GRACE_MS } from '../src/server/operate-policy.js';

function baseInput(
  overrides: Partial<QueueEnqueueInput> &
    Pick<QueueEnqueueInput, 'ownerDiscordUserId' | 'executorDiscordUserId'>,
): QueueEnqueueInput {
  return {
    executorUsername: 'user',
    executorGlobalName: null,
    executorAvatar: null,
    operation: 'shock',
    intensity: 20,
    durationMs: 100,
    hold: false,
    warning: false,
    shockerId: 7,
    shareCode: null,
    hubClientId: 'hub-1',
    instanceId: 'inst',
    ...overrides,
  };
}

type Harness = {
  queue: ReturnType<typeof createCommandQueue>;
  executed: string[];
  ended: string[];
  tickets: QueueTicketEvent[];
  stars: Set<string>;
  advance: (ms: number) => Promise<void>;
  flush: () => Promise<void>;
  setProgressMs: (ms: number) => void;
};

function makeHarness(opts?: {
  validate?: (item: QueueItemInternal) => boolean | Promise<boolean>;
  progressMs?: number;
  maxPerSender?: number;
  maxSenderMs?: number;
}): Harness {
  let now = 1_000_000;
  const timers: Array<{ at: number; resolve: () => void }> = [];
  const executed: string[] = [];
  const ended: string[] = [];
  const tickets: QueueTicketEvent[] = [];
  const stars = new Set<string>();
  let progressMs = opts?.progressMs ?? 0;
  let maxPerSender = opts?.maxPerSender ?? QUEUE_MAX_WAITING_PER_SENDER;
  let maxSenderMs = opts?.maxSenderMs ?? 0;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      timers.push({ at: now + ms, resolve });
      timers.sort((a, b) => a.at - b.at);
    });

  const advance = async (ms: number) => {
    const target = now + ms;
    while (timers.length > 0 && timers[0]!.at <= target) {
      const t = timers.shift()!;
      now = t.at;
      t.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }
    now = target;
  };

  const flush = async () => {
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }
  };

  const queue = createCommandQueue({
    now: () => now,
    sleep,
    isStarred: (owner, executor) => stars.has(`${owner}:${executor}`),
    getLimits: () => ({ progressMs, maxPerSender, maxSenderMs }),
    validateBeforeRun: opts?.validate ?? (async () => true),
    execute: async (item) => {
      executed.push(item.id);
    },
    endActive: async (item) => {
      ended.push(item.id);
    },
    onStateChange: () => undefined,
    onTicket: (t) => tickets.push(t),
  });

  return {
    queue,
    executed,
    ended,
    tickets,
    stars,
    advance,
    flush,
    setProgressMs: (ms: number) => {
      progressMs = ms;
    },
  };
}

describe('command queue', () => {
  it('resolveQueueAdvanceMs never goes below command duration + grace', () => {
    assert.equal(resolveQueueAdvanceMs(100, 0), 100 + HOLD_AUTO_END_GRACE_MS);
    assert.equal(resolveQueueAdvanceMs(100, 50), 100 + HOLD_AUTO_END_GRACE_MS);
    assert.equal(resolveQueueAdvanceMs(100, 5_000), 5_000);
  });

  it('honors owner progressMs when longer than the command', async () => {
    const h = makeHarness({ progressMs: 1_000 });
    const first = await h.queue.enqueue(
      baseInput({ ownerDiscordUserId: 'owner', executorDiscordUserId: 'a', durationMs: 40 }),
    );
    const second = await h.queue.enqueue(
      baseInput({ ownerDiscordUserId: 'owner', executorDiscordUserId: 'b', durationMs: 40 }),
    );
    await h.flush();
    assert.equal(h.executed[0], first.itemId);
    await h.advance(300);
    await h.flush();
    assert.equal(h.executed.length, 1);
    await h.advance(800);
    await h.flush();
    assert.equal(h.executed[1], second.itemId);
  });

  it('runs starred senders before open-lane FIFO', async () => {
    const h = makeHarness();
    const a = await h.queue.enqueue(
      baseInput({ ownerDiscordUserId: 'owner', executorDiscordUserId: 'a', durationMs: 50 }),
    );
    const b = await h.queue.enqueue(
      baseInput({ ownerDiscordUserId: 'owner', executorDiscordUserId: 'b', durationMs: 50 }),
    );
    h.stars.add('owner:b');
    const c = await h.queue.enqueue(
      baseInput({ ownerDiscordUserId: 'owner', executorDiscordUserId: 'c', durationMs: 50 }),
    );
    await h.flush();

    // First item (a) may already be active before star of b matters for waiting.
    assert.equal(h.executed[0], a.itemId);
    await h.advance(400);
    await h.flush();
    // After a finishes, starred b should run before c (and any remaining).
    // c was enqueued after star; b was waiting and is now starred.
    assert.ok(h.executed.includes(b.itemId));
    const bIdx = h.executed.indexOf(b.itemId);
    const cIdx = h.executed.indexOf(c.itemId);
    if (cIdx >= 0) {
      assert.ok(bIdx < cIdx, 'starred b should run before open-lane c');
    }
  });

  it('keeps FIFO within a lane', async () => {
    const h = makeHarness();
    const first = await h.queue.enqueue(
      baseInput({ ownerDiscordUserId: 'owner', executorDiscordUserId: 'a', durationMs: 30 }),
    );
    const second = await h.queue.enqueue(
      baseInput({ ownerDiscordUserId: 'owner', executorDiscordUserId: 'b', durationMs: 30 }),
    );
    await h.flush();
    assert.equal(h.executed[0], first.itemId);
    await h.advance(400);
    await h.flush();
    assert.equal(h.executed[1], second.itemId);
  });

  it('pause stops advancing while still accepting new items', async () => {
    const h = makeHarness();
    await h.queue.enqueue(
      baseInput({ ownerDiscordUserId: 'owner', executorDiscordUserId: 'a', durationMs: 40 }),
    );
    await h.flush();
    await h.queue.setPaused('owner', true);
    const waiting = await h.queue.enqueue(
      baseInput({ ownerDiscordUserId: 'owner', executorDiscordUserId: 'b', durationMs: 40 }),
    );
    await h.advance(500);
    await h.flush();
    assert.equal(h.executed.length, 1);
    assert.equal(waiting.paused, true);

    await h.queue.setPaused('owner', false);
    await h.flush();
    await h.advance(500);
    await h.flush();
    assert.equal(h.executed.length, 2);
  });

  it('skip ends the active command and starts the next', async () => {
    const h = makeHarness();
    const first = await h.queue.enqueue(
      baseInput({ ownerDiscordUserId: 'owner', executorDiscordUserId: 'a', durationMs: 5_000 }),
    );
    const second = await h.queue.enqueue(
      baseInput({ ownerDiscordUserId: 'owner', executorDiscordUserId: 'b', durationMs: 40 }),
    );
    await h.flush();
    assert.equal(h.executed[0], first.itemId);
    await h.queue.skipActive('owner');
    await h.flush();
    await h.advance(0);
    await h.flush();
    assert.deepEqual(h.ended, [first.itemId]);
    assert.equal(h.executed[1], second.itemId);
  });

  it('clear drops waiting only', async () => {
    const h = makeHarness();
    const first = await h.queue.enqueue(
      baseInput({ ownerDiscordUserId: 'owner', executorDiscordUserId: 'a', durationMs: 5_000 }),
    );
    await h.queue.enqueue(
      baseInput({ ownerDiscordUserId: 'owner', executorDiscordUserId: 'b', durationMs: 40 }),
    );
    await h.flush();
    await h.queue.clearWaiting('owner');
    const state = await h.queue.snapshot('owner');
    assert.equal(state.active?.id, first.itemId);
    assert.equal(state.waiting.length, 0);
  });

  it('remove drops one waiting item', async () => {
    const h = makeHarness();
    await h.queue.enqueue(
      baseInput({ ownerDiscordUserId: 'owner', executorDiscordUserId: 'a', durationMs: 5_000 }),
    );
    const second = await h.queue.enqueue(
      baseInput({ ownerDiscordUserId: 'owner', executorDiscordUserId: 'b', durationMs: 40 }),
    );
    await h.flush();
    await h.queue.removeItem('owner', second.itemId);
    const state = await h.queue.snapshot('owner');
    assert.equal(state.waiting.length, 0);
  });

  it('enforces per-sender and total waiting caps', async () => {
    const h = makeHarness({ maxPerSender: QUEUE_MAX_WAITING_PER_SENDER });
    await h.queue.setPaused('owner', true);
    for (let i = 0; i < QUEUE_MAX_WAITING_PER_SENDER; i++) {
      await h.queue.enqueue(
        baseInput({ ownerDiscordUserId: 'owner', executorDiscordUserId: 'a', durationMs: 10 }),
      );
    }
    await assert.rejects(
      () =>
        h.queue.enqueue(
          baseInput({ ownerDiscordUserId: 'owner', executorDiscordUserId: 'a', durationMs: 10 }),
        ),
      (err: unknown) =>
        err instanceof CommandQueueError && err.code === 'QUEUE_SENDER_FULL',
    );

    h.queue.resetAll();
    await h.queue.setPaused('owner', true);
    for (let i = 0; i < QUEUE_MAX_WAITING_TOTAL; i++) {
      await h.queue.enqueue(
        baseInput({
          ownerDiscordUserId: 'owner',
          executorDiscordUserId: `u${i}`,
          durationMs: 10,
        }),
      );
    }
    await assert.rejects(
      () =>
        h.queue.enqueue(
          baseInput({
            ownerDiscordUserId: 'owner',
            executorDiscordUserId: 'overflow',
            durationMs: 10,
          }),
        ),
      (err: unknown) => err instanceof CommandQueueError && err.code === 'QUEUE_FULL',
    );
  });

  it('enforces max total queue time per sender', async () => {
    const h = makeHarness({ maxSenderMs: 500, progressMs: 400 });
    await h.queue.setPaused('owner', true);
    await h.queue.enqueue(
      baseInput({ ownerDiscordUserId: 'owner', executorDiscordUserId: 'a', durationMs: 100 }),
    );
    await assert.rejects(
      () =>
        h.queue.enqueue(
          baseInput({ ownerDiscordUserId: 'owner', executorDiscordUserId: 'a', durationMs: 100 }),
        ),
      (err: unknown) => err instanceof CommandQueueError && err.code === 'QUEUE_SENDER_TIME',
    );
  });

  it('returns an arrival estimate when enqueueing', async () => {
    const h = makeHarness({ progressMs: 1_000 });
    await h.queue.setPaused('owner', true);
    const first = await h.queue.enqueue(
      baseInput({ ownerDiscordUserId: 'owner', executorDiscordUserId: 'a', durationMs: 100 }),
    );
    const second = await h.queue.enqueue(
      baseInput({ ownerDiscordUserId: 'owner', executorDiscordUserId: 'b', durationMs: 100 }),
    );
    assert.equal(first.estimatedWaitMs, 0);
    assert.ok(second.estimatedWaitMs >= 1_000);
  });

  it('keeps separate queues per wearer', async () => {
    const h = makeHarness();
    await h.queue.setPaused('owner-a', true);
    await h.queue.setPaused('owner-b', true);
    await h.queue.enqueue(
      baseInput({ ownerDiscordUserId: 'owner-a', executorDiscordUserId: 'x', durationMs: 20 }),
    );
    await h.queue.enqueue(
      baseInput({ ownerDiscordUserId: 'owner-b', executorDiscordUserId: 'y', durationMs: 20 }),
    );
    const a = await h.queue.snapshot('owner-a');
    const b = await h.queue.snapshot('owner-b');
    assert.equal(a.waiting.length, 1);
    assert.equal(b.waiting.length, 1);
    assert.equal(a.waiting[0]?.executorDiscordUserId, 'x');
    assert.equal(b.waiting[0]?.executorDiscordUserId, 'y');
  });

  it('handleSenderEnd skips active hold from that sender', async () => {
    const h = makeHarness();
    const first = await h.queue.enqueue(
      baseInput({
        ownerDiscordUserId: 'owner',
        executorDiscordUserId: 'a',
        operation: 'hold',
        hold: true,
        durationMs: 5_000,
      }),
    );
    await h.flush();
    const result = await h.queue.handleSenderEnd('owner', 'a', 7);
    assert.equal(result.handled, true);
    assert.deepEqual(h.ended, [first.itemId]);
  });

  it('hardClear removes waiting and active', async () => {
    const h = makeHarness();
    await h.queue.enqueue(
      baseInput({ ownerDiscordUserId: 'owner', executorDiscordUserId: 'a', durationMs: 5_000 }),
    );
    await h.queue.enqueue(
      baseInput({ ownerDiscordUserId: 'owner', executorDiscordUserId: 'b', durationMs: 40 }),
    );
    await h.flush();
    await h.queue.hardClear('owner', { endActiveDevice: false });
    const state = await h.queue.snapshot('owner');
    assert.equal(state.active, null);
    assert.equal(state.waiting.length, 0);
  });

  it('drops items that fail validateBeforeRun', async () => {
    const h = makeHarness({
      validate: async (item) => item.executorDiscordUserId !== 'bad',
    });
    await h.queue.setPaused('owner', true);
    await h.queue.enqueue(
      baseInput({ ownerDiscordUserId: 'owner', executorDiscordUserId: 'bad', durationMs: 20 }),
    );
    const good = await h.queue.enqueue(
      baseInput({ ownerDiscordUserId: 'owner', executorDiscordUserId: 'good', durationMs: 20 }),
    );
    await h.queue.setPaused('owner', false);
    await h.flush();
    await h.advance(400);
    await h.flush();
    assert.deepEqual(h.executed, [good.itemId]);
  });
});
