import type { PiShockCreds } from './pishock/client.js';
import { fetchControlSnapshot, type ControlSnapshot } from './pishock/client.js';
import {
  publishOperate,
  stopAcceptingCommands,
  waitForInflightCommands,
} from './pishock/broker.js';
import {
  findActivityShareByCode,
  findActivityShareByShocker,
  getConsent,
  getPersonalActivityLimits,
  isEmergencyStopped,
  isExecutorBanned,
  getCommandQueueSettings,
  isQueueStarred,
} from './session.js';
import {
  LIMIT_BAND_CONFLICT_MESSAGE,
  nestBands,
  personalBandsFromUser,
  setLimitBandConflictFactory,
  shareBandsFromRow,
  type ModeLimitBands,
} from './limit-bands.js';
import {
  atLeastWarning,
  type WarningLevel,
} from '../shared/warning.js';
import { isPiShockRowPaused } from '../shared/pishock-pause.js';

/** Absolute hardware floors / ceilings used by every operate path. */
export const ABS_MIN_INTENSITY = 1;
export const ABS_MAX_INTENSITY = 100;
export const ABS_MIN_DURATION_MS = 16;
export const ABS_MAX_DURATION_MS = 15_000;

/** Nest activity floors/ceilings: max(mins) ∩ min(maxes). An empty intersection throws. */
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
  min = Math.max(absMin, Math.min(absMax, min));
  if (min > max) {
    throw new OperatePolicyError(LIMIT_BAND_CONFLICT_MESSAGE, 400, 'LIMIT_CONFLICT');
  }
  return { min, max };
}

/** Hold frames without a client end are cut off after the clamped duration. */
export const HOLD_AUTO_END_GRACE_MS = 250;

const OPERATE_RATE_WINDOW_MS = 60_000;
const OPERATE_RATE_MAX = 30;

const rateBuckets = new Map<string, number[]>();
type HoldAutoEnd = {
  timer: ReturnType<typeof setTimeout>;
  /** Sends the broker end frame for this hold (also used to flush on shutdown). */
  sendEnd: () => Promise<boolean>;
};
const holdEndTimers = new Map<string, HoldAutoEnd>();
/** End frames currently on the wire (timer-fired or drain-initiated). */
const endFramesInFlight = new Set<Promise<boolean>>();
/** Set once shutdown starts draining holds; new holds are then ended immediately. */
let holdDrain: { promise: Promise<number>; acknowledged: number } | null = null;

export type OperateModeFlags = {
  canShock: boolean;
  canVibrate: boolean;
  canBeep: boolean;
  canHold: boolean;
};

export type ResolvedOperatePolicy = {
  ownerDiscordUserId: string;
  shockerId: number | null;
  /** PiShock device name, or the activity share name when that is what users see. */
  shockerName: string | null;
  shareCode: string | null;
  hubClientId: string | null;
  /** PiShock hub display name when resolvable from hubs/share. */
  hubName: string | null;
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

setLimitBandConflictFactory(
  (message) => new OperatePolicyError(message, 400, 'LIMIT_CONFLICT'),
);

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
  const inten = Number(intensity ?? minIntensity);
  const dur = Number(durationMs ?? clampDurationMs(undefined, maxDurationMs, minDurationMs));
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
  shockerName?: string | null;
  shareCode: string | null;
  hubClientId: string | null;
  hubName?: string | null;
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
  /** Wearer has "Favorites only" on and the caller is not one of their favorites. */
  isFavoritesOnlyBlocked?: (ownerDiscordUserId: string, callerDiscordUserId: string) => Promise<boolean>;
  /** Owner PiShock credentials, when this process can load them. */
  loadOwnerPiShockCreds?: (discordUserId: string) => Promise<PiShockCreds | null>;
  /** Pause check that already has the owner's credentials. Do not call with the caller's key. */
  ownerShockerPauseBlocks?: (
    discordUserId: string,
    creds: PiShockCreds,
    shockerId: number,
  ) => Promise<boolean>;
};

const defaultOperatePolicyDeps: OperatePolicyDeps = {
  getPersonalActivityLimits,
  fetchControlSnapshot,
  findActivityShareByCode,
  findActivityShareByShocker,
  getConsent,
  isExecutorBanned,
  isEmergencyStopped,
  isFavoritesOnlyBlocked: async (owner, caller) =>
    (await getCommandQueueSettings(owner)).starOnly && !(await isQueueStarred(owner, caller)),
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

export function cleanShockerName(value: string | null | undefined): string | null {
  const name = value?.trim();
  return name ? name.slice(0, 120) : null;
}

export function shockerNameOf(row: Record<string, unknown>): string | null {
  return cleanShockerName(strField(row, 'Name', 'name', 'ShockerName', 'shockerName'));
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

export function hubNameOf(row: Record<string, unknown>): string | null {
  const name = strField(row, 'Name', 'name', 'HubName', 'hubName');
  return name ? name.slice(0, 120) : null;
}

/** Match a hub client id against the live hubs list and return its display name. */
export function findHubNameInSnapshot(
  snapshot: ControlSnapshot,
  clientId: string | null | undefined,
): string | null {
  if (clientId == null) return null;
  const want = String(clientId).trim();
  if (!want) return null;
  for (const raw of snapshot.hubs) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const id = hubClientIdOf(row);
    if (id && id === want) return hubNameOf(row);
  }
  return null;
}

function resolveHubName(
  snapshot: ControlSnapshot,
  clientId: string | null | undefined,
  storedName?: string | null,
): string | null {
  const fromShare = cleanShockerName(storedName);
  if (fromShare) return fromShare;
  return findHubNameInSnapshot(snapshot, clientId);
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
  depsInput: Partial<OperatePolicyDeps> = {},
): Promise<ResolvedOperatePolicy> {
  const deps: OperatePolicyDeps = { ...defaultOperatePolicyDeps, ...depsInput };
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
        if (
          deps.isFavoritesOnlyBlocked &&
          (await deps.isFavoritesOnlyBlocked(registered.discordUserId, callerDiscordUserId))
        ) {
          throw new OperatePolicyError(
            'This person only accepts commands from their favorites',
            403,
            'FAVORITES_ONLY',
          );
        }
        if (!registered.enabled || registered.paused) {
          throw new OperatePolicyError('Share is not available', 404, 'TARGET_UNAVAILABLE');
        }
        if (await deps.isEmergencyStopped(registered.discordUserId, registered.shockerId)) {
          throw new OperatePolicyError('Owner has emergency stop engaged', 423, 'EMERGENCY_STOP');
        }
        if (deps.loadOwnerPiShockCreds && deps.ownerShockerPauseBlocks) {
          const ownerCreds = await deps.loadOwnerPiShockCreds(registered.discordUserId);
          if (
            ownerCreds &&
            (await deps.ownerShockerPauseBlocks(
              registered.discordUserId,
              ownerCreds,
              registered.shockerId,
            ))
          ) {
            throw new OperatePolicyError(
              'This shocker or share is paused on PiShock',
              503,
              'PISHOCK_PAUSED',
            );
          }
        }
        const shareBands = shareBandsFromRow(registered);
        const ownerPersonal = personalBandsFromUser(
          await deps.getPersonalActivityLimits(registered.discordUserId),
        );
        return policyFromBands(
          {
            ownerDiscordUserId: registered.discordUserId,
            shockerId: registered.shockerId,
            shockerName: cleanShockerName(registered.shockerName),
            shareCode: registered.shareCode,
            hubClientId: registered.hubClientId,
            hubName: resolveHubName(snapshot, registered.hubClientId, registered.hubName),
            flags: {
              canShock: registered.canShock,
              canVibrate: registered.canVibrate,
              canBeep: registered.canBeep,
              canHold: registered.canHold,
            },
            crossUser: true,
          },
          {
            shock: nestBands(
              [shareBands.shock, ownerPersonal.shock],
              registered.deviceMaxIntensity,
              registered.deviceMaxDurationMs,
            ),
            vibrate: nestBands(
              [shareBands.vibrate, ownerPersonal.vibrate],
              registered.deviceMaxIntensity,
              registered.deviceMaxDurationMs,
            ),
            beep: nestBands(
              [shareBands.beep, ownerPersonal.beep],
              registered.deviceMaxIntensity,
              registered.deviceMaxDurationMs,
            ),
          },
          atLeastWarning(shareBands.requiredWarningLevel, ownerPersonal.requiredWarningLevel),
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
          shockerName: cleanShockerName(registered.shockerName),
          shareCode: registered.shareCode,
          hubClientId: registered.hubClientId,
          hubName: resolveHubName(snapshot, registered.hubClientId, registered.hubName),
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
        atLeastWarning(shareBands.requiredWarningLevel, personalBands.requiredWarningLevel),
      );
    }

    // Claimed website share on the caller's PiShock account — not a Discord ActivityShare
    const claimed = findClaimedShareInSnapshot(snapshot, code);
    if (!claimed) {
      throw new OperatePolicyError('Unknown or unauthorized share code', 404, 'SHARE_UNKNOWN');
    }
    const claimedShockerId = shockerIdOf(claimed) ?? (input.shockerId ? Number(input.shockerId) : null);
    if (isPiShockRowPaused(claimed)) {
      throw new OperatePolicyError(
        'This shocker or share is paused on PiShock',
        503,
        'PISHOCK_PAUSED',
      );
    }
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
        shockerName: shockerNameOf(claimed),
        shareCode: code,
        hubClientId: hubClientIdOf(claimed),
        hubName: resolveHubName(snapshot, hubClientIdOf(claimed)),
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
  if (isPiShockRowPaused(owned)) {
    throw new OperatePolicyError(
      'This shocker or share is paused on PiShock',
      503,
      'PISHOCK_PAUSED',
    );
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
      shockerName: cleanShockerName(activityShare?.shockerName) ?? shockerNameOf(owned),
      shareCode: null,
      hubClientId: activityShare?.hubClientId ?? hubClientIdOf(owned),
      hubName: resolveHubName(
        snapshot,
        activityShare?.hubClientId ?? hubClientIdOf(owned),
        activityShare?.hubName,
      ),
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

/** Generation of a hold that is waiting out its warning before the shock starts. */
const pendingHolds = new Map<string, number>();

export function beginPendingHold(ownerDiscordUserId: string, shockerId: number): number {
  const key = holdTimerKey(ownerDiscordUserId, shockerId);
  const next = (pendingHolds.get(key) ?? 0) + 1;
  pendingHolds.set(key, next);
  return next;
}

/** A release during the warning wait invalidates the hold that has not started yet. */
export function cancelPendingHold(ownerDiscordUserId: string, shockerId: number): void {
  const key = holdTimerKey(ownerDiscordUserId, shockerId);
  pendingHolds.set(key, (pendingHolds.get(key) ?? 0) + 1);
}

export function isPendingHoldCurrent(
  ownerDiscordUserId: string,
  shockerId: number,
  token: number,
): boolean {
  return pendingHolds.get(holdTimerKey(ownerDiscordUserId, shockerId)) === token;
}

export function clearHoldAutoEnd(ownerDiscordUserId: string, shockerId: number): void {
  const key = holdTimerKey(ownerDiscordUserId, shockerId);
  const existing = holdEndTimers.get(key);
  if (existing) {
    clearTimeout(existing.timer);
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
  publish: typeof publishOperate = publishOperate,
): void {
  clearHoldAutoEnd(opts.ownerDiscordUserId, opts.shockerId);
  const key = holdTimerKey(opts.ownerDiscordUserId, opts.shockerId);
  const delay = Math.max(ABS_MIN_DURATION_MS, opts.durationMs) + HOLD_AUTO_END_GRACE_MS;
  const sendEnd = () =>
    publish(creds, {
      clientId: opts.clientId,
      shockerId: opts.shockerId,
      operation: 'e',
      intensity: 0,
      durationMs: 0,
      end: true,
      shareCode: opts.shareCode ?? undefined,
      agentName: opts.agentName ?? 'Hold Limit',
    });
  if (holdDrain) {
    // Shutdown is draining: a hold whose publish was still in flight when the drain started
    // must not get a timer that dies with this process — end it right now instead.
    const drain = holdDrain;
    trackEndFrame(sendEnd, () => {
      drain.acknowledged += 1;
    });
    return;
  }
  const timer = setTimeout(() => {
    holdEndTimers.delete(key);
    trackEndFrame(sendEnd);
  }, delay);
  timer.unref?.();
  holdEndTimers.set(key, { timer, sendEnd });
}

/** Send an end frame and keep it visible to the shutdown drain until it settles. */
function trackEndFrame(sendEnd: () => Promise<boolean>, onAck?: () => void): void {
  const sent = sendEnd().then(
    (ok) => {
      if (ok) onAck?.();
      return ok;
    },
    // Best effort: the broker socket may already be gone.
    () => false,
  );
  endFramesInFlight.add(sent);
  void sent.finally(() => endFramesInFlight.delete(sent));
}

/** Number of holds whose auto-end timer is still pending (diagnostics / tests). */
export function activeHoldCount(): number {
  return holdEndTimers.size;
}

export type HoldDrainDeps = {
  stopAcceptingCommands: () => void;
  waitForInflightCommands: () => Promise<void>;
};

const defaultHoldDrainDeps: HoldDrainDeps = { stopAcceptingCommands, waitForInflightCommands };

async function drainHolds(drain: { acknowledged: number }, deps: HoldDrainDeps): Promise<number> {
  // 1. No new device commands from any path (direct operate, friend operate, queue).
  deps.stopAcceptingCommands();
  // 2. End every hold whose timer is already registered.
  const pending = [...holdEndTimers.values()];
  holdEndTimers.clear();
  for (const entry of pending) {
    clearTimeout(entry.timer);
    trackEndFrame(entry.sendEnd, () => {
      drain.acknowledged += 1;
    });
  }
  // 3. Commands admitted before step 1 may still be on the wire. Once they settle, their
  //    callers register holds synchronously; scheduleHoldAutoEnd ends those immediately.
  await deps.waitForInflightCommands();
  await new Promise<void>((resolve) => setImmediate(resolve));
  // 4. Wait for every end frame (including timer-fired ones) to be acknowledged or fail.
  while (endFramesInFlight.size > 0) {
    await Promise.allSettled([...endFramesInFlight]);
  }
  return drain.acknowledged;
}

/**
 * Graceful shutdown / crash: hold auto-end timers live only in this process, so stop admitting
 * commands and send every hold's end frame now, instead of leaving a hold running unsupervised.
 *
 * The drain runs once and is shared: an overlapping caller (SIGTERM and a crash handler) waits
 * for the same drain, each bounded by its own `timeoutMs`. Resolves with the number of end
 * frames the broker acknowledged so far. A hard kill (SIGKILL/OOM) cannot run this — see README
 * "Restarts & safety".
 */
export async function endAllActiveHolds(
  timeoutMs = 3_000,
  deps: HoldDrainDeps = defaultHoldDrainDeps,
): Promise<number> {
  if (!holdDrain) {
    const drain = { promise: Promise.resolve(0), acknowledged: 0 };
    holdDrain = drain;
    drain.promise = drainHolds(drain, deps);
  }
  const drain = holdDrain;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<number>((resolve) => {
    timer = setTimeout(() => resolve(drain.acknowledged), timeoutMs);
  });
  try {
    return await Promise.race([drain.promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Test-only: forget a completed drain so later tests can schedule holds normally. */
export function resetHoldDrainForTests(): void {
  holdDrain = null;
}

/** Resolve device ceilings from a live PiShock snapshot for share saves. */
export async function resolveDeviceCeilingsFromPiShock(
  creds: PiShockCreds,
  shockerId: number,
): Promise<{
  deviceMaxIntensity: number;
  deviceMaxDurationMs: number;
  hubClientId: string | null;
  hubName: string | null;
  found: boolean;
}> {
  const snapshot = await fetchControlSnapshot(creds, { fresh: true });
  const owned = findShockerInSnapshot(snapshot, shockerId);
  if (!owned) {
    return {
      deviceMaxIntensity: ABS_MAX_INTENSITY,
      deviceMaxDurationMs: ABS_MAX_DURATION_MS,
      hubClientId: null,
      hubName: null,
      found: false,
    };
  }
  const hubClientId = hubClientIdOf(owned);
  return {
    deviceMaxIntensity: deviceMaxIntensityOf(owned),
    deviceMaxDurationMs: deviceMaxDurationMsOf(owned),
    hubClientId,
    hubName: findHubNameInSnapshot(snapshot, hubClientId),
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
