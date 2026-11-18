/**
 * Admin bypass.
 *
 * Admins (ADMIN_DISCORD_USER_IDS) may opt in per command to skip the wearer's soft gates
 * (favorites only, cooldowns, shock budget, queue line) and approve-each. Exceeding the
 * wearer's limits additionally needs the wearer's explicit consent, granted through three
 * separate confirmations that the server enforces in order.
 *
 * Never bypassable: E-STOP, consent / 18+ gate, blocks, paused shares (incl. missed
 * check-ins), PiShock pause, mode permissions, required warning, PiShock device max.
 * Every bypass is logged (CommandLog.adminBypass) and the wearer is notified.
 */
import { randomBytes } from 'node:crypto';
import type { SafetyGate } from './wearer-safety.js';

export type BypassGate = SafetyGate | 'queue' | 'limits';

/** Gates an admin may skip without the wearer's limit consent. */
export const ADMIN_SOFT_GATES: ReadonlySet<SafetyGate> = new Set([
  'favorites',
  'cooldown',
  'budget',
  'approval',
]);

/** Bump when the consent wording changes in a way that needs a fresh consent. */
export const ADMIN_CONSENT_VERSION = 1;
export const ADMIN_CONSENT_PHRASE = 'I CONSENT';
export const ADMIN_CONSENT_STEP_TTL_MS = 5 * 60_000;

export function isAdmin(admins: ReadonlySet<string>, discordUserId: string): boolean {
  return admins.has(discordUserId);
}

/** Consent is valid only for the current wording. */
export function hasLimitConsent(row: {
  adminLimitOverrideConsentAt: Date | null;
  adminLimitOverrideConsentVersion: number | null;
} | null): boolean {
  return Boolean(
    row?.adminLimitOverrideConsentAt && row.adminLimitOverrideConsentVersion === ADMIN_CONSENT_VERSION,
  );
}

export class AdminConsentError extends Error {
  readonly status = 400;
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Three-step consent: step 1 issues a nonce; steps 2 and 3 must present it, in order,
 * within the TTL; step 3 also needs the typed phrase. A single click (or a replayed
 * request) can never grant consent.
 */
export function createAdminConsentFlow(now: () => number = () => Date.now()) {
  const pending = new Map<string, { nonce: string; step: 1 | 2; expiresAt: number }>();

  return {
    step(
      ownerDiscordUserId: string,
      input: { step?: unknown; nonce?: unknown; phrase?: unknown },
    ): { nonce: string; nextStep: 2 | 3 } | { complete: true } {
      const step = Number(input.step);
      if (step === 1) {
        const nonce = randomBytes(16).toString('hex');
        pending.set(ownerDiscordUserId, { nonce, step: 1, expiresAt: now() + ADMIN_CONSENT_STEP_TTL_MS });
        return { nonce, nextStep: 2 };
      }
      const cur = pending.get(ownerDiscordUserId);
      if (!cur || cur.expiresAt < now()) {
        pending.delete(ownerDiscordUserId);
        throw new AdminConsentError('Consent expired — start again', 'CONSENT_EXPIRED');
      }
      if (typeof input.nonce !== 'string' || input.nonce !== cur.nonce) {
        pending.delete(ownerDiscordUserId);
        throw new AdminConsentError('Consent steps out of order — start again', 'CONSENT_ORDER');
      }
      if (step === 2 && cur.step === 1) {
        const nonce = randomBytes(16).toString('hex');
        pending.set(ownerDiscordUserId, { nonce, step: 2, expiresAt: now() + ADMIN_CONSENT_STEP_TTL_MS });
        return { nonce, nextStep: 3 };
      }
      if (step === 3 && cur.step === 2) {
        if (String(input.phrase ?? '').trim().toUpperCase() !== ADMIN_CONSENT_PHRASE) {
          throw new AdminConsentError(`Type ${ADMIN_CONSENT_PHRASE} to confirm`, 'CONSENT_PHRASE');
        }
        pending.delete(ownerDiscordUserId);
        return { complete: true };
      }
      pending.delete(ownerDiscordUserId);
      throw new AdminConsentError('Consent steps out of order — start again', 'CONSENT_ORDER');
    },
    cancel(ownerDiscordUserId: string) {
      pending.delete(ownerDiscordUserId);
    },
  };
}

export type AdminConsentFlow = ReturnType<typeof createAdminConsentFlow>;
