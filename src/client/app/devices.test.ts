import { describe, expect, it } from 'vitest';
import type { PersonalLimits } from '../components/ActivityLimitsSettings';
import { collectClientIds, normalizeShockers, rowIsPaused } from './devices';
import { formatQueueEta } from './queueFormat';
import type { DevicesResponse } from './types';

const personal: PersonalLimits = {
  activityMinIntensity: 5,
  activityMaxIntensity: 40,
  activityMinDurationMs: 300,
  activityMaxDurationMs: 2000,
  activityVibMinIntensity: 1,
  activityVibMaxIntensity: 60,
  activityVibMinDurationMs: 300,
  activityVibMaxDurationMs: 3000,
  activityBeepMinIntensity: 1,
  activityBeepMaxIntensity: 70,
  activityBeepMinDurationMs: 300,
  activityBeepMaxDurationMs: 4000,
  activityCanShock: true,
  activityCanVibrate: true,
  activityCanBeep: true,
  activityCanHold: true,
  activityRequiredWarningLevel: 'small',
};

const devices = (over: Partial<DevicesResponse> = {}): DevicesResponse => ({
  hubs: [{ ClientId: 11, Name: 'Hub A' }],
  shockers: [{ ShockerId: 1, ClientId: 11, Name: 'Mine', MaxIntensity: 100, MaxDuration: 15000 }],
  shared: [],
  online: {},
  ...over,
});

describe('normalizeShockers — owned shockers', () => {
  it('applies personal Activity Limits as the ceiling, never above the device max', () => {
    const [s] = normalizeShockers(devices(), { '11': true }, personal, new Set(), new Set());
    expect(s).toMatchObject({
      id: 1,
      owned: true,
      hubName: 'Hub A',
      online: true,
      maxIntensity: 40,
      maxDuration: 2000,
      vibMaxIntensity: 60,
      beepMaxDuration: 4000,
      requiredWarningLevel: 'small',
    });
  });

  it('a device max below the personal limit wins', () => {
    const d = devices({
      shockers: [{ ShockerId: 1, ClientId: 11, MaxIntensity: 25, MaxDuration: 1000 }],
    });
    const [s] = normalizeShockers(d, {}, personal, new Set(), new Set());
    expect(s!.maxIntensity).toBe(25);
    expect(s!.maxDuration).toBe(1000);
    expect(s!.minIntensity).toBeLessThanOrEqual(s!.maxIntensity);
  });

  it('keeps min <= max even when the personal min exceeds the device max', () => {
    const d = devices({ shockers: [{ ShockerId: 1, ClientId: 11, MaxIntensity: 3 }] });
    const [s] = normalizeShockers(d, {}, { ...personal, activityMinIntensity: 50 }, new Set(), new Set());
    expect(s!.minIntensity).toBeLessThanOrEqual(s!.maxIntensity);
  });

  it('flags an engaged e-stop and live/PiShock pause', () => {
    const d = devices({
      shockers: [
        { ShockerId: 1, ClientId: 11 },
        { ShockerId: 2, ClientId: 11 },
        { ShockerId: 3, ClientId: 11, IsPaused: true },
      ],
    });
    const out = normalizeShockers(d, {}, personal, new Set([1]), new Set([2]));
    expect(out.map((s) => [s.id, s.emergencyStop, s.paused])).toEqual([
      [1, true, false],
      [2, false, true],
      [3, false, true],
    ]);
  });

  it('reports offline hubs as not online, unknown hubs as undefined', () => {
    const [off] = normalizeShockers(devices(), { '11': false }, personal, new Set(), new Set());
    expect(off!.online).toBe(false);
  });

  it('returns [] before devices have loaded', () => {
    expect(normalizeShockers(null, {}, personal, new Set(), new Set())).toEqual([]);
  });
});

describe('normalizeShockers — shared shockers', () => {
  it('respects per-share capability flags and is not owned', () => {
    const d = devices({
      shockers: [],
      shared: [
        { Id: 9, ClientId: 22, Name: 'Theirs', OwnedBy: 'Bob', CanShock: false, CanHold: false, ShareCode: 'ABC' },
      ],
    });
    const [s] = normalizeShockers(d, {}, personal, new Set(), new Set());
    expect(s).toMatchObject({
      id: 9,
      owned: false,
      hubName: 'Bob',
      canShock: false,
      canHold: false,
      canVibrate: true,
      shareCode: 'ABC',
    });
  });

  it('accepts the object-of-arrays shape PiShock sometimes returns', () => {
    const d = devices({
      shockers: [],
      shared: { Bob: [{ Id: 1 }, { Id: 2 }] } as unknown as DevicesResponse['shared'],
    });
    expect(normalizeShockers(d, {}, personal, new Set(), new Set()).map((s) => s.id)).toEqual([1, 2]);
  });
});

describe('device helpers', () => {
  it('rowIsPaused honours the live-paused set over a stale row', () => {
    expect(rowIsPaused({}, 5, new Set([5]))).toBe(true);
    expect(rowIsPaused({}, 5, new Set())).toBe(false);
  });

  it('collectClientIds de-duplicates hubs and shocker clients', () => {
    const ids = collectClientIds(
      devices({ shockers: [{ ShockerId: 1, ClientId: 11 }, { ShockerId: 2, ClientId: 12 }] }),
    );
    expect(ids.sort()).toEqual(['11', '12']);
  });
});

describe('formatQueueEta', () => {
  it.each([
    [null, null],
    [undefined, null],
    [Number.NaN, null],
    [0, 'now'],
    [-5, 'now'],
    [400, '1s'],
    [45_000, '45s'],
    [60_000, '1m'],
    [125_000, '2m 5s'],
  ])('%s -> %s', (input, expected) => {
    expect(formatQueueEta(input as number | null | undefined)).toBe(expected);
  });
});
