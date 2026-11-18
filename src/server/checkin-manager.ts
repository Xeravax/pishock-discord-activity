/**
 * Check-ins: while a wearer is online with active shares, ask "Still OK?" every
 * interval. The app beeps (never the shocker); if nobody answers within the grace
 * period, all of their shares are paused and their queue is cleared.
 *
 * Timers are server-side so a frozen or closed client still fails safe.
 */

export type CheckInSettings = {
  enabled: boolean;
  intervalMs: number;
  graceMs: number;
};

export type CheckInDeps = {
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (t: ReturnType<typeof setTimeout>) => void;
  getSettings: (ownerId: string) => Promise<CheckInSettings>;
  /** At least one enabled, unpaused share — otherwise there is nothing to protect. */
  hasActiveShares: (ownerId: string) => Promise<boolean>;
  onDue: (ownerId: string, deadline: number) => void;
  onMissed: (ownerId: string) => Promise<void>;
};

type OwnerState = {
  dueTimer: ReturnType<typeof setTimeout> | null;
  missTimer: ReturnType<typeof setTimeout> | null;
  deadline: number | null;
  /** Bumped on every (re)arm so stale async continuations bail out. */
  generation: number;
};

export function createCheckInManager(deps: CheckInDeps) {
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  });
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t));
  const owners = new Map<string, OwnerState>();

  function state(ownerId: string): OwnerState {
    let s = owners.get(ownerId);
    if (!s) {
      s = { dueTimer: null, missTimer: null, deadline: null, generation: 0 };
      owners.set(ownerId, s);
    }
    return s;
  }

  function clearTimers(s: OwnerState) {
    if (s.dueTimer) clearTimer(s.dueTimer);
    if (s.missTimer) clearTimer(s.missTimer);
    s.dueTimer = null;
    s.missTimer = null;
    s.deadline = null;
  }

  async function arm(ownerId: string): Promise<void> {
    const s = state(ownerId);
    clearTimers(s);
    const gen = ++s.generation;
    const settings = await deps.getSettings(ownerId);
    if (s.generation !== gen) return;
    if (!settings.enabled || !(await deps.hasActiveShares(ownerId))) return;
    if (s.generation !== gen) return;
    s.dueTimer = setTimer(() => {
      if (s.generation !== gen) return;
      s.dueTimer = null;
      const deadline = now() + settings.graceMs;
      s.deadline = deadline;
      deps.onDue(ownerId, deadline);
      s.missTimer = setTimer(() => {
        if (s.generation !== gen) return;
        s.missTimer = null;
        s.deadline = null;
        s.generation += 1;
        void deps.onMissed(ownerId).catch((err) => {
          console.warn('[checkin] pause after missed check-in failed', err instanceof Error ? err.message : err);
        });
      }, settings.graceMs);
    }, settings.intervalMs);
  }

  return {
    /** Wearer came online, changed settings, or changed shares. */
    refresh(ownerId: string): Promise<void> {
      return arm(ownerId);
    },
    /** Wearer answered "I'm OK" — restart the interval. Returns false when nothing was pending. */
    async ack(ownerId: string): Promise<boolean> {
      const s = owners.get(ownerId);
      const wasPending = Boolean(s?.deadline);
      await arm(ownerId);
      return wasPending;
    },
    /** Wearer went offline. */
    stop(ownerId: string): void {
      const s = owners.get(ownerId);
      if (!s) return;
      s.generation += 1;
      clearTimers(s);
      owners.delete(ownerId);
    },
    /** Pending deadline, if a check-in is currently open. */
    pendingDeadline(ownerId: string): number | null {
      return owners.get(ownerId)?.deadline ?? null;
    },
  };
}

export type CheckInManager = ReturnType<typeof createCheckInManager>;
