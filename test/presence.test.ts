import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PRESENCE_ASSET_KEY,
  PRESENCE_PARTY_SOFT_MAX,
  buildPresenceSnapshot,
} from '../src/shared/presence.ts';

const base = {
  linked: true,
  friendsMode: true,
  participantCount: 3,
  sharingDevices: false,
  emergencyStop: false,
  queueHalted: false,
  queuePaused: false,
  instanceId: 'inst-1',
  startedAt: 1_700_000_000_000,
};

describe('buildPresenceSnapshot', () => {
  it('uses pishock_logo asset key constant', () => {
    assert.equal(PRESENCE_ASSET_KEY, 'pishock_logo');
  });

  it('maps unlinked browsing', () => {
    const snap = buildPresenceSnapshot({ ...base, linked: false });
    assert.equal(snap.details, 'In PiShock Activity');
    assert.equal(snap.state, 'Browsing Discord Shockers');
    assert.equal(snap.partySize, 3);
    assert.equal(snap.partyMax, PRESENCE_PARTY_SOFT_MAX);
  });

  it('maps friends mode with others', () => {
    const snap = buildPresenceSnapshot(base);
    assert.equal(snap.details, 'Controlling Discord Shockers');
    assert.equal(snap.state, 'With 2 others');
  });

  it('maps solo friends mode', () => {
    const snap = buildPresenceSnapshot({ ...base, participantCount: 1 });
    assert.equal(snap.state, 'Solo');
    assert.equal(snap.partySize, 1);
  });

  it('maps own devices sharing', () => {
    const snap = buildPresenceSnapshot({
      ...base,
      friendsMode: false,
      sharingDevices: true,
    });
    assert.equal(snap.details, 'Managing own devices');
    assert.equal(snap.state, 'Sharing to Discord');
  });

  it('prioritizes emergency stop over other states', () => {
    const snap = buildPresenceSnapshot({
      ...base,
      emergencyStop: true,
      queueHalted: true,
    });
    assert.equal(snap.details, 'PiShock — paused');
    assert.equal(snap.state, 'Emergency stop');
  });

  it('maps queue halted and paused', () => {
    assert.equal(
      buildPresenceSnapshot({ ...base, queueHalted: true }).state,
      'Queue closed',
    );
    assert.equal(
      buildPresenceSnapshot({ ...base, queuePaused: true }).state,
      'Queue paused',
    );
  });
});
