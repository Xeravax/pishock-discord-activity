import { prisma } from '../db.js';

export async function getEmergencyStopShockerIds(discordUserId: string): Promise<number[]> {
  const user = await prisma.discordUser.findUnique({
    where: { id: discordUserId },
    select: { emergencyStopShockerIds: true },
  });
  return user?.emergencyStopShockerIds ?? [];
}

const keyOf = (discordUserId: string, shockerId: number) => `${discordUserId}:${shockerId}`;

/**
 * Engage requests whose durable write has not settled yet, counted per owner+shocker.
 * A counter (not a set) so one request's cleanup cannot clear another request's pending stop.
 */
const pendingEmergencyStops = new Map<string, number>();

/**
 * Stops this process has durably written (engage adds, release removes). Only updated from
 * writes, never from reads, so a stale read can't resurrect or drop a latch. Lets callers do
 * a synchronous publish-time check after their last await.
 */
const latchedEmergencyStops = new Set<string>();

/**
 * Keep admission closed while the durable emergency-stop latch is being written.
 * Call with `engaged: true` when an engage starts and `engaged: false` exactly once when that
 * same engage has been written. Release requests must not call this.
 */
export function gateEmergencyStops(
  discordUserId: string,
  shockerIds: number[],
  engaged: boolean,
): void {
  for (const id of shockerIds) {
    const key = keyOf(discordUserId, id);
    const count = pendingEmergencyStops.get(key) ?? 0;
    if (engaged) {
      pendingEmergencyStops.set(key, count + 1);
    } else if (count <= 1) {
      pendingEmergencyStops.delete(key);
    } else {
      pendingEmergencyStops.set(key, count - 1);
    }
  }
}

/**
 * Synchronous publish-time guard: true while an engage is in flight or once this process has
 * written the latch. Call immediately before sending a device command (no await in between),
 * after the durable `isEmergencyStopped` check, so a STOP that completed during any earlier
 * await still blocks the command.
 */
export function isEmergencyStopLatched(discordUserId: string, shockerId: number): boolean {
  const key = keyOf(discordUserId, shockerId);
  return pendingEmergencyStops.has(key) || latchedEmergencyStops.has(key);
}

export async function isEmergencyStopped(
  discordUserId: string,
  shockerId: number,
): Promise<boolean> {
  if (isEmergencyStopLatched(discordUserId, shockerId)) return true;
  const ids = await getEmergencyStopShockerIds(discordUserId);
  return isEmergencyStopLatched(discordUserId, shockerId) || ids.includes(shockerId);
}

/**
 * Latch or release owner emergency stop for one or more shockers.
 * One atomic UPDATE computes the new list from the row's current value, so concurrent
 * requests (e.g. STOP on two shockers at once) cannot overwrite each other's latch.
 */
export async function setEmergencyStops(
  discordUserId: string,
  shockerIds: number[],
  engaged: boolean,
): Promise<{ engagedIds: number[]; emergencyStopShockerIds: number[] }> {
  const unique = [
    ...new Set(
      shockerIds.filter((id) => Number.isFinite(id) && id > 0).map((id) => Math.floor(id)),
    ),
  ];
  const rows = engaged
    ? await prisma.$queryRaw<Array<{ emergencyStopShockerIds: number[] | null }>>`
        UPDATE "DiscordUser"
        SET "emergencyStopShockerIds" =
          COALESCE("emergencyStopShockerIds", ARRAY[]::integer[]) ||
          ARRAY(
            SELECT x FROM unnest(${unique}::integer[]) AS x
            WHERE NOT (x = ANY(COALESCE("emergencyStopShockerIds", ARRAY[]::integer[])))
          )
        WHERE "id" = ${discordUserId}
        RETURNING "emergencyStopShockerIds"`
    : await prisma.$queryRaw<Array<{ emergencyStopShockerIds: number[] | null }>>`
        UPDATE "DiscordUser"
        SET "emergencyStopShockerIds" = ARRAY(
          SELECT t.x
          FROM unnest(COALESCE("emergencyStopShockerIds", ARRAY[]::integer[]))
            WITH ORDINALITY AS t(x, i)
          WHERE NOT (t.x = ANY(${unique}::integer[]))
          ORDER BY t.i
        )
        WHERE "id" = ${discordUserId}
        RETURNING "emergencyStopShockerIds"`;
  const row = rows[0];
  if (!row) throw new Error(`Discord user ${discordUserId} not found`);
  const stored = row.emergencyStopShockerIds ?? [];
  for (const id of unique) {
    const key = keyOf(discordUserId, id);
    if (stored.includes(id)) latchedEmergencyStops.add(key);
    else latchedEmergencyStops.delete(key);
  }
  return {
    engagedIds: unique.filter((id) => stored.includes(id)),
    emergencyStopShockerIds: stored,
  };
}

/** Latch or release owner emergency stop for a shocker. Returns the new engaged state. */
export async function setEmergencyStop(
  discordUserId: string,
  shockerId: number,
  engaged: boolean,
): Promise<{ engaged: boolean; emergencyStopShockerIds: number[] }> {
  const result = await setEmergencyStops(discordUserId, [shockerId], engaged);
  return {
    engaged: result.emergencyStopShockerIds.includes(shockerId),
    emergencyStopShockerIds: result.emergencyStopShockerIds,
  };
}
