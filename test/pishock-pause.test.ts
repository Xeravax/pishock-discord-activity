import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isPiShockRowExplicitlyUnpaused,
  isPiShockRowPaused,
} from '../src/shared/pishock-pause.js';
import { pausedOwnedShockerIds } from '../src/server/pishock/estop-sync.js';
import { annotateShockersWithPause, pausedMarksFromRows } from '../src/server/pishock/pause.js';

describe('PiShock pause flags', () => {
  it('treats shocker and share pause as paused', () => {
    assert.equal(isPiShockRowPaused({ Paused: true }), true);
    assert.equal(isPiShockRowPaused({ sharePaused: true }), true);
    assert.equal(isPiShockRowPaused({ SharePaused: false, Paused: true }), true);
    assert.equal(isPiShockRowPaused({ Name: 'Box' }), false);
  });

  it('only calls a row explicitly unpaused when a flag is present and false', () => {
    assert.equal(isPiShockRowExplicitlyUnpaused({ Paused: false }), true);
    assert.equal(isPiShockRowExplicitlyUnpaused({ Paused: false, SharePaused: true }), false);
    assert.equal(isPiShockRowExplicitlyUnpaused({ Name: 'Box' }), false);
  });

  it('collects paused shocker ids and share codes', () => {
    const marks = pausedMarksFromRows([
      { ShockerId: 12, Paused: true },
      { Id: 12, Name: 'dup' },
      { shockerId: 4, ShareCode: 'ABC', SharePaused: true },
      { ShockerId: 9, Paused: false },
    ]);
    assert.deepEqual(marks.shockerIds.sort((a, b) => a - b), [4, 12]);
    assert.deepEqual(marks.shareCodes, ['abc']);
  });

  it('pausedOwnedShockerIds only reads owned shockers from the snapshot', () => {
    const ids = pausedOwnedShockerIds({
      hubs: [],
      shockers: [
        { Id: 7, Paused: true },
        { Id: 8, Paused: false },
        { ShockerId: 9, isPaused: true },
      ],
      shared: [{ Id: 99, Paused: true }],
    });
    assert.deepEqual(ids, [7, 9]);
  });

  it('annotates missing pause flags onto shockers known paused', () => {
    const rows = annotateShockersWithPause(
      [{ Id: 7, Name: 'A' }, { Id: 8, Name: 'B', Paused: false }],
      [7],
    ) as Array<Record<string, unknown>>;
    assert.equal(rows[0]?.Paused, true);
    assert.equal(rows[1]?.Paused, false);
  });
});
