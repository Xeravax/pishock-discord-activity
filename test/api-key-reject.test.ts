import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  PiShockApiError,
  createShare,
  fetchControlSnapshot,
  getHubs,
  getUserDevices,
  isPiShockApiKeyRejected,
  resetRejectedPiShockApiKeysForTests,
  type PiShockCreds,
} from '../src/server/pishock/client.js';

const originalFetch = globalThis.fetch;

function creds(token: string): PiShockCreds {
  return { userId: 7, username: 'wearer', token, mode: 'apiKey' };
}

function unauthorized(): Promise<Response> {
  return Promise.resolve(new Response('Unauthorized', { status: 401 }));
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetRejectedPiShockApiKeysForTests();
});

describe('rejected PiShock API keys', () => {
  it('stops calling PiShock after a confirmed 401', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return unauthorized();
    };

    const key = creds('revoked-key');
    await assert.rejects(() => getHubs(key), (err: unknown) => {
      assert.ok(err instanceof PiShockApiError);
      assert.equal(err.needsRelogin, true);
      return true;
    });
    const afterConfirm = calls;
    assert.ok(afterConfirm >= 1);
    assert.equal(isPiShockApiKeyRejected(key.token), true);

    await assert.rejects(() => getHubs(key), (err: unknown) => err instanceof PiShockApiError);
    await assert.rejects(
      () => getUserDevices(key),
      (err: unknown) => err instanceof PiShockApiError,
    );
    await assert.rejects(
      () => fetchControlSnapshot(key),
      (err: unknown) => err instanceof PiShockApiError,
    );
    assert.equal(calls, afterConfirm);
  });

  it('retires a key when the legacy device list returns 401', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return unauthorized();
    };
    const legacyOnly = creds('legacy-revoked');
    await assert.rejects(() => getUserDevices(legacyOnly), (err: unknown) => {
      assert.ok(err instanceof PiShockApiError);
      assert.equal(err.needsRelogin, true);
      return true;
    });
    assert.equal(isPiShockApiKeyRejected(legacyOnly.token), true);
    const afterLegacy = calls;
    await assert.rejects(() => getUserDevices(legacyOnly));
    assert.equal(calls, afterLegacy);
  });

  it('does not retire a key when only share creation returns 401', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return unauthorized();
    };

    const key = creds('share-false-401');
    await assert.rejects(() => createShare(key, { ShockerId: 4 }), (err: unknown) => {
      assert.ok(err instanceof PiShockApiError);
      assert.equal(err.needsRelogin, false);
      return true;
    });
    assert.equal(isPiShockApiKeyRejected(key.token), false);
    const afterShare = calls;

    await assert.rejects(() => getHubs(key), (err: unknown) => err instanceof PiShockApiError);
    assert.ok(calls > afterShare);
    assert.equal(isPiShockApiKeyRejected(key.token), true);
  });
});
