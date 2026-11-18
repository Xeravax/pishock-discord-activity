import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from './api';
import { clearGlobalBan, getGlobalBan } from './hooks/useGlobalBan';

describe('apiFetch global ban', () => {
  beforeEach(() => {
    clearGlobalBan();
  });
  afterEach(() => {
    clearGlobalBan();
    vi.unstubAllGlobals();
  });

  it('marks the user banned when the API returns GLOBALLY_BANNED', async () => {
    const ban = {
      id: 'ban1',
      reason: 'Harassment of other members in the activity.',
      createdAt: '2026-11-18T12:00:00.000Z',
      expiresAt: null,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: 'banned', code: 'GLOBALLY_BANNED', ban }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(apiFetch('/operate', 'tok', { method: 'POST', body: '{}' })).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(getGlobalBan()).toEqual(expect.objectContaining(ban));
  });

  it('does not mark a ban for other 403s', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: 'blocked', code: 'BANNED' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    await expect(apiFetch('/operate', 'tok')).rejects.toBeInstanceOf(ApiError);
    expect(getGlobalBan()).toBeNull();
  });
});
