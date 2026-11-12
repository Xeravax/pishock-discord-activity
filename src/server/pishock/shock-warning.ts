import type { IntensityDurationBand } from '../limit-bands.js';
import { clampDurationMs, clampIntensity } from '../operate-policy.js';
import {
  WARNING_PRESETS,
  WARNING_SHOCK_GAP_MS,
  atLeastWarning,
  normalizeWarningLevel,
  type WarningLevel,
} from '../../shared/warning.js';
import { isEmergencyStopped } from '../session.js';
import { publishOperate } from './broker.js';
import { ShockerOp } from '../../shared/constants.js';
import type { PiShockCreds } from './client.js';

/**
 * One vibration immediately before a shock or hold.
 * `warning.Active` is not a skip: the level is the higher of the request and the owner requirement.
 */
export class ShockWarningError extends Error {
  status: number;
  code: string;
  requiredWarningLevel?: WarningLevel;

  constructor(
    message: string,
    status: number,
    code: string,
    requiredWarningLevel?: WarningLevel,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.requiredWarningLevel = requiredWarningLevel;
  }
}

export function shockWarningBody(err: ShockWarningError): {
  error: string;
  code: string;
  requiredWarningLevel?: WarningLevel;
} {
  return {
    error: err.message,
    code: err.code,
    ...(err.requiredWarningLevel ? { requiredWarningLevel: err.requiredWarningLevel } : {}),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Publish the warning vibe and wait. Returns when the shock or hold may proceed.
 * A non-none level with no hub, a failed publish, or an emergency stop after the wait aborts.
 */
export async function warnBeforeShock(input: {
  operation: string;
  requestedWarningLevel: unknown;
  requiredWarningLevel: WarningLevel;
  canVibrate: boolean;
  creds: PiShockCreds;
  clientId: string | null;
  shockerId: number | null;
  shareCode?: string | null;
  ownerDiscordUserId: string;
  vibrateBand: IntensityDurationBand;
}): Promise<void> {
  if (input.operation !== 'shock' && input.operation !== 'hold') return;

  const level = atLeastWarning(
    normalizeWarningLevel(input.requestedWarningLevel),
    input.requiredWarningLevel,
  );
  if (level === 'none') return;

  if (!input.canVibrate) {
    const ownerRequired = input.requiredWarningLevel !== 'none';
    throw new ShockWarningError(
      ownerRequired
        ? 'Owner requires a warning vibe before shock, but vibrate is disabled'
        : 'Vibrate is disabled, so the warning before shock was not sent',
      405,
      'WARNING_REQUIRED',
      ownerRequired ? input.requiredWarningLevel : undefined,
    );
  }

  const clientId = input.clientId?.trim() || null;
  if (input.shockerId == null || !clientId) {
    throw new ShockWarningError(
      'Warning requires a hub client id',
      502,
      'WARNING_FAILED',
    );
  }

  const preset = WARNING_PRESETS[level];
  const warnIntensity = Math.max(
    1,
    clampIntensity(preset.intensity, input.vibrateBand.maxIntensity, input.vibrateBand.minIntensity),
  );
  const warnDuration = clampDurationMs(
    preset.durationMs,
    input.vibrateBand.maxDurationMs,
    input.vibrateBand.minDurationMs,
  );
  const published = await publishOperate(input.creds, {
    clientId,
    shockerId: input.shockerId,
    operation: ShockerOp.Vibrate,
    intensity: warnIntensity,
    durationMs: warnDuration,
    shareCode: input.shareCode ?? undefined,
    agentName: `Warning ${preset.label}`,
  });
  if (!published) {
    throw new ShockWarningError(
      'Warning vibe failed; shock was not sent',
      502,
      'WARNING_FAILED',
    );
  }

  await sleep(warnDuration + WARNING_SHOCK_GAP_MS);
  if (await isEmergencyStopped(input.ownerDiscordUserId, input.shockerId)) {
    throw new ShockWarningError(
      'Owner has emergency stop engaged',
      423,
      'EMERGENCY_STOP',
    );
  }
}
