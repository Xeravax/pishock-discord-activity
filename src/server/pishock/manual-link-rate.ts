const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

const buckets = new Map<string, number[]>();

export class ManualLinkRateError extends Error {
  status = 429;
  code = 'RATE_LIMIT';

  constructor() {
    super('Too many API key attempts — wait a few minutes and try again');
  }
}

/** Limit manual API-key linking per Discord user. */
export function assertManualApiKeyRateLimit(discordUserId: string, now = Date.now()): void {
  const prev = buckets.get(discordUserId) ?? [];
  const recent = prev.filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_ATTEMPTS) {
    buckets.set(discordUserId, recent);
    throw new ManualLinkRateError();
  }
  recent.push(now);
  buckets.set(discordUserId, recent);
}

export function resetManualApiKeyRateLimitForTests(): void {
  buckets.clear();
}
