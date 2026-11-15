/** Canonical safety acknowledgements — client must send these exact strings. */
export const SAFETY_ACK_ITEMS = [
  'I accept full responsibility for safe use and understand my actions will deliver real electronic shocks to other users',
  'I understand device owners can block me and developers cannot override these blocks or restore my access',
  'I understand this controls real electronic shock devices physically attached to other users',
  'I understand developers bear no liability for any harm, injury, or adverse effects from using this application',
  'I confirm voluntary participation with full knowledge of risks',
] as const;

export const SAFETY_ACK_VERSION = 1;

export function validateConsentAcknowledgements(body: unknown): {
  ok: true;
} | {
  ok: false;
  error: string;
} {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Consent body required' };
  }
  const row = body as {
    acknowledged?: boolean;
    items?: unknown;
    version?: unknown;
  };
  if (row.acknowledged !== true) {
    return { ok: false, error: 'All safety items must be acknowledged' };
  }
  if (row.version != null && Number(row.version) !== SAFETY_ACK_VERSION) {
    return { ok: false, error: 'Outdated safety acknowledgement version' };
  }
  if (!Array.isArray(row.items)) {
    return { ok: false, error: 'Consent items required' };
  }
  const items = row.items.map((x) => String(x));
  if (items.length !== SAFETY_ACK_ITEMS.length) {
    return { ok: false, error: 'All safety items must be acknowledged' };
  }
  for (let i = 0; i < SAFETY_ACK_ITEMS.length; i++) {
    if (items[i] !== SAFETY_ACK_ITEMS[i]) {
      return { ok: false, error: 'Safety acknowledgement text mismatch' };
    }
  }
  return { ok: true };
}
