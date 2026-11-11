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

type PauseCacheEntry = {
  at: number;
  shockerIds: Set<number>;
  shareCodes: Set<string>;
};

const cache = new Map<string, PauseCacheEntry>();

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

/**
 * Shockers and share codes PiShock currently reports as paused for this account.
 * Cached briefly so participant status and operate can refuse before a 503.
 */
export async function loadPiShockPause(
  discordUserId: string,
  creds: PiShockCreds,
): Promise<PauseCacheEntry> {
  const hit = cache.get(discordUserId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;

  const [shockers, shared, devices] = await Promise.all([
    getShockers(creds).catch(() => null),
    getShared(creds).catch(() => null),
    getUserDevices(creds).catch(() => null),
  ]);
  if (!shockers && !shared && !devices) {
    return hit ?? { at: 0, shockerIds: new Set(), shareCodes: new Set() };
  }

  const fromShockers = pausedMarksFromRows(readList(shockers?.data));
  const fromShared = pausedMarksFromRows(readList(shared?.data));
  const fromDevices = pausedMarksFromRows(shockersFromUserDevices(devices?.data));
  const entry: PauseCacheEntry = {
    at: Date.now(),
    shockerIds: new Set([
      ...fromShockers.shockerIds,
      ...fromShared.shockerIds,
      ...fromDevices.shockerIds,
    ]),
    shareCodes: new Set(fromShared.shareCodes),
  };
  cache.set(discordUserId, entry);
  return entry;
}

export async function getPiShockPausedShockerIds(
  discordUserId: string,
  creds: PiShockCreds,
): Promise<number[]> {
  const entry = await loadPiShockPause(discordUserId, creds);
  return [...entry.shockerIds];
}

export async function isPiShockSharePaused(
  discordUserId: string,
  creds: PiShockCreds,
  shareCode: string,
): Promise<boolean> {
  const code = shareCode.trim().toLowerCase();
  if (!code) return false;
  const entry = await loadPiShockPause(discordUserId, creds);
  return entry.shareCodes.has(code);
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
  const hit = cache.get(discordUserId) ?? {
    at: 0,
    shockerIds: new Set<number>(),
    shareCodes: new Set<string>(),
  };
  if (input.shockerId != null && Number.isFinite(input.shockerId) && input.shockerId > 0) {
    hit.shockerIds.add(Math.floor(input.shockerId));
  }
  const code = input.shareCode?.trim().toLowerCase();
  if (code) hit.shareCodes.add(code);
  hit.at = Date.now();
  cache.set(discordUserId, hit);
}

export function forgetPiShockPaused(
  discordUserId: string,
  input: { shockerId?: number | null; shareCode?: string | null },
): void {
  const hit = cache.get(discordUserId);
  if (!hit) return;
  if (input.shockerId != null && Number.isFinite(input.shockerId) && input.shockerId > 0) {
    hit.shockerIds.delete(Math.floor(input.shockerId));
  }
  const code = input.shareCode?.trim().toLowerCase();
  if (code) hit.shareCodes.delete(code);
  hit.at = Date.now();
}

export function invalidatePiShockPauseCache(discordUserId: string): void {
  cache.delete(discordUserId);
}
