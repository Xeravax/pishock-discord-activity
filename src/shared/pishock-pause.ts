const PAUSE_KEYS = ['Paused', 'paused', 'IsPaused', 'isPaused', 'SharePaused', 'sharePaused'] as const;

/** True when PiShock says this shocker or share is paused (operate would 503). */
export function isPiShockRowPaused(row: Record<string, unknown>): boolean {
  return PAUSE_KEYS.some((key) => row[key] === true);
}

/** True when the payload includes a pause flag and every one of them is false. */
export function isPiShockRowExplicitlyUnpaused(row: Record<string, unknown>): boolean {
  const present = PAUSE_KEYS.filter((key) => typeof row[key] === 'boolean');
  return present.length > 0 && present.every((key) => row[key] === false);
}
