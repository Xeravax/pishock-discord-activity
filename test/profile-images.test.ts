import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  deleteStoredProfileImages,
  getStoredProfileImage,
  localProfileUrls,
  mediaPublicPath,
  persistAccountImages,
  setProfileImageRootForTests,
} from '../src/server/pishock/profile-images.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const originalFetch = globalThis.fetch;
let tempRoot = '';

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pishock-profiles-'));
  setProfileImageRootForTests(tempRoot);
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  setProfileImageRootForTests(null);
  if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('persistAccountImages', () => {
  it('downloads remote images and rewrites to local media URLs', async () => {
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      return new Response(PNG_1X1, {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      });
    };

    const stored = await persistAccountImages(33675, {
      username: 'Xeravax',
      avatarUrl: 'https://cdn.example/UserImages/33675/Profile.png?v=abc123',
      bannerUrl: 'https://cdn.example/UserImages/33675/Banner.gif?v=def456',
    });

    assert.equal(stored.avatarUrl, mediaPublicPath(33675, 'avatar', 'abc123'));
    assert.equal(stored.bannerUrl, mediaPublicPath(33675, 'banner', 'def456'));
    assert.equal(calls.length, 2);

    const avatar = await getStoredProfileImage(33675, 'avatar');
    assert.ok(avatar);
    assert.equal(avatar.contentType, 'image/png');
    assert.equal(avatar.version, 'abc123');
    assert.deepEqual(avatar.buffer, PNG_1X1);

    const urls = await localProfileUrls(33675);
    assert.equal(urls.avatarUrl, stored.avatarUrl);
    assert.equal(urls.bannerUrl, stored.bannerUrl);
  });

  it('skips re-download when source version is unchanged', async () => {
    let fetches = 0;
    globalThis.fetch = async () => {
      fetches += 1;
      return new Response(PNG_1X1, {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      });
    };

    const source = {
      username: 'Xeravax',
      avatarUrl: 'https://cdn.example/Profile.png?v=same',
      bannerUrl: null,
    };
    await persistAccountImages(9, source);
    await persistAccountImages(9, source);
    assert.equal(fetches, 1);
  });

  it('stores data-URL images without network fetch', async () => {
    globalThis.fetch = async () => {
      throw new Error('fetch should not be called');
    };
    const dataUrl = `data:image/png;base64,${PNG_1X1.toString('base64')}`;
    const stored = await persistAccountImages(1, {
      username: 'n',
      avatarUrl: dataUrl,
      bannerUrl: null,
    });
    assert.ok(stored.avatarUrl?.startsWith('/api/pishock/media/1/avatar'));
    const avatar = await getStoredProfileImage(1, 'avatar');
    assert.ok(avatar);
    assert.deepEqual(avatar.buffer, PNG_1X1);
  });

  it('deletes stored files for a user', async () => {
    globalThis.fetch = async () =>
      new Response(PNG_1X1, { status: 200, headers: { 'Content-Type': 'image/png' } });
    await persistAccountImages(42, {
      username: 'x',
      avatarUrl: 'https://cdn.example/a.png?v=1',
      bannerUrl: null,
    });
    await deleteStoredProfileImages(42);
    assert.equal(await getStoredProfileImage(42, 'avatar'), null);
    assert.deepEqual(await localProfileUrls(42), { avatarUrl: null, bannerUrl: null });
  });
});
