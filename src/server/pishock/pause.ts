import {
  isPiShockRowPaused,
} from '../../shared/pishock-pause.js';
import {
  getShared,
  getShockers,
  getUserDevices,
  type PiShockCreds,
} from './client.js';

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
  devices: SourceIds;
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
    devices: emptySource(),
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

/** Flatten GetUserDevices clients → shockers (with isPaused). */
export function shockersFromUserDevices(data: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(data)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const client of data) {
    if (!client || typeof client !== 'object') continue;
    const row = client as Record<string, unknown>;
    const nested = row.shockers ?? row.Shockers;
    if (!Array.isArray(nested)) continue;
    for (const s of nested) {
      if (!s || typeof s !== 'object') continue;
      const shocker = s as Record<string, unknown>;
      const id =
        shocker.shockerId ??
        shocker.ShockerId ??
        shocker.id ??
        shocker.Id;
      out.push({
        ...shocker,
        ShockerId: id,
        // Normalize common website flag onto our pause detector keys.
        isPaused: shocker.isPaused ?? shocker.IsPaused ?? shocker.paused ?? shocker.Paused,
        Paused: shocker.Paused ?? shocker.paused ?? shocker.isPaused ?? shocker.IsPaused,
      });
    }
  }
  return out;
}

function readList(data: unknown): unknown[] {
  return Array.isArray(data) ? data : [];
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('pause source timeout')), ms);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** A timeout or rejection keeps the previous ids. A successful payload replaces them. */
async function loadSource(
  prev: SourceIds,
  load: () => Promise<{ data?: unknown }>,
  toRows: (data: unknown) => unknown[],
): Promise<SourceIds> {
  try {
    const result = await withTimeout(load(), PAUSE_SOURCE_TIMEOUT_MS);
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
  const unknown = !entry.shockers.known || !entry.shared.known || !entry.devices.known;
  const shockerIds = new Set<number>([
    ...entry.shockers.shockerIds,
    ...entry.shared.shockerIds,
    ...entry.devices.shockerIds,
    ...entry.rememberedShockers,
  ]);
  const shareCodes = new Set<string>([
    ...entry.shockers.shareCodes,
    ...entry.shared.shareCodes,
    ...entry.devices.shareCodes,
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
  const [shockers, shared, devices] = await Promise.all([
    loadSource(prev.shockers, () => getShockers(creds), readList),
    loadSource(prev.shared, () => getShared(creds), readList),
    loadSource(prev.devices, () => getUserDevices(creds), shockersFromUserDevices),
  ]);
  const entry: PauseCacheEntry = {
    at: Date.now(),
    shockers,
    shared,
    devices,
    rememberedShockers: new Set(prev.rememberedShockers),
    rememberedCodes: new Set(prev.rememberedCodes),
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
  if (hit.shockers.known && hit.shared.known && hit.devices.known) {
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
    hit.devices.shockerIds.delete(dropId);
  }
  if (code) {
    hit.rememberedCodes.delete(code);
    hit.shockers.shareCodes.delete(code);
    hit.shared.shareCodes.delete(code);
    hit.devices.shareCodes.delete(code);
  }
  if (hit.shockers.known && hit.shared.known && hit.devices.known) {
    hit.at = Date.now();
  }
}

export function invalidatePiShockPauseCache(discordUserId: string): void {
  cache.delete(discordUserId);
  inflight.delete(discordUserId);
  epochs.set(discordUserId, (epochs.get(discordUserId) ?? 0) + 1);
}
