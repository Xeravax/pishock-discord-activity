import type { ShockerView } from '../ShockerCard';
import { colorForShocker } from '../../multiColors';
import {
  atLeastWarning,
  normalizeWarningLevel,
  type WarningLevel,
} from '../../../shared/warning';

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function multiColorKey(s: ShockerView): string {
  if (s.targetDiscordUserId) return `u:${s.targetDiscordUserId}:s:${s.id}`;
  if (s.owned) return `own:${s.id}`;
  return `s:${s.id}`;
}

export function multiUserKey(s: ShockerView): string {
  if (s.targetDiscordUserId) return `u:${s.targetDiscordUserId}`;
  if (s.owned) return 'own';
  return `s:${s.id}`;
}

export function multiColorForShocker(s: ShockerView): string {
  return colorForShocker(multiUserKey(s), s.id);
}

export type ModeBandOp = 'shock' | 'vibrate' | 'beep';

export function shockerUsableInt(s: ShockerView, mode: ModeBandOp = 'shock'): number {
  const device = s.deviceMaxIntensity ?? s.maxIntensity ?? 100;
  if (mode === 'vibrate') {
    return Math.min(device, s.vibMaxIntensity ?? s.activityMaxIntensity ?? s.maxIntensity ?? 100);
  }
  if (mode === 'beep') {
    return Math.min(device, s.beepMaxIntensity ?? s.activityMaxIntensity ?? s.maxIntensity ?? 100);
  }
  return Math.min(device, s.activityMaxIntensity ?? s.maxIntensity ?? 100);
}

export function shockerUsableMinInt(s: ShockerView, mode: ModeBandOp = 'shock'): number {
  const max = shockerUsableInt(s, mode);
  if (mode === 'vibrate') {
    return Math.max(1, Math.min(max, s.vibMinIntensity ?? s.minIntensity ?? s.activityMinIntensity ?? 1));
  }
  if (mode === 'beep') {
    return Math.max(1, Math.min(max, s.beepMinIntensity ?? s.minIntensity ?? s.activityMinIntensity ?? 1));
  }
  return Math.max(1, Math.min(max, s.minIntensity ?? s.activityMinIntensity ?? 1));
}

export function shockerUsableDur(s: ShockerView, mode: ModeBandOp = 'shock'): number {
  const device = s.deviceMaxDuration ?? s.maxDuration ?? 15_000;
  if (mode === 'vibrate') {
    return Math.min(device, s.vibMaxDuration ?? s.activityMaxDuration ?? s.maxDuration ?? 15_000);
  }
  if (mode === 'beep') {
    return Math.min(device, s.beepMaxDuration ?? s.activityMaxDuration ?? s.maxDuration ?? 15_000);
  }
  return Math.min(device, s.activityMaxDuration ?? s.maxDuration ?? 15_000);
}

export function shockerUsableMinDur(s: ShockerView, mode: ModeBandOp = 'shock'): number {
  const max = shockerUsableDur(s, mode);
  if (mode === 'vibrate') {
    return Math.max(16, Math.min(max, s.vibMinDuration ?? s.minDuration ?? s.activityMinDuration ?? 16));
  }
  if (mode === 'beep') {
    return Math.max(16, Math.min(max, s.beepMinDuration ?? s.minDuration ?? s.activityMinDuration ?? 16));
  }
  return Math.max(16, Math.min(max, s.minDuration ?? s.activityMinDuration ?? 16));
}

export function formatDurationSec(ms: number) {
  const s = ms / 1000;
  return Number.isInteger(s) ? String(s) : s.toFixed(1);
}

/** Official remote duration chips (seconds). */
export const DURATION_PRESETS_SEC = [0.3, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export function rollIntensity(min: number, max: number) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (hi <= lo) return lo;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

export function intensityLabel(random: boolean, value: number, min: number, max: number) {
  if (!random) return String(value);
  return `${Math.min(min, max)}-${Math.max(min, max)}`;
}

export function nudgeIntensity(input: {
  random: boolean;
  value: number;
  min: number;
  max: number;
  cap: number;
  delta: number;
  setValue: (n: number) => void;
  setMin?: (n: number) => void;
  setMax?: (n: number) => void;
}) {
  const lo = clamp(Math.min(input.min, input.max), 0, input.cap);
  const hi = clamp(Math.max(input.min, input.max), 0, input.cap);
  if (!input.random) {
    input.setValue(clamp(input.value + input.delta, 0, input.cap));
    return;
  }
  if (input.delta > 0) input.setMax?.(clamp(hi + input.delta, lo, input.cap));
  else input.setMin?.(clamp(lo + input.delta, 0, hi));
}

export const CONTROL_PREFS_KEY = 'pishock.official-controls.v1';

/** Stored values can be corrupted/hand-edited: never let NaN/Infinity into the controls. */
function finiteOr(value: unknown, fallback: number): number {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

export type MultiOperation = 'shock' | 'vibrate' | 'beep';

/** Per-shocker settings while Multi · Individual is on. */
export type PerTargetSettings = {
  operation: MultiOperation;
  intensity: number;
  durationMs: number;
  warningLevel: WarningLevel;
};

export type ControlPrefs = {
  shockIntensity: number;
  shockDurationMs: number;
  shockRandom: boolean;
  shockMin: number;
  shockMax: number;
  vibIntensity: number;
  vibDurationMs: number;
  warningLevel: WarningLevel;
  tapMode: boolean;
  multiShock: boolean;
  individualIntensity: boolean;
  /** @deprecated migrated into perTarget */
  perShockIntensity: Record<string, number>;
  perTarget: Record<string, PerTargetSettings>;
  activeId?: number;
};

export const DEFAULT_CONTROL_PREFS: ControlPrefs = {
  shockIntensity: 0,
  shockDurationMs: 300,
  shockRandom: false,
  shockMin: 0,
  shockMax: 100,
  vibIntensity: 69,
  vibDurationMs: 1000,
  warningLevel: 'none',
  tapMode: false,
  multiShock: false,
  individualIntensity: false,
  perShockIntensity: {},
  perTarget: {},
};

export type MultiFirePlanItem = {
  shocker: ShockerView;
  operation: MultiOperation;
  intensity: number;
  durationMs: number;
  warningLevel: WarningLevel;
};

export type MultiFireDefaults = {
  operation: MultiOperation;
  intensity: number;
  durationMs: number;
  warningLevel: WarningLevel;
  /** When true, use each target's stored settings (still clamped to that target). */
  individual: boolean;
};

function modeAllowed(s: ShockerView, operation: MultiOperation): boolean {
  if (operation === 'shock') return Boolean(s.canShock);
  if (operation === 'vibrate') return Boolean(s.canVibrate);
  return Boolean(s.canBeep);
}

/**
 * Build the per-target commands for a multishock fire. Every value is clamped to
 * that shocker's own band for the chosen action; disallowed / E-STOP / paused
 * targets are skipped with a reason.
 */
export function planMultiFire(
  targets: ShockerView[],
  perTarget: Record<string, Partial<PerTargetSettings>>,
  defaults: MultiFireDefaults,
  keyFor: (s: ShockerView) => string = multiColorKey,
): { ready: MultiFirePlanItem[]; skipped: Array<{ shocker: ShockerView; reason: string }> } {
  const ready: MultiFirePlanItem[] = [];
  const skipped: Array<{ shocker: ShockerView; reason: string }> = [];
  for (const shocker of targets) {
    if (shocker.emergencyStop) {
      skipped.push({ shocker, reason: 'E-STOP' });
      continue;
    }
    if (shocker.paused) {
      skipped.push({ shocker, reason: 'paused' });
      continue;
    }
    const key = keyFor(shocker);
    const stored = perTarget[key];
    const operation: MultiOperation = defaults.individual
      ? (stored?.operation ?? defaults.operation)
      : defaults.operation;
    if (!modeAllowed(shocker, operation)) {
      skipped.push({
        shocker,
        reason:
          operation === 'shock'
            ? 'shock not allowed'
            : operation === 'vibrate'
              ? 'vibrate not allowed'
              : 'beep not allowed',
      });
      continue;
    }
    const mode: ModeBandOp = operation;
    const minInt = shockerUsableMinInt(shocker, mode);
    const maxInt = shockerUsableInt(shocker, mode);
    const minDur = shockerUsableMinDur(shocker, mode);
    const maxDur = shockerUsableDur(shocker, mode);
    const rawIntensity =
      defaults.individual && stored?.intensity != null ? stored.intensity : defaults.intensity;
    const rawDuration =
      defaults.individual && stored?.durationMs != null ? stored.durationMs : defaults.durationMs;
    const floor = normalizeWarningLevel(shocker.requiredWarningLevel);
    const chosenWarning =
      defaults.individual && stored?.warningLevel
        ? normalizeWarningLevel(stored.warningLevel)
        : defaults.warningLevel;
    ready.push({
      shocker,
      operation,
      intensity: clamp(Math.max(1, rawIntensity), minInt, maxInt),
      durationMs: clamp(rawDuration, minDur, maxDur),
      warningLevel:
        operation === 'shock' ? atLeastWarning(chosenWarning, floor) : 'none',
    });
  }
  return { ready, skipped };
}

function parsePerTarget(raw: unknown): Record<string, PerTargetSettings> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, PerTargetSettings> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Partial<PerTargetSettings>;
    const operation =
      v.operation === 'vibrate' || v.operation === 'beep' || v.operation === 'shock'
        ? v.operation
        : 'shock';
    out[key] = {
      operation,
      intensity: finiteOr(v.intensity, 1),
      durationMs: finiteOr(v.durationMs, 300),
      warningLevel: normalizeWarningLevel(v.warningLevel),
    };
  }
  return out;
}

/** Migrate legacy perShockIntensity maps into perTarget entries. */
export function migratePerShockIntensity(
  intensities: Record<string, number>,
  existing: Record<string, PerTargetSettings>,
  defaults: { intensity: number; durationMs: number; warningLevel: WarningLevel },
): Record<string, PerTargetSettings> {
  const next = { ...existing };
  for (const [key, intensity] of Object.entries(intensities)) {
    if (next[key]) continue;
    if (typeof intensity !== 'number' || !Number.isFinite(intensity)) continue;
    next[key] = {
      operation: 'shock',
      intensity,
      durationMs: defaults.durationMs,
      warningLevel: defaults.warningLevel,
    };
  }
  return next;
}

export function loadControlPrefs(): ControlPrefs {
  try {
    const raw = localStorage.getItem(CONTROL_PREFS_KEY);
    if (!raw) return { ...DEFAULT_CONTROL_PREFS };
    const parsed = JSON.parse(raw) as Partial<ControlPrefs> & {
      perShockIntensity?: Record<string, number>;
    };
    const warningLevel = (['none', 'small', 'mid', 'long'] as const).includes(
      parsed.warningLevel as WarningLevel,
    )
      ? (parsed.warningLevel as WarningLevel)
      : (parsed as { warningOn?: boolean }).warningOn
        ? 'small'
        : 'none';
    const shockDurationMs = finiteOr(parsed.shockDurationMs, DEFAULT_CONTROL_PREFS.shockDurationMs);
    const perShockIntensity =
      parsed.perShockIntensity && typeof parsed.perShockIntensity === 'object'
        ? Object.fromEntries(
            Object.entries(parsed.perShockIntensity).filter(
              ([, v]) => typeof v === 'number' && Number.isFinite(v),
            ),
          )
        : {};
    const perTarget = migratePerShockIntensity(
      perShockIntensity,
      parsePerTarget(parsed.perTarget),
      {
        intensity: finiteOr(parsed.shockIntensity, DEFAULT_CONTROL_PREFS.shockIntensity),
        durationMs: shockDurationMs,
        warningLevel,
      },
    );
    return {
      ...DEFAULT_CONTROL_PREFS,
      ...parsed,
      shockIntensity: finiteOr(parsed.shockIntensity, DEFAULT_CONTROL_PREFS.shockIntensity),
      shockDurationMs,
      shockRandom: Boolean(parsed.shockRandom),
      shockMin: finiteOr(parsed.shockMin, 0),
      shockMax: finiteOr(parsed.shockMax, 100),
      vibIntensity: finiteOr(parsed.vibIntensity, DEFAULT_CONTROL_PREFS.vibIntensity),
      vibDurationMs: finiteOr(parsed.vibDurationMs, DEFAULT_CONTROL_PREFS.vibDurationMs),
      warningLevel,
      tapMode: Boolean(parsed.tapMode),
      multiShock: Boolean(parsed.multiShock),
      individualIntensity: Boolean(parsed.individualIntensity),
      perShockIntensity,
      perTarget,
      activeId:
        parsed.activeId == null || Number.isNaN(Number(parsed.activeId))
          ? undefined
          : Number(parsed.activeId),
    };
  } catch {
    return { ...DEFAULT_CONTROL_PREFS };
  }
}

export function saveControlPrefs(prefs: ControlPrefs) {
  try {
    localStorage.setItem(CONTROL_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // private mode / quota
  }
}

export function wheelDeltaPx(event: WheelEvent, delta: number): number {
  if (event.deltaMode === 1) return delta * 16;
  if (event.deltaMode === 2) return delta * window.innerHeight;
  return delta;
}

export function nearestScrollable(start: HTMLElement, axis: 'x' | 'y'): HTMLElement | null {
  const overflowProp = axis === 'y' ? 'overflowY' : 'overflowX';
  const scrollSize = axis === 'y' ? 'scrollHeight' : 'scrollWidth';
  const clientSize = axis === 'y' ? 'clientHeight' : 'clientWidth';
  let node = start.parentElement;
  while (node) {
    const overflow = getComputedStyle(node)[overflowProp];
    if (
      (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') &&
      node[scrollSize] > node[clientSize] + 1
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/** The shocker row is not a sideways scroller. Forward wheel movement the row
 *  can't use so a horizontal gesture over it doesn't freeze the page. */
export function passShockerChipWheel(el: HTMLElement, event: WheelEvent) {
  const deltaX = wheelDeltaPx(event, event.deltaX);
  const deltaY = wheelDeltaPx(event, event.deltaY);
  const horizontal = Math.abs(deltaX) > Math.abs(deltaY);
  const maxY = el.scrollHeight - el.clientHeight;
  const canScrollY = maxY > 1;
  const atTop = el.scrollTop <= 0;
  const atBottom = el.scrollTop >= maxY - 1;
  const verticalBlocked =
    !canScrollY || (deltaY < 0 && atTop) || (deltaY > 0 && atBottom);

  if (!horizontal && !verticalBlocked) return;

  const parent = nearestScrollable(el, 'y');
  if (!parent || deltaY === 0) return;
  parent.scrollTop += deltaY;
  event.preventDefault();
}
