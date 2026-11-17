import type { ShockerView } from '../components/ShockerCard';
import { hubClientId, normalizeClientKey } from './devices';

export type HubOption = { id: string; name: string; online: boolean; lastSeen: string };

/** Hub picker entries; a hub counts as online if PiShock says so or any of its shockers is. */
export function buildHubOptions(
  devicesHubs: Array<Record<string, unknown>> | undefined,
  ownedAndShared: ShockerView[],
  online: Record<string, boolean>,
): HubOption[] {
  const hubs = devicesHubs ?? [];
  if (!hubs.length) {
    const fallbackOnline = ownedAndShared.some((s) => s.online);
    return [
      {
        id: ownedAndShared[0]?.clientId
          ? normalizeClientKey(String(ownedAndShared[0].clientId)) || '0'
          : '0',
        name: 'PiShock',
        online: fallbackOnline,
        lastSeen: fallbackOnline ? 'Seen a few seconds ago' : 'Checking…',
      },
    ];
  }
  return hubs.map((h) => {
    const id = normalizeClientKey(hubClientId(h) ?? '') || '0';
    const name = String(h.Name ?? h.name ?? 'Hub');
    const known = id in online ? online[id] : undefined;
    const fromShockers = ownedAndShared.some(
      (s) => normalizeClientKey(String(s.clientId ?? '')) === id && s.online,
    );
    const isOnline = known === true || fromShockers;
    return {
      id,
      name,
      online: isOnline,
      lastSeen:
        known === true || fromShockers
          ? 'Seen a few seconds ago'
          : known === false
            ? 'Offline'
            : 'Checking…',
    };
  });
}
