import { isPiShockRowPaused } from '../../shared/pishock-pause.js';
import type { ControlSnapshot } from './client.js';

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
