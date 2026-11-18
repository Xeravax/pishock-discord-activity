import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toAdminProfile, type AdminProfileInput } from '../src/server/admin-panel.js';
import {
  BAN_REASON_MAX,
  isAllowedWhileBanned,
  isBanActive,
  normalizeBanDuration,
  normalizeBanReason,
} from '../src/server/services/global-bans.js';
import { normalizeNotice } from '../src/server/services/app-settings.js';

const NOW = Date.parse('2026-11-20T12:00:00Z');

function input(over: Partial<AdminProfileInput> = {}): AdminProfileInput {
  return {
    id: '123456789',
    user: {
      id: '123456789',
      username: 'someone',
      globalName: 'Someone',
      avatar: null,
      consentAt: new Date(NOW - 1000),
      createdAt: new Date(NOW - 86_400_000),
      lastSeenAt: new Date(NOW - 5000),
      emergencyStopShockerIds: [42],
      commandQueueEnabled: true,
      favoritesOnly: false,
      approveEachCommand: true,
      budgetEnabled: false,
      checkInEnabled: false,
      perPersonLimitsEnabled: true,
      rouletteAllowed: false,
      recapDmEnabled: false,
      adminLimitOverrideConsentAt: null,
    },
    online: true,
    isAdmin: false,
    pishockLinked: true,
    shares: [
      { enabled: true, paused: false },
      { enabled: true, paused: true },
    ],
    sent: [{ action: 'shock', count: 3 }],
    received: [{ action: 'vibrate', count: 7 }],
    adminBypassesReceived: 1,
    blockedByCount: 2,
    blocksSetCount: 0,
    deletionPending: false,
    bans: [],
    now: NOW,
    ...over,
  };
}

describe('admin profile', () => {
  it('summarises counts and flags', () => {
    const p = toAdminProfile(input());
    assert.equal(p.consented, true);
    assert.equal(p.pishockLinked, true);
    assert.deepEqual(p.shares, { total: 2, enabled: 2, paused: 1 });
    assert.equal(p.features.approveEach, true);
    assert.equal(p.features.perPersonLimits, true);
    assert.equal(p.emergencyStopEngaged, true);
    assert.deepEqual(p.stats.sent, { shock: 3 });
    assert.deepEqual(p.stats.received, { vibrate: 7 });
  });

  it('never carries sensitive data, even when the source rows do', () => {
    const leaky = input();
    // Simulate a careless select: secrets and personal details on the row.
    Object.assign(leaky.user!, {
      encryptedToken: 'SECRET',
      apiKeyHash: 'SECRET',
      pishockUsername: 'SECRET',
      shareCode: 'SECRET',
      budgetTimezone: 'Europe/Amsterdam',
      activityMaxIntensity: 80,
    });
    Object.assign(leaky.shares[0]!, { shareCode: 'SECRET', shockerName: 'SECRET' });
    const json = JSON.stringify(toAdminProfile(leaky));
    assert.doesNotMatch(json, /SECRET|Europe\/Amsterdam/);
    for (const key of ['encryptedToken', 'apiKeyHash', 'pishockUsername', 'shareCode', 'shockerName', 'activityMaxIntensity']) {
      assert.ok(!json.includes(`"${key}"`), `${key} leaked into the admin profile`);
    }
  });

  it('marks only unlifted, unexpired bans as active', () => {
    const base = {
      reason: 'Repeatedly ignored limits',
      createdAt: new Date(NOW - 10_000),
      bannedByDiscordUserId: '999999',
      liftedByDiscordUserId: null,
      liftReason: null,
    };
    const p = toAdminProfile(
      input({
        bans: [
          { ...base, id: 'a', expiresAt: null, liftedAt: null },
          { ...base, id: 'b', expiresAt: new Date(NOW - 1), liftedAt: null },
          { ...base, id: 'c', expiresAt: null, liftedAt: new Date(NOW - 5) },
        ],
      }),
    );
    assert.deepEqual(
      p.bans.map((b) => [b.id, b.active]),
      [
        ['a', true],
        ['b', false],
        ['c', false],
      ],
    );
  });
});

describe('global bans', () => {
  it('isBanActive', () => {
    assert.equal(isBanActive({ liftedAt: null, expiresAt: null }, NOW), true);
    assert.equal(isBanActive({ liftedAt: null, expiresAt: new Date(NOW + 1) }, NOW), true);
    assert.equal(isBanActive({ liftedAt: null, expiresAt: new Date(NOW) }, NOW), false);
    assert.equal(isBanActive({ liftedAt: new Date(NOW - 1), expiresAt: null }, NOW), false);
  });

  it('requires a real reason the user can read', () => {
    assert.equal(normalizeBanReason(''), null);
    assert.equal(normalizeBanReason('too short'), null);
    assert.equal(normalizeBanReason(123), null);
    assert.equal(normalizeBanReason('x'.repeat(BAN_REASON_MAX + 1)), null);
    assert.equal(normalizeBanReason('  Harassing other members  '), 'Harassing other members');
  });

  it('accepts only the offered ban lengths', () => {
    assert.equal(normalizeBanDuration(undefined), null);
    assert.equal(normalizeBanDuration('permanent'), null);
    assert.equal(normalizeBanDuration(7), 7);
    assert.equal(normalizeBanDuration('30'), 30);
    assert.equal(normalizeBanDuration(3), undefined);
    assert.equal(normalizeBanDuration(-1), undefined);
  });

  it('a banned user can only reach their ban notice and their data rights', () => {
    const allowed: Array<[string, string]> = [
      ['GET', '/api/me'],
      ['GET', '/api/me/data'],
      ['PUT', '/api/me/data/retention'],
      ['POST', '/api/me/export'],
      ['POST', '/api/me/deletion'],
      ['DELETE', '/api/me/deletion'],
    ];
    for (const [m, p] of allowed) assert.equal(isAllowedWhileBanned(m, p), true, `${m} ${p}`);
    const refused: Array<[string, string]> = [
      ['POST', '/api/operate'],
      ['POST', '/api/participants/123/operate'],
      ['POST', '/api/participants/status'],
      ['POST', '/api/roulette'],
      ['PUT', '/api/emergency-stop'],
      ['GET', '/api/me/history'],
      ['POST', '/api/consent'],
      ['GET', '/api/admin/overview'],
      ['GET', '/api/me-anything'],
    ];
    for (const [m, p] of refused) assert.equal(isAllowedWhileBanned(m, p), false, `${m} ${p}`);
  });
});

describe('app notice', () => {
  it('validates text, level and expiry', () => {
    assert.equal(normalizeNotice(null), null);
    assert.equal(normalizeNotice({ text: '   ' }), null);
    assert.equal(normalizeNotice({ text: 'x'.repeat(501) }), null);
    const n = normalizeNotice({ text: 'Maintenance at 22:00', level: 'warning', expiresInHours: 2 })!;
    assert.equal(n.level, 'warning');
    assert.ok(n.expiresAt && Date.parse(n.expiresAt) > Date.now());
    assert.equal(normalizeNotice({ text: 'Hi', level: 'other' })!.level, 'info');
    assert.equal(normalizeNotice({ text: 'Hi', expiresInHours: 0 })!.expiresAt, null);
  });
});
