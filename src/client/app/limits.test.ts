import { describe, expect, it } from 'vitest';
import { buildHubOptions } from './hubs';
import { derivePersonalLimits } from './limits';
import type { ShockerView } from '../components/ShockerCard';

describe('derivePersonalLimits', () => {
  it('defaults to the widest safe range when nothing is stored', () => {
    for (const input of [undefined, null, {}]) {
      expect(derivePersonalLimits(input)).toMatchObject({
        activityMinIntensity: 1,
        activityMaxIntensity: 100,
        activityMinDurationMs: 16,
        activityMaxDurationMs: 15_000,
        activityRequiredWarningLevel: 'none',
      });
    }
  });

  it('clamps out-of-range stored values into 1–100 % and 16 ms–15 s', () => {
    const out = derivePersonalLimits({
      activityMaxIntensity: 9_999,
      activityMaxDurationMs: 999_999,
      activityMinIntensity: -4,
      activityMinDurationMs: 0,
    });
    expect(out.activityMaxIntensity).toBe(100);
    expect(out.activityMaxDurationMs).toBe(15_000);
    expect(out.activityMinIntensity).toBe(1);
    expect(out.activityMinDurationMs).toBe(16);
    expect(derivePersonalLimits({ activityMaxIntensity: 0 }).activityMaxIntensity).toBe(1);
  });

  it('never lets a min exceed its max, in any mode', () => {
    const out = derivePersonalLimits({
      activityMaxIntensity: 10,
      activityMinIntensity: 80,
      activityVibMaxIntensity: 20,
      activityVibMinIntensity: 90,
      activityBeepMaxDurationMs: 500,
      activityBeepMinDurationMs: 9_000,
    });
    expect(out.activityMinIntensity).toBeLessThanOrEqual(out.activityMaxIntensity);
    expect(out.activityVibMinIntensity).toBeLessThanOrEqual(out.activityVibMaxIntensity);
    expect(out.activityBeepMinDurationMs).toBeLessThanOrEqual(out.activityBeepMaxDurationMs);
  });

  it('vibrate/beep bands inherit the shock band when unset', () => {
    const out = derivePersonalLimits({ activityMaxIntensity: 35, activityMaxDurationMs: 1_500 });
    expect(out.activityVibMaxIntensity).toBe(35);
    expect(out.activityBeepMaxIntensity).toBe(35);
    expect(out.activityVibMaxDurationMs).toBe(1_500);
    expect(out.activityBeepMaxDurationMs).toBe(1_500);
  });

  it('only accepts known warning levels', () => {
    expect(derivePersonalLimits({ activityRequiredWarningLevel: 'mid' }).activityRequiredWarningLevel).toBe('mid');
    expect(
      derivePersonalLimits({ activityRequiredWarningLevel: 'nuclear' as never }).activityRequiredWarningLevel,
    ).toBe('none');
  });
});

const sv = (clientId: string, online?: boolean) => ({ id: 1, clientId, online }) as unknown as ShockerView;

describe('buildHubOptions', () => {
  it('falls back to a single "PiShock" entry when there are no hubs', () => {
    const [h] = buildHubOptions(undefined, [], {});
    expect(h).toMatchObject({ id: '0', name: 'PiShock', online: false, lastSeen: 'Checking…' });
  });

  it('marks a hub online from PiShock status or from one of its shockers', () => {
    const hubs = [
      { ClientId: 1, Name: 'A' },
      { ClientId: 2, Name: 'B' },
      { ClientId: 3, Name: 'C' },
    ];
    const out = buildHubOptions(hubs, [sv('2', true)], { '1': true, '3': false });
    expect(out.map((h) => [h.name, h.online, h.lastSeen])).toEqual([
      ['A', true, 'Seen a few seconds ago'],
      ['B', true, 'Seen a few seconds ago'],
      ['C', false, 'Offline'],
    ]);
  });
});
