import type { PiShockCreds } from './pishock/client.js';
import { fetchControlSnapshot, type ControlSnapshot } from './pishock/client.js';
import { publishOperate } from './pishock/broker.js';
import {
  findActivityShareByCode,
  findActivityShareByShocker,
  getConsent,
  getPersonalActivityLimits,
  isEmergencyStopped,
  isExecutorBanned,
} from './session.js';
import {
  nestBands,
  personalBandsFromUser,
  shareBandsFromRow,
  type IntensityDurationBand,
  type ModeLimitBands,
} from './limit-bands.js';
import {
  normalizeWarningLevel,
  type WarningLevel,
} from '../shared/warning.js';

/** Absolute hardware floors / ceilings used by every operate path. */
export const ABS_MIN_INTENSITY = 1;
export const ABS_MAX_INTENSITY = 100;
export const ABS_MIN_DURATION_MS = 16;
export const ABS_MAX_DURATION_MS = 15_000;

/** Nest activity floors/ceilings: max(mins) ∩ min(maxes), then force min ≤ max. */
export function nestLimitBand(input: {
  mins?: Array<number | null | undefined>;
  maxes?: Array<number | null | undefined>;
  absMin: number;
  absMax: number;
}): { min: number; max: number } {
  const absMin = Math.min(input.absMin, input.absMax);
  const absMax = Math.max(input.absMin, input.absMax);
  const rawMaxes = (input.maxes ?? [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n));
  const rawMins = (input.mins ?? [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n));
  let max = rawMaxes.length
    ? Math.min(absMax, ...rawMaxes.map((n) => Math.max(absMin, n)))
    : absMax;
  max = Math.max(absMin, Math.min(absMax, max));
  let min = rawMins.length
    ? Math.max(absMin, ...rawMins.map((n) => Math.min(absMax, n)))
    : absMin;
  min = Math.max(absMin, Math.min(max, min));
  return { min, max };
}

/** Hold frames without a client end are cut off after the clamped duration. */
export const HOLD_AUTO_END_GRACE_MS = 250;

const OPERATE_RATE_WINDOW_MS = 60_000;
const OPERATE_RATE_MAX = 30;

const rateBuckets = new Map<string, number[]>();
const holdEndTimers = new Map<string, ReturnType<typeof setTimeout>>();

export type OperateModeFlags = {
  canShock: boolean;
  canVibrate: boolean;
  canBeep: boolean;
  canHold: boolean;
};

export type ResolvedOperatePolicy = {
  ownerDiscordUserId: string;
  shockerId: number | null;
  shareCode: string | null;
  hubClientId: string | null;
  /** Shock band (also mirrored as min/max* for older call sites). */
  minIntensity: number;
  maxIntensity: number;
  minDurationMs: number;
  maxDurationMs: number;
  bands: ModeLimitBands;
  requiredWarningLevel: WarningLevel;
  flags: OperateModeFlags;
  /** True when the caller is operating someone else's device via a registered share. */
  crossUser: boolean;
};

function policyFromBands(
  base: Omit<
    ResolvedOperatePolicy,
    | 'minIntensity'
    | 'maxIntensity'
    | 'minDurationMs'
    | 'maxDurationMs'
    | 'bands'
    | 'requiredWarningLevel'
  >,
  bands: ModeLimitBands,
  requiredWarningLevel: WarningLevel,
): ResolvedOperatePolicy {
  return {
    ...base,
    minIntensity: bands.shock.minIntensity,
    maxIntensity: bands.shock.maxIntensity,
    minDurationMs: bands.shock.minDurationMs,
    maxDurationMs: bands.shock.maxDurationMs,
    bands,
    requiredWarningLevel,
  };
}

export class OperatePolicyError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function assertOperateRateLimit(discordUserId: string): void {
  const now = Date.now();
  const prev = rateBuckets.get(discordUserId) ?? [];
  const recent = prev.filter((t) => now - t < OPERATE_RATE_WINDOW_MS);
  if (recent.length >= OPERATE_RATE_MAX) {
    throw new OperatePolicyError(
      'Too many commands — wait a moment before trying again',
      429,
      'RATE_LIMIT',
    );
  }
  recent.push(now);
  rateBuckets.set(discordUserId, recent);
}

export function clampIntensity(
  value: unknown,
  max: number,
  min: number = ABS_MIN_INTENSITY,
): number {
  const band = nestLimitBand({
    mins: [min],
    maxes: [max],
    absMin: ABS_MIN_INTENSITY,
    absMax: ABS_MAX_INTENSITY,
  });
  const n = Number(value ?? band.min);
  if (!Number.isFinite(n)) return band.min;
  return Math.max(band.min, Math.min(band.max, n));
}

export function clampDurationMs(
  value: unknown,
  max: number,
  min: number = ABS_MIN_DURATION_MS,
): number {
  const band = nestLimitBand({
    mins: [min],
    maxes: [max],
    absMin: ABS_MIN_DURATION_MS,
    absMax: ABS_MAX_DURATION_MS,
  });
  const n = Number(value ?? Math.max(band.min, 300));
  if (!Number.isFinite(n)) return band.min;
  return Math.max(band.min, Math.min(band.max, n));
}

export function assertModeAllowed(
  operation: string,
  hold: boolean,
  flags: OperateModeFlags,
): void {
  if ((operation === 'shock' || operation === 'hold') && !flags.canShock) {
    throw new OperatePolicyError('Shock not allowed', 405, 'MODE_DENIED');
  }
  if ((operation === 'vibrate' || operation === 'warning') && !flags.canVibrate) {
    throw new OperatePolicyError('Vibrate not allowed', 405, 'MODE_DENIED');
  }
  if (operation === 'beep' && !flags.canBeep) {
    throw new OperatePolicyError('Beep not allowed', 405, 'MODE_DENIED');
  }
  if (hold && !flags.canHold) {
    throw new OperatePolicyError('Hold not allowed', 405, 'MODE_DENIED');
  }
}

/** Reject raw body values outside the resolved policy band (pre-clamp). */
export function assertWithinCeilings(
  intensity: unknown,
  durationMs: unknown,
  maxIntensity: number,
  maxDurationMs: number,
  minIntensity: number = ABS_MIN_INTENSITY,
  minDurationMs: number = ABS_MIN_DURATION_MS,
): void {
  const inten = Number(intensity ?? 1);
  const dur = Number(durationMs ?? 300);
  if (Number.isFinite(inten) && inten < minIntensity) {
    throw new OperatePolicyError('Intensity below allowed minimum', 412, 'INTENSITY_FLOOR');
  }
  if (Number.isFinite(inten) && inten > maxIntensity) {
    throw new OperatePolicyError('Intensity exceeds allowed maximum', 412, 'INTENSITY_CEILING');
  }
  if (Number.isFinite(dur) && dur < minDurationMs) {
    throw new OperatePolicyError('Duration below allowed minimum', 416, 'DURATION_FLOOR');
  }
  if (Number.isFinite(dur) && dur > maxDurationMs) {
    throw new OperatePolicyError('Duration exceeds allowed maximum', 416, 'DURATION_CEILING');
  }
}

/** Fields read from ActivityShare rows during operate policy resolution. */
export type ActivitySharePolicyRow = {
  discordUserId: string;
  shockerId: number;
  shareCode: string | null;
  hubClientId: string | null;
  deviceMaxIntensity: number;
  deviceMaxDurationMs: number;
  enabled: boolean;
  paused: boolean;
  minIntensity: number;
  maxIntensity: number;
  minDurationMs: number;
  maxDurationMs: number;
  vibMinIntensity?: number;
  vibMaxIntensity?: number;
  vibMinDurationMs?: number;
  vibMaxDurationMs?: number;
  beepMinIntensity?: number;
  beepMaxIntensity?: number;
  beepMinDurationMs?: number;
  beepMaxDurationMs?: number;
  requiredWarningLevel?: string | null;
  canShock: boolean;
  canVibrate: boolean;
  canBeep: boolean;
  canHold: boolean;
};

export type PersonalActivityLimits = Awaited<ReturnType<typeof getPersonalActivityLimits>>;

export type OperatePolicyDeps = {
  getPersonalActivityLimits: (discordUserId: string) => Promise<PersonalActivityLimits>;
  fetchControlSnapshot: (creds: PiShockCreds) => Promise<ControlSnapshot>;
  findActivityShareByCode: (shareCode: string) => Promise<ActivitySharePolicyRow | null>;
  findActivityShareByShocker: (
    discordUserId: string,
    shockerId: number,
  ) => Promise<ActivitySharePolicyRow | null>;
  getConsent: (discordUserId: string) => Promise<boolean>;
  isExecutorBanned: (
    ownerDiscordUserId: string,
    executorDiscordUserId: string,
  ) => Promise<boolean>;
  isEmergencyStopped: (discordUserId: string, shockerId: number) => Promise<boolean>;
};

const defaultOperatePolicyDeps: OperatePolicyDeps = {
  getPersonalActivityLimits,
  fetchControlSnapshot,
  findActivityShareByCode,
  findActivityShareByShocker,
  getConsent,
  isExecutorBanned,
  isEmergencyStopped,
};

function numField(row: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

function strField(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const v = row[key];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return null;
}

export function shockerIdOf(row: Record<string, unknown>): number | null {
  const id = numField(row, 'Id', 'id', 'ShockerId', 'shockerId');
  return id != null && id > 0 ? id : null;
}

export function shareCodeOf(row: Record<string, unknown>): string | null {
  return strField(row, 'ShareCode', 'shareCode', 'Code', 'code');
}

export function deviceMaxIntensityOf(row: Record<string, unknown>): number {
  const n = numField(row, 'MaxIntensity', 'maxIntensity', 'DeviceMaxIntensity');
  return Math.max(1, Math.min(ABS_MAX_INTENSITY, n ?? ABS_MAX_INTENSITY));
}

export function deviceMaxDurationMsOf(row: Record<string, unknown>): number {
  // PiShock may report seconds (MaxDuration) or ms
  const ms = numField(row, 'MaxDurationMs', 'maxDurationMs', 'deviceMaxDurationMs');
  if (ms != null) return Math.max(ABS_MIN_DURATION_MS, Math.min(ABS_MAX_DURATION_MS, ms));
  const sec = numField(row, 'MaxDuration', 'maxDuration', 'Duration');
  if (sec != null) {
    const asMs = sec <= 60 ? Math.round(sec * 1000) : sec;
    return Math.max(ABS_MIN_DURATION_MS, Math.min(ABS_MAX_DURATION_MS, asMs));
  }
  return ABS_MAX_DURATION_MS;
}

export function hubClientIdOf(row: Record<string, unknown>): string | null {
  return strField(row, 'ClientId', 'clientId', 'HubId', 'hubId');
}

export function findShockerInSnapshot(
  snapshot: ControlSnapshot,
  shockerId: number,
): Record<string, unknown> | null {
  for (const raw of snapshot.shockers) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    if (shockerIdOf(row) === shockerId) return row;
  }
  return null;
}

export function findClaimedShareInSnapshot(
  snapshot: ControlSnapshot,
  shareCode: string,
): Record<string, unknown> | null {
  const want = shareCode.trim().toLowerCase();
  for (const raw of snapshot.shared) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const code = shareCodeOf(row);
    if (code && code.toLowerCase() === want) return row;
  }
  return null;
}

export function ownedHubClientIds(snapshot: ControlSnapshot): Set<string> {
  const ids = new Set<string>();
  for (const raw of [...snapshot.hubs, ...snapshot.shockers]) {
    if (!raw || typeof raw !== 'object') continue;
    const id = hubClientIdOf(raw as Record<string, unknown>);
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * Resolve server-side caps for POST /api/operate.
 * Body ceilings / mode flags / clientId are never trusted.
 */
export async function resolveOwnOperatePolicy(
  callerDiscordUserId: string,
  creds: PiShockCreds,
  input: { shockerId?: number; shareCode?: string },
  deps: OperatePolicyDeps = defaultOperatePolicyDeps,
): Promise<ResolvedOperatePolicy> {
  const personal = await deps.getPersonalActivityLimits(callerDiscordUserId);
  const snapshot = await deps.fetchControlSnapshot(creds);

  if (input.shareCode) {
    const code = String(input.shareCode).trim();
    const registered = await deps.findActivityShareByCode(code);

    if (registered) {
      if (registered.discordUserId !== callerDiscordUserId) {
        if (!(await deps.getConsent(registered.discordUserId))) {
          throw new OperatePolicyError('Target has not consented', 403, 'TARGET_CONSENT');
        }
        if (await deps.isExecutorBanned(registered.discordUserId, callerDiscordUserId)) {
          throw new OperatePolicyError(
            'This user has blocked you from controlling their device',
            403,
            'BANNED',
          );
        }
        if (!registered.enabled || registered.paused) {
          throw new OperatePolicyError('Share is not available', 404, 'TARGET_UNAVAILABLE');
        }
        if (await deps.isEmergencyStopped(registered.discordUserId, registered.shockerId)) {
          throw new OperatePolicyError('Owner has emergency stop engaged', 423, 'EMERGENCY_STOP');
        }
        const shareBands = shareBandsFromRow(registered);
        return policyFromBands(
          {
            ownerDiscordUserId: registered.discordUserId,
            shockerId: registered.shockerId,
            shareCode: registered.shareCode,
            hubClientId: registered.hubClientId,
            flags: {
              canShock: registered.canShock,
              canVibrate: registered.canVibrate,
              canBeep: registered.canBeep,
              canHold: registered.canHold,
            },
            crossUser: true,
          },
          {
            shock: nestBands([shareBands.shock], registered.deviceMaxIntensity, registered.deviceMaxDurationMs),
            vibrate: nestBands([shareBands.vibrate], registered.deviceMaxIntensity, registered.deviceMaxDurationMs),
            beep: nestBands([shareBands.beep], registered.deviceMaxIntensity, registered.deviceMaxDurationMs),
          },
          shareBands.requiredWarningLevel,
        );
      }

      // Owner using their own activity share code — still honor e-stop + activity/share caps
      if (await deps.isEmergencyStopped(callerDiscordUserId, registered.shockerId)) {
        throw new OperatePolicyError(
          'Emergency stop is engaged — release STOP to allow commands',
          423,
          'EMERGENCY_STOP',
        );
      }
      const shareBands = shareBandsFromRow(registered);
      const personalBands = personalBandsFromUser(personal);
      return policyFromBands(
        {
          ownerDiscordUserId: callerDiscordUserId,
          shockerId: registered.shockerId,
          shareCode: registered.shareCode,
          hubClientId: registered.hubClientId,
          flags: {
            canShock: registered.canShock,
            canVibrate: registered.canVibrate,
            canBeep: registered.canBeep,
            canHold: registered.canHold,
          },
          crossUser: false,
        },
        {
          shock: nestBands(
            [shareBands.shock, personalBands.shock],
            registered.deviceMaxIntensity,
            registered.deviceMaxDurationMs,
          ),
          vibrate: nestBands(
            [shareBands.vibrate, personalBands.vibrate],
            registered.deviceMaxIntensity,
            registered.deviceMaxDurationMs,
          ),
          beep: nestBands(
            [shareBands.beep, personalBands.beep],
            registered.deviceMaxIntensity,
            registered.deviceMaxDurationMs,
          ),
        },
        shareBands.requiredWarningLevel !== 'none'
          ? shareBands.requiredWarningLevel
          : personalBands.requiredWarningLevel,
      );
    }

    // Claimed website share on the caller's PiShock account — not a Discord ActivityShare
    const claimed = findClaimedShareInSnapshot(snapshot, code);
    if (!claimed) {
      throw new OperatePolicyError('Unknown or unauthorized share code', 404, 'SHARE_UNKNOWN');
    }
    const claimedShockerId = shockerIdOf(claimed) ?? (input.shockerId ? Number(input.shockerId) : null);
    if (claimedShockerId != null && (await deps.isEmergencyStopped(callerDiscordUserId, claimedShockerId))) {
      throw new OperatePolicyError(
        'Emergency stop is engaged — release STOP to allow commands',
        423,
        'EMERGENCY_STOP',
      );
    }
    const deviceMaxI = deviceMaxIntensityOf(claimed);
    const deviceMaxD = deviceMaxDurationMsOf(claimed);
    const personalBands = personalBandsFromUser(personal);
    return policyFromBands(
      {
        ownerDiscordUserId: callerDiscordUserId,
        shockerId: claimedShockerId,
        shareCode: code,
        hubClientId: hubClientIdOf(claimed),
        flags: { canShock: true, canVibrate: true, canBeep: true, canHold: true },
        crossUser: false,
      },
      {
        shock: nestBands([personalBands.shock], deviceMaxI, deviceMaxD),
        vibrate: nestBands([personalBands.vibrate], deviceMaxI, deviceMaxD),
        beep: nestBands([personalBands.beep], deviceMaxI, deviceMaxD),
      },
      personalBands.requiredWarningLevel,
    );
  }

  const shockerId = Number(input.shockerId);
  if (!Number.isFinite(shockerId) || shockerId <= 0) {
    throw new OperatePolicyError('Missing shockerId or shareCode', 400, 'BAD_REQUEST');
  }

  if (await deps.isEmergencyStopped(callerDiscordUserId, shockerId)) {
    throw new OperatePolicyError(
      'Emergency stop is engaged — release STOP to allow commands',
      423,
      'EMERGENCY_STOP',
    );
  }

  const owned = findShockerInSnapshot(snapshot, shockerId);
  if (!owned) {
    throw new OperatePolicyError('Shocker not found on this PiShock account', 404, 'SHOCKER_UNKNOWN');
  }

  const activityShare = await deps.findActivityShareByShocker(callerDiscordUserId, shockerId);
  const deviceMaxI = activityShare
    ? Math.min(activityShare.deviceMaxIntensity, deviceMaxIntensityOf(owned))
    : deviceMaxIntensityOf(owned);
  const deviceMaxD = activityShare
    ? Math.min(activityShare.deviceMaxDurationMs, deviceMaxDurationMsOf(owned))
    : deviceMaxDurationMsOf(owned);

  const personalBands = personalBandsFromUser(personal);
  // Own-by-id: personal bands ∩ device ceilings only (share guest caps do not limit the owner).
  return policyFromBands(
    {
      ownerDiscordUserId: callerDiscordUserId,
      shockerId,
      shareCode: null,
      hubClientId: activityShare?.hubClientId ?? hubClientIdOf(owned),
      flags: activityShare
        ? {
            canShock: activityShare.canShock,
            canVibrate: activityShare.canVibrate,
            canBeep: activityShare.canBeep,
            canHold: activityShare.canHold,
          }
        : { canShock: true, canVibrate: true, canBeep: true, canHold: true },
      crossUser: false,
    },
    {
      shock: nestBands([personalBands.shock], deviceMaxI, deviceMaxD),
      vibrate: nestBands([personalBands.vibrate], deviceMaxI, deviceMaxD),
      beep: nestBands([personalBands.beep], deviceMaxI, deviceMaxD),
    },
    personalBands.requiredWarningLevel,
  );
}

export function holdTimerKey(ownerDiscordUserId: string, shockerId: number): string {
  return `${ownerDiscordUserId}:${shockerId}`;
}

export function clearHoldAutoEnd(ownerDiscordUserId: string, shockerId: number): void {
  const key = holdTimerKey(ownerDiscordUserId, shockerId);
  const existing = holdEndTimers.get(key);
  if (existing) {
    clearTimeout(existing);
    holdEndTimers.delete(key);
  }
}

/** Schedule a broker end frame so hold cannot run past the allowed duration. */
export function scheduleHoldAutoEnd(
  creds: PiShockCreds,
  opts: {
    ownerDiscordUserId: string;
    shockerId: number;
    clientId: string | number;
    durationMs: number;
    shareCode?: string | null;
    agentName?: string;
  },
): void {
  clearHoldAutoEnd(opts.ownerDiscordUserId, opts.shockerId);
  const delay = Math.max(ABS_MIN_DURATION_MS, opts.durationMs) + HOLD_AUTO_END_GRACE_MS;
  const timer = setTimeout(() => {
    holdEndTimers.delete(holdTimerKey(opts.ownerDiscordUserId, opts.shockerId));
    void publishOperate(creds, {
      clientId: opts.clientId,
      shockerId: opts.shockerId,
      operation: 'e',
      intensity: 0,
      durationMs: 0,
      end: true,
      shareCode: opts.shareCode ?? undefined,
      agentName: opts.agentName ?? 'Hold Limit',
    });
  }, delay);
  timer.unref?.();
  holdEndTimers.set(holdTimerKey(opts.ownerDiscordUserId, opts.shockerId), timer);
}

/** Resolve device ceilings from a live PiShock snapshot for share saves. */
export async function resolveDeviceCeilingsFromPiShock(
  creds: PiShockCreds,
  shockerId: number,
): Promise<{
  deviceMaxIntensity: number;
  deviceMaxDurationMs: number;
  hubClientId: string | null;
  found: boolean;
}> {
  const snapshot = await fetchControlSnapshot(creds);
  const owned = findShockerInSnapshot(snapshot, shockerId);
  if (!owned) {
    return {
      deviceMaxIntensity: ABS_MAX_INTENSITY,
      deviceMaxDurationMs: ABS_MAX_DURATION_MS,
      hubClientId: null,
      found: false,
    };
  }
  return {
    deviceMaxIntensity: deviceMaxIntensityOf(owned),
    deviceMaxDurationMs: deviceMaxDurationMsOf(owned),
    hubClientId: hubClientIdOf(owned),
    found: true,
  };
}

export function verifyOwnedClientId(
  snapshot: ControlSnapshot,
  clientId: string | number | null | undefined,
): string | null {
  if (clientId == null) return null;
  const want = String(clientId).trim();
  if (!want) return null;
  const owned = ownedHubClientIds(snapshot);
  return owned.has(want) ? want : null;
}
