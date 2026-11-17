import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShockerView } from '../ShockerCard';
import {
  CONTROL_PREFS_KEY,
  DEFAULT_CONTROL_PREFS,
  clamp,
  formatDurationSec,
  intensityLabel,
  loadControlPrefs,
  nudgeIntensity,
  rollIntensity,
  saveControlPrefs,
  shockerUsableDur,
  shockerUsableInt,
  shockerUsableMinDur,
  shockerUsableMinInt,
} from './helpers';

const sv = (over: Partial<ShockerView> = {}) =>
  ({
    id: 1,
    deviceMaxIntensity: 50,
    deviceMaxDuration: 5_000,
    maxIntensity: 80,
    maxDuration: 9_000,
    ...over,
  }) as ShockerView;

describe('usable bands never exceed the device ceiling', () => {
  it('shock', () => {
    expect(shockerUsableInt(sv())).toBe(50);
    expect(shockerUsableDur(sv())).toBe(5_000);
    expect(shockerUsableInt(sv({ activityMaxIntensity: 30 }))).toBe(30);
  });

  it('vibrate and beep use their own bands, still capped by the device', () => {
    const s = sv({ vibMaxIntensity: 90, beepMaxIntensity: 20, vibMaxDuration: 99_000, beepMaxDuration: 100 });
    expect(shockerUsableInt(s, 'vibrate')).toBe(50);
    expect(shockerUsableInt(s, 'beep')).toBe(20);
    expect(shockerUsableDur(s, 'vibrate')).toBe(5_000);
    expect(shockerUsableDur(s, 'beep')).toBe(100);
  });

  it('min is never above max and never below the hard floors (1 % / 16 ms)', () => {
    const s = sv({ minIntensity: 99, minDuration: 99_000, activityMaxIntensity: 10, activityMaxDuration: 200 });
    expect(shockerUsableMinInt(s)).toBeLessThanOrEqual(shockerUsableInt(s));
    expect(shockerUsableMinDur(s)).toBeLessThanOrEqual(shockerUsableDur(s));
    const zero = sv({ minIntensity: -5, minDuration: -5 });
    expect(shockerUsableMinInt(zero)).toBe(1);
    expect(shockerUsableMinDur(zero)).toBe(16);
  });
});

describe('intensity helpers', () => {
  it('clamp', () => {
    expect([clamp(5, 0, 3), clamp(-1, 0, 3), clamp(2, 0, 3)]).toEqual([3, 0, 2]);
  });

  it('rollIntensity stays within the (order-insensitive) range', () => {
    for (let i = 0; i < 200; i++) {
      const v = rollIntensity(40, 10);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThanOrEqual(40);
    }
    expect(rollIntensity(7, 7)).toBe(7);
  });

  it('intensityLabel', () => {
    expect(intensityLabel(false, 12, 1, 5)).toBe('12');
    expect(intensityLabel(true, 12, 30, 10)).toBe('10-30');
  });

  it('nudge (fixed) clamps to [0, cap]', () => {
    const setValue = vi.fn();
    nudgeIntensity({ random: false, value: 49, min: 0, max: 0, cap: 50, delta: 5, setValue });
    expect(setValue).toHaveBeenLastCalledWith(50);
    nudgeIntensity({ random: false, value: 2, min: 0, max: 0, cap: 50, delta: -5, setValue });
    expect(setValue).toHaveBeenLastCalledWith(0);
  });

  it('nudge (random) can never push the max past the cap or the min below 0', () => {
    const setMax = vi.fn();
    const setMin = vi.fn();
    const base = { random: true, value: 0, cap: 50, setValue: vi.fn(), setMin, setMax };
    nudgeIntensity({ ...base, min: 10, max: 48, delta: 10 });
    expect(setMax).toHaveBeenLastCalledWith(50);
    nudgeIntensity({ ...base, min: 3, max: 40, delta: -10 });
    expect(setMin).toHaveBeenLastCalledWith(0);
  });

  it('formatDurationSec', () => {
    expect([formatDurationSec(1000), formatDurationSec(300)]).toEqual(['1', '0.3']);
  });
});

describe('control prefs persistence', () => {
  beforeEach(() => localStorage.clear());

  it('returns defaults when nothing is stored or the JSON is corrupt', () => {
    expect(loadControlPrefs()).toEqual(DEFAULT_CONTROL_PREFS);
    localStorage.setItem(CONTROL_PREFS_KEY, '{not json');
    expect(loadControlPrefs()).toEqual(DEFAULT_CONTROL_PREFS);
  });

  it('round-trips saved prefs', () => {
    const prefs = { ...DEFAULT_CONTROL_PREFS, shockIntensity: 12, warningLevel: 'mid' as const, tapMode: true };
    saveControlPrefs(prefs);
    expect(loadControlPrefs()).toMatchObject({ shockIntensity: 12, warningLevel: 'mid', tapMode: true });
  });

  it('never lets NaN/Infinity or junk into numeric controls', () => {
    localStorage.setItem(
      CONTROL_PREFS_KEY,
      JSON.stringify({ shockIntensity: 'abc', shockDurationMs: {}, shockMax: 'x', vibIntensity: null }),
    );
    const p = loadControlPrefs();
    for (const v of [p.shockIntensity, p.shockDurationMs, p.shockMin, p.shockMax, p.vibIntensity, p.vibDurationMs]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(p.shockIntensity).toBe(DEFAULT_CONTROL_PREFS.shockIntensity);
    expect(p.shockMax).toBe(100);
  });

  it('migrates the legacy warningOn flag and rejects unknown warning levels', () => {
    localStorage.setItem(CONTROL_PREFS_KEY, JSON.stringify({ warningOn: true }));
    expect(loadControlPrefs().warningLevel).toBe('small');
    localStorage.setItem(CONTROL_PREFS_KEY, JSON.stringify({ warningLevel: 'bogus' }));
    expect(loadControlPrefs().warningLevel).toBe('none');
  });

  it('drops non-numeric per-shocker intensities', () => {
    localStorage.setItem(
      CONTROL_PREFS_KEY,
      JSON.stringify({ perShockIntensity: { a: 5, b: 'x', c: null, d: 7 } }),
    );
    expect(loadControlPrefs().perShockIntensity).toEqual({ a: 5, d: 7 });
  });
});
