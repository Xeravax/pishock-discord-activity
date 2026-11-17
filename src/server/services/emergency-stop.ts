import { prisma } from '../db.js';

export async function getEmergencyStopShockerIds(discordUserId: string): Promise<number[]> {
  const user = await prisma.discordUser.findUnique({
    where: { id: discordUserId },
    select: { emergencyStopShockerIds: true },
  });
  return user?.emergencyStopShockerIds ?? [];
}

const pendingEmergencyStops = new Set<string>();

/** Keep admission closed while the durable emergency-stop latch is being written. */
export function gateEmergencyStops(
  discordUserId: string,
  shockerIds: number[],
  engaged: boolean,
): void {
  for (const id of shockerIds) {
    const key = `${discordUserId}:${id}`;
    if (engaged) pendingEmergencyStops.add(key);
    else pendingEmergencyStops.delete(key);
  }
}

export async function isEmergencyStopped(
  discordUserId: string,
  shockerId: number,
): Promise<boolean> {
  const key = `${discordUserId}:${shockerId}`;
  if (pendingEmergencyStops.has(key)) return true;
  const ids = await getEmergencyStopShockerIds(discordUserId);
  return pendingEmergencyStops.has(key) || ids.includes(shockerId);
}

/** Latch or release owner emergency stop for one or more shockers. */
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
  const current = await getEmergencyStopShockerIds(discordUserId);
  const drop = new Set(unique);
  const next = engaged
    ? [...new Set([...current, ...unique])]
    : current.filter((id) => !drop.has(id));
  const user = await prisma.discordUser.update({
    where: { id: discordUserId },
    data: { emergencyStopShockerIds: next },
    select: { emergencyStopShockerIds: true },
  });
  return {
    engagedIds: unique.filter((id) => user.emergencyStopShockerIds.includes(id)),
    emergencyStopShockerIds: user.emergencyStopShockerIds,
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
