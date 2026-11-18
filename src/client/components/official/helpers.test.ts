import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShockerView } from '../ShockerCard';
import {
  CONTROL_PREFS_KEY,
  DEFAULT_CONTROL_PREFS,
  clamp,
  formatDurationSec,
  intensityLabel,
  loadControlPrefs,
  migratePerShockIntensity,
  multiColorKey,
  nudgeIntensity,
  planMultiFire,
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

  it('migrates legacy per-shocker intensities into perTarget', () => {
    localStorage.setItem(
      CONTROL_PREFS_KEY,
      JSON.stringify({ shockDurationMs: 800, warningLevel: 'mid', perShockIntensity: { a: 5, b: 'x' } }),
    );
    expect(loadControlPrefs().perTarget).toEqual({
      a: { operation: 'shock', intensity: 5, durationMs: 800, warningLevel: 'mid' },
    });
  });

  it('sanitises stored perTarget entries', () => {
    localStorage.setItem(
      CONTROL_PREFS_KEY,
      JSON.stringify({
        perTarget: {
          a: { operation: 'zap', intensity: 'x', durationMs: null, warningLevel: 'huge' },
          b: 'junk',
        },
      }),
    );
    const { perTarget } = loadControlPrefs();
    expect(Object.keys(perTarget)).toEqual(['a']);
    expect(perTarget.a!.operation).toBe('shock');
    expect(Number.isFinite(perTarget.a!.intensity)).toBe(true);
    expect(Number.isFinite(perTarget.a!.durationMs)).toBe(true);
    expect(perTarget.a!.warningLevel).toBe('none');
  });
});

describe('migratePerShockIntensity', () => {
  const defaults = { intensity: 10, durationMs: 1000, warningLevel: 'none' as const };

  it('never overwrites an existing perTarget entry', () => {
    const existing = {
      a: { operation: 'vibrate' as const, intensity: 40, durationMs: 2000, warningLevel: 'none' as const },
    };
    const next = migratePerShockIntensity({ a: 5, b: 7 }, existing, defaults);
    expect(next.a).toEqual(existing.a);
    expect(next.b).toEqual({ operation: 'shock', intensity: 7, durationMs: 1000, warningLevel: 'none' });
  });

  it('skips non-finite legacy values', () => {
    expect(migratePerShockIntensity({ a: Number.NaN, b: Infinity }, {}, defaults)).toEqual({});
  });
});

describe('planMultiFire', () => {
  const target = (over: Partial<ShockerView> = {}) =>
    ({
      id: 1,
      name: 'S',
      owned: true,
      canShock: true,
      canVibrate: true,
      canBeep: true,
      canHold: false,
      deviceMaxIntensity: 100,
      deviceMaxDuration: 15_000,
      activityMaxIntensity: 30,
      activityMaxDuration: 2_000,
      vibMaxIntensity: 80,
      vibMaxDuration: 5_000,
      ...over,
    }) as ShockerView;
  const uniform = {
    operation: 'shock' as const,
    intensity: 90,
    durationMs: 10_000,
    warningLevel: 'none' as const,
    individual: false,
  };

  it('clamps each target to its own band for the chosen action', () => {
    const a = target({ id: 1, activityMaxIntensity: 20 });
    const b = target({ id: 2, activityMaxIntensity: 60, activityMaxDuration: 4_000 });
    const shock = planMultiFire([a, b], {}, uniform);
    expect(shock.ready.map((x) => [x.intensity, x.durationMs])).toEqual([
      [20, 2_000],
      [60, 4_000],
    ]);
    const vibe = planMultiFire([a, b], {}, { ...uniform, operation: 'vibrate' });
    expect(vibe.ready.map((x) => [x.intensity, x.durationMs])).toEqual([
      [80, 5_000],
      [80, 5_000],
    ]);
  });

  it('raises values up to the minimum band and never sends 0 %', () => {
    const s = target({ minIntensity: 5, minDuration: 500 });
    const plan = planMultiFire([s], {}, { ...uniform, intensity: 0, durationMs: 16 });
    expect(plan.ready[0]).toMatchObject({ intensity: 5, durationMs: 500 });
  });

  it('individual mode uses each target settings, still clamped to that action band', () => {
    const a = target({ id: 1 });
    const b = target({ id: 2 });
    const perTarget = {
      [multiColorKey(a)]: { operation: 'vibrate' as const, intensity: 99, durationMs: 9_000, warningLevel: 'long' as const },
      [multiColorKey(b)]: { operation: 'shock' as const, intensity: 25, durationMs: 1_500, warningLevel: 'small' as const },
    };
    const plan = planMultiFire([a, b], perTarget, { ...uniform, individual: true });
    expect(plan.ready).toEqual([
      expect.objectContaining({ operation: 'vibrate', intensity: 80, durationMs: 5_000, warningLevel: 'none' }),
      expect.objectContaining({ operation: 'shock', intensity: 25, durationMs: 1_500, warningLevel: 'small' }),
    ]);
    // Uniform mode ignores the stored settings.
    expect(planMultiFire([a], perTarget, uniform).ready[0]).toMatchObject({ operation: 'shock', intensity: 30 });
  });

  it('skips targets that do not allow the chosen action', () => {
    const a = target({ id: 1, canShock: false });
    const b = target({ id: 2, canVibrate: false });
    const plan = planMultiFire([a, b], {}, uniform);
    expect(plan.ready.map((x) => x.shocker.id)).toEqual([2]);
    expect(plan.skipped).toEqual([{ shocker: a, reason: 'shock not allowed' }]);
    const indiv = planMultiFire(
      [b],
      { [multiColorKey(b)]: { operation: 'vibrate', intensity: 10, durationMs: 300, warningLevel: 'none' } },
      { ...uniform, individual: true },
    );
    expect(indiv.ready).toEqual([]);
    expect(indiv.skipped[0]!.reason).toBe('vibrate not allowed');
  });

  it('never goes below the wearer-required warning', () => {
    const s = target({ requiredWarningLevel: 'mid' });
    expect(planMultiFire([s], {}, uniform).ready[0]!.warningLevel).toBe('mid');
    expect(planMultiFire([s], {}, { ...uniform, warningLevel: 'long' }).ready[0]!.warningLevel).toBe('long');
    const perTarget = {
      [multiColorKey(s)]: { operation: 'shock' as const, intensity: 10, durationMs: 300, warningLevel: 'none' as const },
    };
    expect(
      planMultiFire([s], perTarget, { ...uniform, individual: true }).ready[0]!.warningLevel,
    ).toBe('mid');
  });

  it('skips E-STOP and paused targets', () => {
    const stopped = target({ id: 1, emergencyStop: true });
    const paused = target({ id: 2, paused: true });
    const ok = target({ id: 3 });
    const plan = planMultiFire([stopped, paused, ok], {}, uniform);
    expect(plan.ready.map((x) => x.shocker.id)).toEqual([3]);
    expect(plan.skipped.map((x) => x.reason)).toEqual(['E-STOP', 'paused']);
  });
});
