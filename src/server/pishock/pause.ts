import {
  isPiShockRowPaused,
} from '../../shared/pishock-pause.js';
import { getShared, getShockers, type PiShockCreds } from './client.js';

const TTL_MS = 20_000;

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

  const [shockers, shared] = await Promise.all([
    getShockers(creds).catch(() => null),
    getShared(creds).catch(() => null),
  ]);
  if (!shockers && !shared) return hit ?? { at: 0, shockerIds: new Set(), shareCodes: new Set() };

  const fromShockers = pausedMarksFromRows(readList(shockers?.data));
  const fromShared = pausedMarksFromRows(readList(shared?.data));
  const entry: PauseCacheEntry = {
    at: Date.now(),
    shockerIds: new Set([...fromShockers.shockerIds, ...fromShared.shockerIds]),
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
