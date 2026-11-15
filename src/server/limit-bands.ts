import {
  normalizeWarningLevel,
  type WarningLevel,
} from '../shared/warning.js';

const ABS_MIN_INTENSITY = 1;
const ABS_MAX_INTENSITY = 100;
const ABS_MIN_DURATION_MS = 16;
const ABS_MAX_DURATION_MS = 15_000;

export const LIMIT_BAND_CONFLICT_MESSAGE = 'Limit minimum exceeds maximum';

/** Empty min/max intersection. Operate-policy replaces this with OperatePolicyError once loaded. */
export class LimitBandConflictError extends Error {
  readonly status = 400;
  readonly code = 'LIMIT_CONFLICT';
  constructor(message = LIMIT_BAND_CONFLICT_MESSAGE) {
    super(message);
    this.name = 'LimitBandConflictError';
  }
}

type LimitConflictFactory = (message: string) => Error;

let limitConflictFactory: LimitConflictFactory = (message) => new LimitBandConflictError(message);

export function setLimitBandConflictFactory(factory: LimitConflictFactory): void {
  limitConflictFactory = factory;
}

function throwEmptyLimitBand(): never {
  throw limitConflictFactory(LIMIT_BAND_CONFLICT_MESSAGE);
}

export type IntensityDurationBand = {
  minIntensity: number;
  maxIntensity: number;
  minDurationMs: number;
  maxDurationMs: number;
};

export type ModeLimitBands = {
  shock: IntensityDurationBand;
  vibrate: IntensityDurationBand;
  beep: IntensityDurationBand;
};

function nest(
  mins: Array<number | null | undefined>,
  maxes: Array<number | null | undefined>,
  absMin: number,
  absMax: number,
): { min: number; max: number } {
  const rawMaxes = maxes.map(Number).filter((n) => Number.isFinite(n));
  const rawMins = mins.map(Number).filter((n) => Number.isFinite(n));
  let max = rawMaxes.length
    ? Math.min(absMax, ...rawMaxes.map((n) => Math.max(absMin, n)))
    : absMax;
  max = Math.max(absMin, Math.min(absMax, max));
  let min = rawMins.length
    ? Math.max(absMin, ...rawMins.map((n) => Math.min(absMax, n)))
    : absMin;
  min = Math.max(absMin, Math.min(absMax, min));
  if (min > max) throwEmptyLimitBand();
  return { min, max };
}

function clampBand(
  input: Partial<IntensityDurationBand> | null | undefined,
  deviceMaxI = ABS_MAX_INTENSITY,
  deviceMaxD = ABS_MAX_DURATION_MS,
): IntensityDurationBand {
  const inten = nest(
    [input?.minIntensity ?? ABS_MIN_INTENSITY],
    [input?.maxIntensity ?? deviceMaxI, deviceMaxI],
    ABS_MIN_INTENSITY,
    ABS_MAX_INTENSITY,
  );
  const dur = nest(
    [input?.minDurationMs ?? ABS_MIN_DURATION_MS],
    [input?.maxDurationMs ?? deviceMaxD, deviceMaxD],
    ABS_MIN_DURATION_MS,
    ABS_MAX_DURATION_MS,
  );
  return {
    minIntensity: inten.min,
    maxIntensity: inten.max,
    minDurationMs: dur.min,
    maxDurationMs: dur.max,
  };
}

export function nestBands(
  bands: Array<Partial<IntensityDurationBand> | null | undefined>,
  deviceMaxI = ABS_MAX_INTENSITY,
  deviceMaxD = ABS_MAX_DURATION_MS,
): IntensityDurationBand {
  return {
    minIntensity: nest(
      bands.map((b) => b?.minIntensity),
      [...bands.map((b) => b?.maxIntensity), deviceMaxI],
      ABS_MIN_INTENSITY,
      ABS_MAX_INTENSITY,
    ).min,
    maxIntensity: nest(
      bands.map((b) => b?.minIntensity),
      [...bands.map((b) => b?.maxIntensity), deviceMaxI],
      ABS_MIN_INTENSITY,
      ABS_MAX_INTENSITY,
    ).max,
    minDurationMs: nest(
      bands.map((b) => b?.minDurationMs),
      [...bands.map((b) => b?.maxDurationMs), deviceMaxD],
      ABS_MIN_DURATION_MS,
      ABS_MAX_DURATION_MS,
    ).min,
    maxDurationMs: nest(
      bands.map((b) => b?.minDurationMs),
      [...bands.map((b) => b?.maxDurationMs), deviceMaxD],
      ABS_MIN_DURATION_MS,
      ABS_MAX_DURATION_MS,
    ).max,
  };
}

export function personalBandsFromUser(user: {
  activityMinIntensity?: number;
  activityMaxIntensity?: number;
  activityMinDurationMs?: number;
  activityMaxDurationMs?: number;
  activityVibMinIntensity?: number;
  activityVibMaxIntensity?: number;
  activityVibMinDurationMs?: number;
  activityVibMaxDurationMs?: number;
  activityBeepMinIntensity?: number;
  activityBeepMaxIntensity?: number;
  activityBeepMinDurationMs?: number;
  activityBeepMaxDurationMs?: number;
  activityRequiredWarningLevel?: string | null;
} | null): ModeLimitBands & { requiredWarningLevel: WarningLevel } {
  const shock = clampBand({
    minIntensity: user?.activityMinIntensity,
    maxIntensity: user?.activityMaxIntensity,
    minDurationMs: user?.activityMinDurationMs,
    maxDurationMs: user?.activityMaxDurationMs,
  });
  const vibrate = clampBand({
    minIntensity: user?.activityVibMinIntensity ?? shock.minIntensity,
    maxIntensity: user?.activityVibMaxIntensity ?? shock.maxIntensity,
    minDurationMs: user?.activityVibMinDurationMs ?? shock.minDurationMs,
    maxDurationMs: user?.activityVibMaxDurationMs ?? shock.maxDurationMs,
  });
  const beep = clampBand({
    minIntensity: user?.activityBeepMinIntensity ?? shock.minIntensity,
    maxIntensity: user?.activityBeepMaxIntensity ?? shock.maxIntensity,
    minDurationMs: user?.activityBeepMinDurationMs ?? shock.minDurationMs,
    maxDurationMs: user?.activityBeepMaxDurationMs ?? shock.maxDurationMs,
  });
  return {
    shock,
    vibrate,
    beep,
    requiredWarningLevel: normalizeWarningLevel(user?.activityRequiredWarningLevel),
  };
}

export function shareBandsFromRow(row: {
  deviceMaxIntensity?: number;
  deviceMaxDurationMs?: number;
  minIntensity?: number;
  maxIntensity?: number;
  minDurationMs?: number;
  maxDurationMs?: number;
  vibMinIntensity?: number;
  vibMaxIntensity?: number;
  vibMinDurationMs?: number;
  vibMaxDurationMs?: number;
  beepMinIntensity?: number;
  beepMaxIntensity?: number;
  beepMinDurationMs?: number;
  beepMaxDurationMs?: number;
  requiredWarningLevel?: string | null;
}): ModeLimitBands & { requiredWarningLevel: WarningLevel } {
  const deviceMaxI = Math.max(
    ABS_MIN_INTENSITY,
    Math.min(ABS_MAX_INTENSITY, row.deviceMaxIntensity ?? ABS_MAX_INTENSITY),
  );
  const deviceMaxD = Math.max(
    ABS_MIN_DURATION_MS,
    Math.min(ABS_MAX_DURATION_MS, row.deviceMaxDurationMs ?? ABS_MAX_DURATION_MS),
  );
  const shock = clampBand(
    {
      minIntensity: row.minIntensity,
      maxIntensity: row.maxIntensity,
      minDurationMs: row.minDurationMs,
      maxDurationMs: row.maxDurationMs,
    },
    deviceMaxI,
    deviceMaxD,
  );
  const vibrate = clampBand(
    {
      minIntensity: row.vibMinIntensity ?? shock.minIntensity,
      maxIntensity: row.vibMaxIntensity ?? shock.maxIntensity,
      minDurationMs: row.vibMinDurationMs ?? shock.minDurationMs,
      maxDurationMs: row.vibMaxDurationMs ?? shock.maxDurationMs,
    },
    deviceMaxI,
    deviceMaxD,
  );
  const beep = clampBand(
    {
      minIntensity: row.beepMinIntensity ?? shock.minIntensity,
      maxIntensity: row.beepMaxIntensity ?? shock.maxIntensity,
      minDurationMs: row.beepMinDurationMs ?? shock.minDurationMs,
      maxDurationMs: row.beepMaxDurationMs ?? shock.maxDurationMs,
    },
    deviceMaxI,
    deviceMaxD,
  );
  return {
    shock,
    vibrate,
    beep,
    requiredWarningLevel: normalizeWarningLevel(row.requiredWarningLevel),
  };
}

export function bandForOperation(
  bands: ModeLimitBands,
  operation: string,
): IntensityDurationBand {
  if (operation === 'vibrate' || operation === 'warning') return bands.vibrate;
  if (operation === 'beep') return bands.beep;
  return bands.shock;
}
