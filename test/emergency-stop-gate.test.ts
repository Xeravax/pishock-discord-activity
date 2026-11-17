import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gateEmergencyStops, isEmergencyStopLatched } from '../src/server/services/emergency-stop.js';

describe('emergency-stop pending gate', () => {
  it('concurrent engages: one request finishing cannot clear the other’s pending stop', () => {
    const owner = 'gate-owner-1';
    gateEmergencyStops(owner, [1], true); // request A starts
    gateEmergencyStops(owner, [1], true); // request B starts
    gateEmergencyStops(owner, [1], false); // A settles
    assert.equal(isEmergencyStopLatched(owner, 1), true, 'B is still writing');
    gateEmergencyStops(owner, [1], false); // B settles
    assert.equal(isEmergencyStopLatched(owner, 1), false);
  });

  it('is scoped per owner and per shocker', () => {
    gateEmergencyStops('gate-owner-2', [5, 6], true);
    assert.equal(isEmergencyStopLatched('gate-owner-2', 5), true);
    assert.equal(isEmergencyStopLatched('gate-owner-2', 7), false);
    assert.equal(isEmergencyStopLatched('someone-else', 5), false);
    gateEmergencyStops('gate-owner-2', [5, 6], false);
    assert.equal(isEmergencyStopLatched('gate-owner-2', 6), false);
  });

  it('an extra release never goes negative or affects a later engage', () => {
    const owner = 'gate-owner-3';
    gateEmergencyStops(owner, [1], false);
    gateEmergencyStops(owner, [1], true);
    assert.equal(isEmergencyStopLatched(owner, 1), true);
    gateEmergencyStops(owner, [1], false);
    assert.equal(isEmergencyStopLatched(owner, 1), false);
  });
});
