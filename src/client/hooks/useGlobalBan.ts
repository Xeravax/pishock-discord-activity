import { useSyncExternalStore } from 'react';

/** App-wide ban set by an admin. Once known, the app shows only the ban screen. */
export type GlobalBanInfo = {
  id: string;
  reason: string;
  createdAt: string;
  expiresAt: string | null;
  appealUrl?: string | null;
};

let current: GlobalBanInfo | null = null;
const listeners = new Set<() => void>();

export function markGloballyBanned(ban: GlobalBanInfo) {
  if (current?.id === ban.id && current.appealUrl === (ban.appealUrl ?? current.appealUrl)) return;
  current = { ...ban, appealUrl: ban.appealUrl ?? current?.appealUrl ?? null };
  for (const l of listeners) l();
}

export function getGlobalBan(): GlobalBanInfo | null {
  return current;
}

/** Test helper: clear the in-memory ban so cases stay isolated. */
export function clearGlobalBan() {
  if (!current) return;
  current = null;
  for (const l of listeners) l();
}

export function useGlobalBan(): GlobalBanInfo | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => current,
  );
}
