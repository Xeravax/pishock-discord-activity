import { isPiShockRowPaused } from '../../shared/pishock-pause.js';
import { broadcastRealtimeAll } from '../realtime.js';
import {
  getEmergencyStopShockerIds,
  replaceEmergencyStopShockerIds,
} from '../session.js';
import type { ControlSnapshot, PiShockCreds } from './client.js';
import { fetchControlSnapshot } from './client.js';
import { invalidatePiShockPauseCache, rememberPiShockPaused } from './pause.js';

/** Skip website→Discord sync briefly after a local e-stop toggle (pause API may lag). */
const localGuardUntil = new Map<string, number>();

export function guardLocalEstopSync(discordUserId: string, ms = 6_000): void {
  localGuardUntil.set(discordUserId, Date.now() + Math.max(0, ms));
}

function shockerIdOf(row: Record<string, unknown>): number | null {
  const id = Number(row.ShockerId ?? row.shockerId ?? row.Id ?? row.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  return Math.floor(id);
}

/** Owned shocker ids PiShock currently reports as paused. */
export function pausedOwnedShockerIds(snapshot: ControlSnapshot): number[] {
  const ids = new Set<number>();
  for (const raw of snapshot.shockers ?? []) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    if (!isPiShockRowPaused(row)) continue;
    const id = shockerIdOf(row);
    if (id != null) ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}

function sameIds(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const as = [...a].sort((x, y) => x - y);
  const bs = [...b].sort((x, y) => x - y);
  return as.every((id, i) => id === bs[i]);
}

/**
 * Mirror PiShock.com pause → Discord emergency-stop latch, and notify the activity.
 * No-ops for a few seconds after a local e-stop so engage/release is not undone by lag.
 */
export async function syncEstopFromPiShockPause(
  discordUserId: string,
  creds: PiShockCreds,
  snapshot?: ControlSnapshot,
): Promise<{ changed: boolean; emergencyStopShockerIds: number[] }> {
  const guard = localGuardUntil.get(discordUserId) ?? 0;
  if (Date.now() < guard) {
    const current = await getEmergencyStopShockerIds(discordUserId);
    return { changed: false, emergencyStopShockerIds: current };
  }

  const snap = snapshot ?? (await fetchControlSnapshot(creds));
  const paused = pausedOwnedShockerIds(snap);
  const current = await getEmergencyStopShockerIds(discordUserId);
  if (sameIds(current, paused)) {
    return { changed: false, emergencyStopShockerIds: current };
  }

  const next = await replaceEmergencyStopShockerIds(discordUserId, paused);
  invalidatePiShockPauseCache(discordUserId);
  for (const id of paused) {
    rememberPiShockPaused(discordUserId, { shockerId: id });
  }

  const primaryId = next[0] ?? current[0] ?? paused[0] ?? 0;
  broadcastRealtimeAll({
    type: 'emergency_stop',
    ownerDiscordUserId: discordUserId,
    shockerId: primaryId,
    engaged: next.includes(primaryId),
    emergencyStopShockerIds: next,
    at: Date.now(),
  });

  return { changed: true, emergencyStopShockerIds: next };
}
