/** Shared warning-before-shock presets (client + server). */

export type WarningLevel = 'none' | 'small' | 'mid' | 'long';

export const WARNING_LEVELS: WarningLevel[] = ['none', 'small', 'mid', 'long'];

export const WARNING_PRESETS: Record<
  Exclude<WarningLevel, 'none'>,
  { intensity: number; durationMs: number; label: string }
> = {
  small: { intensity: 25, durationMs: 500, label: 'SMALL' },
  mid: { intensity: 50, durationMs: 500, label: 'MID' },
  long: { intensity: 50, durationMs: 1000, label: 'LONG' },
};

/** Extra settle after warning vibe before shock. */
export const WARNING_SHOCK_GAP_MS = 350;

export function isWarningLevel(value: unknown): value is WarningLevel {
  return value === 'none' || value === 'small' || value === 'mid' || value === 'long';
}

export function normalizeWarningLevel(value: unknown, fallback: WarningLevel = 'none'): WarningLevel {
  return isWarningLevel(value) ? value : fallback;
}

/** Rank for comparing required vs chosen warning (none < small < mid < long). */
export function warningRank(level: WarningLevel): number {
  return WARNING_LEVELS.indexOf(level);
}

/** Raise chosen level up to the owner-required floor. */
export function atLeastWarning(chosen: WarningLevel, required: WarningLevel): WarningLevel {
  return warningRank(chosen) >= warningRank(required) ? chosen : required;
}

export function warningButtonLabel(level: WarningLevel): string {
  return level === 'none' ? 'None' : WARNING_PRESETS[level].label;
}

export function nextWarningLevel(current: WarningLevel): WarningLevel {
  const i = WARNING_LEVELS.indexOf(current);
  return WARNING_LEVELS[(i + 1) % WARNING_LEVELS.length]!;
}

/** Cycle warning among levels at or above an owner-required floor. */
export function cycleWarningLevel(
  current: WarningLevel,
  floor: WarningLevel = 'none',
): WarningLevel {
  const allowed = WARNING_LEVELS.filter((level) => warningRank(level) >= warningRank(floor));
  if (!allowed.length) return floor;
  const start = atLeastWarning(current, floor);
  const i = allowed.indexOf(start);
  return allowed[((i < 0 ? 0 : i) + 1) % allowed.length]!;
}
