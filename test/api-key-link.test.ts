import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { validateApiKey } from '../src/server/pishock/auth-api.js';
import { PiShockApiError } from '../src/server/pishock/client.js';
import {
  assertManualApiKeyRateLimit,
  ManualLinkRateError,
  resetManualApiKeyRateLimitForTests,
} from '../src/server/pishock/manual-link-rate.js';
import {
  getPendingConfirm,
  setPendingConfirm,
} from '../src/server/pishock/pending-confirm.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetManualApiKeyRateLimitForTests();
});

describe('validateApiKey', () => {
  it('accepts a header-authenticated account and does not put the key in a URL', async () => {
    const urls: string[] = [];
    globalThis.fetch = async (input) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ UserId: 9, Username: 'Wearer' }), { status: 200 });
    };

    const account = await validateApiKey({
      apiKey: 'secret-key',
      username: 'wearer',
      userId: 9,
    });
    assert.equal(account.userId, 9);
    assert.equal(account.username, 'Wearer');
    assert.equal(account.style, 'apiKeyHeader');
    assert.equal(urls.length, 1);
    assert.equal(urls.some((url) => url.toLowerCase().includes('apikey=')), false);
    assert.equal(urls.some((url) => url.includes('secret-key')), false);
  });

  it('rejects a username that does not match the account', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ UserId: 9, Username: 'Wearer' }), { status: 200 });

    await assert.rejects(
      () => validateApiKey({ apiKey: 'secret-key', username: 'someone-else' }),
      (err: unknown) => {
        assert.ok(err instanceof PiShockApiError);
        assert.equal(err.body, 'API key does not belong to that username');
        return true;
      },
    );
  });

  it('does not trust the client username when Account JSON cannot be parsed', async () => {
    globalThis.fetch = async () => new Response('not-json', { status: 200 });

    await assert.rejects(
      () => validateApiKey({ apiKey: 'secret-key', username: 'wearer' }),
      (err: unknown) => {
        assert.ok(err instanceof PiShockApiError);
        assert.equal(err.status, 502);
        assert.equal(err.body.includes('wearer'), false);
        return true;
      },
    );
  });

  it('propagates non-401 PiShock failures instead of forcing 401', async () => {
    globalThis.fetch = async () => new Response('upstream busy', { status: 503 });

    await assert.rejects(
      () => validateApiKey({ apiKey: 'secret-key', username: 'wearer', userId: 9 }),
      (err: unknown) => {
        assert.ok(err instanceof PiShockApiError);
        assert.equal(err.status, 503);
        assert.equal(err.needsRelogin, false);
        return true;
      },
    );
  });

  it('still returns 401 when every account probe is unauthorized', async () => {
    globalThis.fetch = async () => new Response('Unauthorized', { status: 401 });

    await assert.rejects(
      () => validateApiKey({ apiKey: 'secret-key', username: 'wearer', userId: 9 }),
      (err: unknown) => {
        assert.ok(err instanceof PiShockApiError);
        assert.equal(err.status, 401);
        return true;
      },
    );
  });
});

describe('manual API key rate limit', () => {
  it('blocks the 9th attempt in the window', () => {
    for (let i = 0; i < 8; i++) assertManualApiKeyRateLimit('discord-1', 1_000);
    assert.throws(() => assertManualApiKeyRateLimit('discord-1', 1_000), ManualLinkRateError);
    assertManualApiKeyRateLimit('discord-2', 1_000);
  });
});

describe('pending confirm API key reuse', () => {
  it('keeps a minted key when login status refreshes the same account', () => {
    setPendingConfirm('discord-1', { UserId: 4, Token: 'session' }, ['Hub'], 'wearer', {
      apiKey: 'minted-key',
      apiKeyId: 3,
      expiry: null,
    });
    setPendingConfirm('discord-1', { UserId: 4, Token: 'session' }, ['Hub'], 'wearer');
    const pending = getPendingConfirm('discord-1');
    assert.equal(pending?.createdApiKey, 'minted-key');
    assert.equal(pending?.createdApiKeyId, 3);
  });
});
