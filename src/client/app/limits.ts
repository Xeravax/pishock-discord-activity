import type { PersonalLimits } from '../components/ActivityLimitsSettings';

/**
 * Normalises the owner's stored Activity Limits into safe, fully-populated bands:
 * intensity 1–100, duration 16ms–15s, per-mode bands default to the shock band, and
 * every min is clamped to its max. Missing/unknown input falls back to the widest safe
 * range, never to an out-of-range value.
 */
export function derivePersonalLimits(p: Partial<PersonalLimits> | null | undefined): PersonalLimits {
  const maxI = Math.max(1, Math.min(100, p?.activityMaxIntensity ?? 100));
  const maxD = Math.max(16, Math.min(15_000, p?.activityMaxDurationMs ?? 15_000));
  const vibMaxI = Math.max(1, Math.min(100, p?.activityVibMaxIntensity ?? maxI));
  const vibMaxD = Math.max(16, Math.min(15_000, p?.activityVibMaxDurationMs ?? maxD));
  const beepMaxI = Math.max(1, Math.min(100, p?.activityBeepMaxIntensity ?? maxI));
  const beepMaxD = Math.max(16, Math.min(15_000, p?.activityBeepMaxDurationMs ?? maxD));
  return {
    activityMinIntensity: Math.max(1, Math.min(maxI, p?.activityMinIntensity ?? 1)),
    activityMaxIntensity: maxI,
    activityMinDurationMs: Math.max(16, Math.min(maxD, p?.activityMinDurationMs ?? 16)),
    activityMaxDurationMs: maxD,
    activityVibMinIntensity: Math.max(1, Math.min(vibMaxI, p?.activityVibMinIntensity ?? 1)),
    activityVibMaxIntensity: vibMaxI,
    activityVibMinDurationMs: Math.max(16, Math.min(vibMaxD, p?.activityVibMinDurationMs ?? 16)),
    activityVibMaxDurationMs: vibMaxD,
    activityBeepMinIntensity: Math.max(1, Math.min(beepMaxI, p?.activityBeepMinIntensity ?? 1)),
    activityBeepMaxIntensity: beepMaxI,
    activityBeepMinDurationMs: Math.max(16, Math.min(beepMaxD, p?.activityBeepMinDurationMs ?? 16)),
    activityBeepMaxDurationMs: beepMaxD,
    activityCanShock: true,
    activityCanVibrate: true,
    activityCanBeep: true,
    activityCanHold: true,
    activityRequiredWarningLevel:
      p?.activityRequiredWarningLevel === 'small' ||
      p?.activityRequiredWarningLevel === 'mid' ||
      p?.activityRequiredWarningLevel === 'long'
        ? p.activityRequiredWarningLevel
        : 'none',
  };
}
