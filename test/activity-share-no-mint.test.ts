import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  activityShareCodeOnSave,
  retainedShareCode,
} from '../src/server/routes/activity-share.js';

describe('activity share save does not mint PiShock share codes', () => {
  it('always clears share codes on save, even when caps would have changed', () => {
    assert.equal(activityShareCodeOnSave(null, null), null);
    assert.equal(activityShareCodeOnSave('EXISTING', null), null);
    assert.equal(activityShareCodeOnSave('EXISTING', 'PLANTED'), null);
    assert.equal(activityShareCodeOnSave(undefined, 'PLANTED'), null);
  });

  it('still refuses client-planted codes via retainedShareCode', () => {
    assert.equal(retainedShareCode(null, 'PLANTED'), null);
    assert.equal(retainedShareCode('SERVERCODE', 'PLANTED'), 'SERVERCODE');
  });
});
