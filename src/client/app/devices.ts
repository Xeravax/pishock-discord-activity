import type { PersonalLimits } from '../components/ActivityLimitsSettings';
import type { ShockerView } from '../components/ShockerCard';
import { isPiShockRowPaused } from '../../shared/pishock-pause';
import type { DevicesResponse } from './types';

export function normalizeClientKey(raw: string | number | null | undefined): string | null {
  if (raw == null) return null;
  let id = String(raw).trim();
  if (!id) return null;
  if (/^c\d+$/i.test(id)) id = id.slice(1);
  return id;
}

export function hubClientId(row: Record<string, unknown>): string | null {
  const id = row.ClientId ?? row.clientId ?? row.HubId ?? row.hubId ?? row.Id ?? row.id;
  return normalizeClientKey(id != null ? String(id) : null);
}

export function shockerClientId(row: Record<string, unknown>): string | null {
  const id = row.ClientId ?? row.clientId ?? row.HubId ?? row.hubId;
  return normalizeClientKey(id != null ? String(id) : null);
}

/** Official API MaxDuration is seconds; operate path expects ms */
export function maxDurationMs(row: Record<string, unknown>): number {
  const raw = Number(row.MaxDuration ?? row.maxDuration ?? 15);
  if (!Number.isFinite(raw) || raw <= 0) return 15_000;
  return raw <= 60 ? Math.round(raw * 1000) : Math.round(raw);
}

export function collectClientIds(devices: DevicesResponse): string[] {
  const ids = new Set<string>();
  for (const hub of devices.hubs ?? []) {
    const id = hubClientId(hub);
    if (id) ids.add(id);
  }
  for (const s of devices.shockers ?? []) {
    const id = shockerClientId(s);
    if (id) ids.add(id);
  }
  const sharedList = Array.isArray(devices.shared)
    ? devices.shared
    : devices.shared && typeof devices.shared === 'object'
      ? Object.values(devices.shared as Record<string, unknown>).flatMap((v) =>
          Array.isArray(v) ? v : [v],
        )
      : [];
  for (const s of sharedList as Array<Record<string, unknown>>) {
    const id = shockerClientId(s);
    if (id) ids.add(id);
  }
  return [...ids];
}

export function pauseRowsFromDevices(devices: DevicesResponse): Array<Record<string, unknown>> {
  const shared = Array.isArray(devices.shared)
    ? devices.shared
    : devices.shared && typeof devices.shared === 'object'
      ? Object.values(devices.shared as Record<string, unknown>).flatMap((v) =>
          Array.isArray(v) ? v : [v],
        )
      : [];
  return [...(devices.shockers ?? []), ...(shared as Array<Record<string, unknown>>)];
}

export function rowIsPaused(
  row: Record<string, unknown>,
  id: number,
  livePausedIds: Set<number>,
): boolean {
  if (livePausedIds.has(id)) return true;
  return isPiShockRowPaused(row);
}

export function normalizeShockers(
  devices: DevicesResponse | null,
  online: Record<string, boolean>,
  personal: PersonalLimits,
  emergencyStopIds: Set<number>,
  livePausedIds: Set<number>,
): ShockerView[] {
  if (!devices) return [];
  const hubNameByClient = new Map<string, string>();
  for (const hub of devices.hubs ?? []) {
    const id = hubClientId(hub);
    const name = String(hub.Name ?? hub.name ?? 'Hub');
    if (id) hubNameByClient.set(id, name);
  }

  const fallbackHubId = [...hubNameByClient.keys()][0] ?? null;

  const owned: ShockerView[] = (devices.shockers ?? []).map((s) => {
    const id = Number(s.ShockerId ?? s.shockerId ?? s.Id ?? s.id);
    const clientKey = shockerClientId(s) ?? fallbackHubId ?? '';
    const deviceMaxIntensity = Math.max(
      1,
      Math.min(100, Number(s.MaxIntensity ?? s.maxIntensity ?? 100)),
    );
    const deviceMaxDuration = maxDurationMs(s);
    const activityMaxIntensity = Math.min(deviceMaxIntensity, personal.activityMaxIntensity);
    const activityMaxDuration = Math.min(deviceMaxDuration, personal.activityMaxDurationMs);
    const activityMinIntensity = Math.max(
      1,
      Math.min(activityMaxIntensity, personal.activityMinIntensity),
    );
    const activityMinDuration = Math.max(
      16,
      Math.min(activityMaxDuration, personal.activityMinDurationMs),
    );
    const vibMaxIntensity = Math.min(deviceMaxIntensity, personal.activityVibMaxIntensity);
    const vibMinIntensity = Math.max(
      1,
      Math.min(vibMaxIntensity, personal.activityVibMinIntensity),
    );
    const vibMaxDuration = Math.min(deviceMaxDuration, personal.activityVibMaxDurationMs);
    const vibMinDuration = Math.max(
      16,
      Math.min(vibMaxDuration, personal.activityVibMinDurationMs),
    );
    const beepMaxIntensity = Math.min(deviceMaxIntensity, personal.activityBeepMaxIntensity);
    const beepMinIntensity = Math.max(
      1,
      Math.min(beepMaxIntensity, personal.activityBeepMinIntensity),
    );
    const beepMaxDuration = Math.min(deviceMaxDuration, personal.activityBeepMaxDurationMs);
    const beepMinDuration = Math.max(
      16,
      Math.min(beepMaxDuration, personal.activityBeepMinDurationMs),
    );
    return {
      id,
      name: String(s.Name ?? s.name ?? `Shocker ${id}`),
      hubName: clientKey ? hubNameByClient.get(clientKey) : undefined,
      clientId: clientKey || undefined,
      owned: true,
      paused: rowIsPaused(s, id, livePausedIds),
      canShock: true,
      canVibrate: true,
      canBeep: true,
      canHold: true,
      canPause: Boolean(s.CanPause ?? s.canPause ?? false),
      deviceMaxIntensity,
      deviceMaxDuration,
      activityMinIntensity,
      activityMaxIntensity,
      activityMinDuration,
      activityMaxDuration,
      minIntensity: activityMinIntensity,
      maxIntensity: activityMaxIntensity,
      minDuration: activityMinDuration,
      maxDuration: activityMaxDuration,
      vibMinIntensity,
      vibMaxIntensity,
      vibMinDuration,
      vibMaxDuration,
      beepMinIntensity,
      beepMaxIntensity,
      beepMinDuration,
      beepMaxDuration,
      requiredWarningLevel: personal.activityRequiredWarningLevel,
      emergencyStop: emergencyStopIds.has(id),
      isV3: Boolean(s.IsV3 ?? s.isV3 ?? true),
      online: clientKey ? online[clientKey] === true : undefined,
    };
  });

  const sharedList = Array.isArray(devices.shared)
    ? devices.shared
    : devices.shared && typeof devices.shared === 'object'
      ? Object.values(devices.shared as Record<string, unknown>).flatMap((v) =>
          Array.isArray(v) ? v : [v],
        )
      : [];

  const shared: ShockerView[] = (sharedList as Array<Record<string, unknown>>).map((s) => {
    const id = Number(s.Id ?? s.id ?? s.ShockerId ?? s.shockerId);
    const clientKey = shockerClientId(s) ?? '';
    const deviceMaxIntensity = Math.max(
      1,
      Math.min(100, Number(s.MaxIntensity ?? s.maxIntensity ?? 100)),
    );
    const deviceMaxDuration = maxDurationMs(s);
    return {
      id,
      name: String(s.Name ?? s.name ?? `Shared ${id}`),
      hubName: String(s.OwnedBy ?? s.ownedBy ?? ''),
      clientId: clientKey || undefined,
      owned: false,
      paused: rowIsPaused(s, id, livePausedIds),
      shareCode: s.ShareCode != null ? String(s.ShareCode) : s.shareCode != null ? String(s.shareCode) : undefined,
      shareId: s.ShareId != null ? Number(s.ShareId) : s.shareId != null ? Number(s.shareId) : undefined,
      canShock: Boolean(s.CanShock ?? s.canShock ?? true),
      canVibrate: Boolean(s.CanVibrate ?? s.canVibrate ?? true),
      canBeep: Boolean(s.CanBeep ?? s.canBeep ?? true),
      canHold: Boolean(s.CanHold ?? s.canHold ?? true),
      canPause: Boolean(s.CanPause ?? s.canPause ?? false),
      deviceMaxIntensity,
      deviceMaxDuration,
      activityMinIntensity: 1,
      activityMaxIntensity: deviceMaxIntensity,
      activityMinDuration: 16,
      activityMaxDuration: deviceMaxDuration,
      minIntensity: 1,
      maxIntensity: deviceMaxIntensity,
      minDuration: 16,
      maxDuration: deviceMaxDuration,
      isV3: Boolean(s.IsV3 ?? s.isV3 ?? true),
      online: clientKey ? online[clientKey] === true : undefined,
    };
  });

  return [...owned, ...shared];
}
