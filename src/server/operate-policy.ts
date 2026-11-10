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

/** Absolute hardware ceilings used by every operate path. */
export const ABS_MAX_INTENSITY = 100;
export const ABS_MAX_DURATION_MS = 15_000;
export const ABS_MIN_DURATION_MS = 16;

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
  maxIntensity: number;
  maxDurationMs: number;
  flags: OperateModeFlags;
  /** True when the caller is operating someone else's device via a registered share. */
  crossUser: boolean;
};

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

export function clampIntensity(value: unknown, max: number): number {
  return Math.max(0, Math.min(ABS_MAX_INTENSITY, Math.min(max, Number(value ?? 1))));
}

export function clampDurationMs(value: unknown, max: number): number {
  return Math.max(
    ABS_MIN_DURATION_MS,
    Math.min(ABS_MAX_DURATION_MS, Math.min(max, Number(value ?? 300))),
  );
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
): Promise<ResolvedOperatePolicy> {
  const personal = await getPersonalActivityLimits(callerDiscordUserId);
  const snapshot = await fetchControlSnapshot(creds);

  if (input.shareCode) {
    const code = String(input.shareCode).trim();
    const registered = await findActivityShareByCode(code);

    if (registered) {
      if (registered.discordUserId !== callerDiscordUserId) {
        if (!(await getConsent(registered.discordUserId))) {
          throw new OperatePolicyError('Target has not consented', 403, 'TARGET_CONSENT');
        }
        if (await isExecutorBanned(registered.discordUserId, callerDiscordUserId)) {
          throw new OperatePolicyError(
            'This user has blocked you from controlling their device',
            403,
            'BANNED',
          );
        }
        if (!registered.enabled || registered.paused) {
          throw new OperatePolicyError('Share is not available', 404, 'TARGET_UNAVAILABLE');
        }
        if (await isEmergencyStopped(registered.discordUserId, registered.shockerId)) {
          throw new OperatePolicyError('Owner has emergency stop engaged', 423, 'EMERGENCY_STOP');
        }
        return {
          ownerDiscordUserId: registered.discordUserId,
          shockerId: registered.shockerId,
          shareCode: registered.shareCode,
          hubClientId: registered.hubClientId,
          maxIntensity: Math.min(registered.maxIntensity, registered.deviceMaxIntensity),
          maxDurationMs: Math.min(registered.maxDurationMs, registered.deviceMaxDurationMs),
          flags: {
            canShock: registered.canShock,
            canVibrate: registered.canVibrate,
            canBeep: registered.canBeep,
            canHold: registered.canHold,
          },
          crossUser: true,
        };
      }

      // Owner using their own activity share code — still honor e-stop + activity/share caps
      if (await isEmergencyStopped(callerDiscordUserId, registered.shockerId)) {
        throw new OperatePolicyError(
          'Emergency stop is engaged — release STOP to allow commands',
          423,
          'EMERGENCY_STOP',
        );
      }
      return {
        ownerDiscordUserId: callerDiscordUserId,
        shockerId: registered.shockerId,
        shareCode: registered.shareCode,
        hubClientId: registered.hubClientId,
        maxIntensity: Math.min(
          registered.maxIntensity,
          registered.deviceMaxIntensity,
          personal.activityMaxIntensity,
        ),
        maxDurationMs: Math.min(
          registered.maxDurationMs,
          registered.deviceMaxDurationMs,
          personal.activityMaxDurationMs,
        ),
        flags: {
          canShock: registered.canShock,
          canVibrate: registered.canVibrate,
          canBeep: registered.canBeep,
          canHold: registered.canHold,
        },
        crossUser: false,
      };
    }

    // Claimed website share on the caller's PiShock account — not a Discord ActivityShare
    const claimed = findClaimedShareInSnapshot(snapshot, code);
    if (!claimed) {
      throw new OperatePolicyError('Unknown or unauthorized share code', 404, 'SHARE_UNKNOWN');
    }
    const claimedShockerId = shockerIdOf(claimed) ?? (input.shockerId ? Number(input.shockerId) : null);
    if (claimedShockerId != null && (await isEmergencyStopped(callerDiscordUserId, claimedShockerId))) {
      throw new OperatePolicyError(
        'Emergency stop is engaged — release STOP to allow commands',
        423,
        'EMERGENCY_STOP',
      );
    }
    const deviceMaxI = deviceMaxIntensityOf(claimed);
    const deviceMaxD = deviceMaxDurationMsOf(claimed);
    return {
      ownerDiscordUserId: callerDiscordUserId,
      shockerId: claimedShockerId,
      shareCode: code,
      hubClientId: hubClientIdOf(claimed),
      maxIntensity: Math.min(deviceMaxI, personal.activityMaxIntensity),
      maxDurationMs: Math.min(deviceMaxD, personal.activityMaxDurationMs),
      flags: { canShock: true, canVibrate: true, canBeep: true, canHold: true },
      crossUser: false,
    };
  }

  const shockerId = Number(input.shockerId);
  if (!Number.isFinite(shockerId) || shockerId <= 0) {
    throw new OperatePolicyError('Missing shockerId or shareCode', 400, 'BAD_REQUEST');
  }

  if (await isEmergencyStopped(callerDiscordUserId, shockerId)) {
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

  const activityShare = await findActivityShareByShocker(callerDiscordUserId, shockerId);
  const deviceMaxI = activityShare
    ? Math.min(activityShare.deviceMaxIntensity, deviceMaxIntensityOf(owned))
    : deviceMaxIntensityOf(owned);
  const deviceMaxD = activityShare
    ? Math.min(activityShare.deviceMaxDurationMs, deviceMaxDurationMsOf(owned))
    : deviceMaxDurationMsOf(owned);

  return {
    ownerDiscordUserId: callerDiscordUserId,
    shockerId,
    shareCode: null,
    hubClientId: activityShare?.hubClientId ?? hubClientIdOf(owned),
    maxIntensity: Math.min(deviceMaxI, personal.activityMaxIntensity),
    maxDurationMs: Math.min(deviceMaxD, personal.activityMaxDurationMs),
    flags: activityShare
      ? {
          canShock: activityShare.canShock,
          canVibrate: activityShare.canVibrate,
          canBeep: activityShare.canBeep,
          canHold: activityShare.canHold,
        }
      : { canShock: true, canVibrate: true, canBeep: true, canHold: true },
    crossUser: false,
  };
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
