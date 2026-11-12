/** Privacy-safe Discord Rich Presence copy (no intensities / target names). */

export const PRESENCE_PARTY_SOFT_MAX = 8;
export const PRESENCE_ASSET_KEY = 'pishock_logo';

export type PresenceSnapshot = {
  details: string;
  state: string;
  partySize: number;
  partyMax: number;
  instanceId: string | null;
  startedAt: number;
};

export function buildPresenceSnapshot(input: {
  linked: boolean;
  friendsMode: boolean;
  participantCount: number;
  sharingDevices: boolean;
  emergencyStop: boolean;
  queueHalted: boolean;
  queuePaused: boolean;
  instanceId: string | null;
  startedAt: number;
}): PresenceSnapshot {
  const partySize = Math.max(1, Math.floor(input.participantCount) || 1);
  const partyMax = Math.max(partySize, PRESENCE_PARTY_SOFT_MAX);
  const others = Math.max(0, partySize - 1);
  const withOthers = others > 0 ? `With ${others} other${others === 1 ? '' : 's'}` : 'Solo';

  if (input.emergencyStop) {
    return {
      details: 'PiShock — paused',
      state: 'Emergency stop',
      partySize,
      partyMax,
      instanceId: input.instanceId,
      startedAt: input.startedAt,
    };
  }
  if (input.queueHalted) {
    return {
      details: 'PiShock — paused',
      state: 'Queue closed',
      partySize,
      partyMax,
      instanceId: input.instanceId,
      startedAt: input.startedAt,
    };
  }
  if (input.queuePaused) {
    return {
      details: 'PiShock — paused',
      state: 'Queue paused',
      partySize,
      partyMax,
      instanceId: input.instanceId,
      startedAt: input.startedAt,
    };
  }
  if (!input.linked) {
    return {
      details: 'In PiShock Activity',
      state: 'Browsing Discord Shockers',
      partySize,
      partyMax,
      instanceId: input.instanceId,
      startedAt: input.startedAt,
    };
  }
  if (input.friendsMode) {
    return {
      details: 'Controlling Discord Shockers',
      state: withOthers,
      partySize,
      partyMax,
      instanceId: input.instanceId,
      startedAt: input.startedAt,
    };
  }
  return {
    details: 'Managing own devices',
    state: input.sharingDevices ? 'Sharing to Discord' : 'Own hubs',
    partySize,
    partyMax,
    instanceId: input.instanceId,
    startedAt: input.startedAt,
  };
}
