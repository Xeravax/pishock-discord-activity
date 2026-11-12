import {
  isPiShockRowPaused,
} from '../../shared/pishock-pause.js';
import { getShared, getShockers, type PiShockCreds } from './client.js';

const TTL_MS = 8_000;
/** Bound each PiShock pause source so a hung lookup cannot stall operate. */
const PAUSE_SOURCE_TIMEOUT_MS = 5_000;

type SourceIds = {
  shockerIds: Set<number>;
  shareCodes: Set<string>;
  /** False when this source has never returned successfully. */
  known: boolean;
};

type PauseCacheEntry = {
  at: number;
  shockers: SourceIds;
  shared: SourceIds;
  rememberedShockers: Set<number>;
  rememberedCodes: Set<string>;
};

export type PiShockPauseState = {
  shockerIds: number[];
  shareCodes: string[];
  /** A source timed out or failed and had no previous ids. Treat shockers as paused. */
  unknown: boolean;
};

const cache = new Map<string, PauseCacheEntry>();
const inflight = new Map<string, Promise<PauseCacheEntry>>();
const epochs = new Map<string, number>();

function emptySource(): SourceIds {
  return { shockerIds: new Set(), shareCodes: new Set(), known: false };
}

function emptyEntry(): PauseCacheEntry {
  return {
    at: 0,
    shockers: emptySource(),
    shared: emptySource(),
    rememberedShockers: new Set(),
    rememberedCodes: new Set(),
  };
}

function cloneSource(source: SourceIds): SourceIds {
  return {
    shockerIds: new Set(source.shockerIds),
    shareCodes: new Set(source.shareCodes),
    known: source.known,
  };
}

function shockerIdOf(row: Record<string, unknown>): number | null {
  const id = Number(row.ShockerId ?? row.shockerId ?? row.Id ?? row.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  return Math.floor(id);
}

function shareCodeOf(row: Record<string, unknown>): string | null {
  const code = row.ShareCode ?? row.shareCode ?? row.Code ?? row.code;
  if (typeof code !== 'string') return null;
  const trimmed = code.trim().toLowerCase();
  return trimmed || null;
}

export function pausedMarksFromRows(rows: unknown[]): {
  shockerIds: number[];
  shareCodes: string[];
} {
  const shockerIds = new Set<number>();
  const shareCodes = new Set<string>();
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    if (!isPiShockRowPaused(row)) continue;
    const id = shockerIdOf(row);
    if (id != null) shockerIds.add(id);
    const code = shareCodeOf(row);
    if (code) shareCodes.add(code);
  }
  return { shockerIds: [...shockerIds], shareCodes: [...shareCodes] };
}

function readList(data: unknown): unknown[] {
  return Array.isArray(data) ? data : [];
}

function withTimeout<T>(promise: Promise<T>, ms: number, abort?: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      abort?.();
      reject(new Error('pause source timeout'));
    }, ms);
    timer.unref?.();
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** A timeout or rejection keeps the previous ids. A successful payload replaces them. */
async function loadSource(
  prev: SourceIds,
  load: (signal: AbortSignal) => Promise<{ data?: unknown }>,
  toRows: (data: unknown) => unknown[],
): Promise<SourceIds> {
  const controller = new AbortController();
  try {
    const result = await withTimeout(
      load(controller.signal),
      PAUSE_SOURCE_TIMEOUT_MS,
      () => controller.abort(),
    );
    const marks = pausedMarksFromRows(toRows(result?.data));
    return {
      shockerIds: new Set(marks.shockerIds),
      shareCodes: new Set(marks.shareCodes),
      known: true,
    };
  } catch {
    if (prev.known) return cloneSource(prev);
    return emptySource();
  }
}

function pauseStateFromEntry(entry: PauseCacheEntry): PiShockPauseState {
  const unknown = !entry.shockers.known || !entry.shared.known;
  const shockerIds = new Set<number>([
    ...entry.shockers.shockerIds,
    ...entry.shared.shockerIds,
    ...entry.rememberedShockers,
  ]);
  const shareCodes = new Set<string>([
    ...entry.shockers.shareCodes,
    ...entry.shared.shareCodes,
    ...entry.rememberedCodes,
  ]);
  return { shockerIds: [...shockerIds], shareCodes: [...shareCodes], unknown };
}

async function refreshPiShockPause(
  discordUserId: string,
  creds: PiShockCreds,
  epoch: number,
): Promise<PauseCacheEntry> {
  const prev = cache.get(discordUserId) ?? emptyEntry();
  const prevRememberedShockers = new Set(prev.rememberedShockers);
  const prevRememberedCodes = new Set(prev.rememberedCodes);
  const [shockers, shared] = await Promise.all([
    loadSource(prev.shockers, (signal) => getShockers(creds, signal), readList),
    loadSource(prev.shared, (signal) => getShared(creds, signal), readList),
  ]);
  const current = cache.get(discordUserId);
  const rememberedShockers = new Set<number>(prevRememberedShockers);
  const rememberedCodes = new Set<string>(prevRememberedCodes);
  if (current) {
    for (const id of current.rememberedShockers) rememberedShockers.add(id);
    for (const code of current.rememberedCodes) rememberedCodes.add(code);
  }
  const addedDuringRefreshShockers = new Set<number>();
  for (const id of rememberedShockers) {
    if (!prevRememberedShockers.has(id)) addedDuringRefreshShockers.add(id);
  }
  const addedDuringRefreshCodes = new Set<string>();
  for (const code of rememberedCodes) {
    if (!prevRememberedCodes.has(code)) addedDuringRefreshCodes.add(code);
  }
  // Only when every source succeeds is the live set authoritative enough to
  // drop 503-remembered marks that no longer appear as paused. Marks added
  // while this refresh was in flight stay until a later refresh.
  if (shockers.known && shared.known) {
    const liveIds = new Set<number>([...shockers.shockerIds, ...shared.shockerIds]);
    for (const id of [...rememberedShockers]) {
      if (addedDuringRefreshShockers.has(id)) continue;
      if (!liveIds.has(id)) rememberedShockers.delete(id);
    }
    for (const code of [...rememberedCodes]) {
      if (addedDuringRefreshCodes.has(code)) continue;
      if (!shared.shareCodes.has(code)) rememberedCodes.delete(code);
    }
  }
  const entry: PauseCacheEntry = {
    at: Date.now(),
    shockers,
    shared,
    rememberedShockers,
    rememberedCodes,
  };
  if ((epochs.get(discordUserId) ?? 0) === epoch) {
    cache.set(discordUserId, entry);
  }
  return entry;
}

/**
 * Shockers and share codes PiShock currently reports as paused for this account.
 * One in-flight load is shared per user. Each source keeps its own id set.
 */
export async function loadPiShockPause(
  discordUserId: string,
  creds: PiShockCreds,
): Promise<PauseCacheEntry> {
  const hit = cache.get(discordUserId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;

  const existing = inflight.get(discordUserId);
  if (existing) return existing;

  const epoch = epochs.get(discordUserId) ?? 0;
  const pending = refreshPiShockPause(discordUserId, creds, epoch).finally(() => {
    if (inflight.get(discordUserId) === pending) inflight.delete(discordUserId);
  });
  inflight.set(discordUserId, pending);
  return pending;
}

export async function getPiShockPauseState(
  discordUserId: string,
  creds: PiShockCreds,
): Promise<PiShockPauseState> {
  return pauseStateFromEntry(await loadPiShockPause(discordUserId, creds));
}

/** True when this shocker must be treated as paused, including an unknown lookup. */
export async function shockerPauseBlocks(
  discordUserId: string,
  creds: PiShockCreds,
  shockerId: number,
): Promise<boolean> {
  try {
    const state = await getPiShockPauseState(discordUserId, creds);
    return state.unknown || state.shockerIds.includes(shockerId);
  } catch {
    return true;
  }
}

export async function getPiShockPausedShockerIds(
  discordUserId: string,
  creds: PiShockCreds,
): Promise<number[]> {
  const state = await getPiShockPauseState(discordUserId, creds);
  return state.shockerIds;
}

export async function isPiShockSharePaused(
  discordUserId: string,
  creds: PiShockCreds,
  shareCode: string,
): Promise<boolean> {
  const code = shareCode.trim().toLowerCase();
  if (!code) return false;
  try {
    const state = await getPiShockPauseState(discordUserId, creds);
    if (state.unknown) return true;
    return state.shareCodes.includes(code);
  } catch {
    return true;
  }
}

/** Stamp Paused:true onto owned shockers missing a pause flag but known paused. */
export function annotateShockersWithPause(
  shockers: unknown[],
  pausedIds: Iterable<number>,
): unknown[] {
  const paused = new Set(
    [...pausedIds].filter((id) => Number.isFinite(id) && id > 0).map((id) => Math.floor(id)),
  );
  if (paused.size === 0) return shockers;
  return shockers.map((raw) => {
    if (!raw || typeof raw !== 'object') return raw;
    const row = raw as Record<string, unknown>;
    const id = shockerIdOf(row);
    if (id == null || !paused.has(id) || isPiShockRowPaused(row)) return raw;
    return { ...row, Paused: true, isPaused: true };
  });
}

/** Remember a 503 so the next status refresh disables the control before PiShock lists it. */
export function rememberPiShockPaused(
  discordUserId: string,
  input: { shockerId?: number | null; shareCode?: string | null },
): void {
  const hit = cache.get(discordUserId) ?? emptyEntry();
  if (input.shockerId != null && Number.isFinite(input.shockerId) && input.shockerId > 0) {
    hit.rememberedShockers.add(Math.floor(input.shockerId));
  }
  const code = input.shareCode?.trim().toLowerCase();
  if (code) hit.rememberedCodes.add(code);
  if (hit.shockers.known && hit.shared.known) {
    hit.at = Date.now();
  }
  cache.set(discordUserId, hit);
}

export function forgetPiShockPaused(
  discordUserId: string,
  input: { shockerId?: number | null; shareCode?: string | null },
): void {
  const hit = cache.get(discordUserId);
  if (!hit) return;
  const dropId =
    input.shockerId != null && Number.isFinite(input.shockerId) && input.shockerId > 0
      ? Math.floor(input.shockerId)
      : null;
  const code = input.shareCode?.trim().toLowerCase() || null;
  if (dropId != null) {
    hit.rememberedShockers.delete(dropId);
    hit.shockers.shockerIds.delete(dropId);
    hit.shared.shockerIds.delete(dropId);
  }
  if (code) {
    hit.rememberedCodes.delete(code);
    hit.shockers.shareCodes.delete(code);
    hit.shared.shareCodes.delete(code);
  }
  if (hit.shockers.known && hit.shared.known) {
    hit.at = Date.now();
  }
}

export function invalidatePiShockPauseCache(discordUserId: string): void {
  cache.delete(discordUserId);
  inflight.delete(discordUserId);
  epochs.set(discordUserId, (epochs.get(discordUserId) ?? 0) + 1);
}
