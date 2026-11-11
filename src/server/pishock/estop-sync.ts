import {
  isPiShockRowExplicitlyUnpaused,
  isPiShockRowPaused,
} from '../../shared/pishock-pause.js';
import { broadcastRealtimeAll } from '../realtime.js';
import {
  getEmergencyStopShockerIds,
  replaceEmergencyStopShockerIds,
} from '../session.js';
import type { ControlSnapshot, PiShockCreds } from './client.js';
import { fetchControlSnapshot } from './client.js';
import {
  getPiShockPausedShockerIds,
  invalidatePiShockPauseCache,
  rememberPiShockPaused,
  shockersFromUserDevices,
} from './pause.js';
import { getUserDevices } from './client.js';

/** Skip website→Discord sync briefly after a local e-stop toggle (pause API may lag). */
const localGuardUntil = new Map<string, number>();

export function guardLocalEstopSync(discordUserId: string, ms = 8_000): void {
  localGuardUntil.set(discordUserId, Date.now() + Math.max(0, ms));
}

function shockerIdOf(row: Record<string, unknown>): number | null {
  const id = Number(row.ShockerId ?? row.shockerId ?? row.Id ?? row.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  return Math.floor(id);
}

/** Owned shocker ids PiShock currently reports as paused (snapshot rows only). */
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
 * Mirror website pause ↔ Discord emergency-stop without wiping unknown state.
 * - Paused on PiShock → latch e-stop
 * - Explicitly unpaused on PiShock → release e-stop
 * - Missing pause flags → leave the current latch alone (never clear blindly)
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
  const current = await getEmergencyStopShockerIds(discordUserId);
  const pausedFromLists = new Set(await getPiShockPausedShockerIds(discordUserId, creds));

  // Also scan GetUserDevices for explicit unpause so we can release the latch.
  const devices = await getUserDevices(creds).catch(() => null);
  const deviceRows = shockersFromUserDevices(devices?.data);
  const explicitlyUnpaused = new Set<number>();
  for (const row of deviceRows) {
    const id = shockerIdOf(row);
    if (id == null) continue;
    if (isPiShockRowPaused(row)) pausedFromLists.add(id);
    else if (isPiShockRowExplicitlyUnpaused(row)) explicitlyUnpaused.add(id);
  }
  for (const raw of snap.shockers ?? []) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const id = shockerIdOf(row);
    if (id == null) continue;
    if (isPiShockRowPaused(row)) pausedFromLists.add(id);
    else if (isPiShockRowExplicitlyUnpaused(row)) explicitlyUnpaused.add(id);
  }

  const next = new Set(current);
  for (const id of pausedFromLists) next.add(id);
  for (const id of explicitlyUnpaused) {
    if (!pausedFromLists.has(id)) next.delete(id);
  }

  const nextList = [...next].sort((a, b) => a - b);
  if (sameIds(current, nextList)) {
    return { changed: false, emergencyStopShockerIds: current };
  }

  const saved = await replaceEmergencyStopShockerIds(discordUserId, nextList);
  invalidatePiShockPauseCache(discordUserId);
  for (const id of pausedFromLists) {
    rememberPiShockPaused(discordUserId, { shockerId: id });
  }

  const primaryId = saved[0] ?? current[0] ?? nextList[0] ?? 0;
  broadcastRealtimeAll({
    type: 'emergency_stop',
    ownerDiscordUserId: discordUserId,
    shockerId: primaryId,
    engaged: saved.includes(primaryId),
    emergencyStopShockerIds: saved,
    at: Date.now(),
  });

  return { changed: true, emergencyStopShockerIds: saved };
}
