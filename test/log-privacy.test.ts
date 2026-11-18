/**
 * Log sharing preferences: what third parties may see in the shared log feed.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_LOG_PRIVACY,
  applyLogPrivacy,
  logActionKind,
  logPrivacyFromColumns,
  logPrivacyPatchToColumns,
  type LogPrivacy,
  type LogViewer,
  type PublicLogRow,
} from '../src/server/log-privacy.js';

function person(id: string, name: string) {
  return {
    id,
    username: name.toLowerCase(),
    globalName: name,
    displayName: name,
    avatar: null,
    avatarUrl: `https://cdn.discordapp.com/embed/avatars/0.png`,
  };
}

const ROW: PublicLogRow = {
  id: 'row-1',
  action: 'participant_shock',
  shockerId: 7,
  shockerName: 'Leg',
  hubClientId: '42',
  hubName: 'Hub',
  warningLevel: null,
  intensity: 40,
  durationMs: 1000,
  success: true,
  createdAt: new Date(0),
  source: 'discord',
  location: { kind: 'gc', name: 'The Basement', iconUrl: null, guildId: 'g1', channelId: 'c1' },
  executor: person('sender', 'Sender'),
  target: person('wearer', 'Wearer'),
};
const SCOPE = { guildId: 'g1', channelId: 'c1' };

const stranger = (guildId: string | null, channelId: string | null): LogViewer => ({
  id: 'stranger',
  guildId,
  channelId,
});

function prefs(patch: Partial<LogPrivacy>): LogPrivacy {
  return { ...DEFAULT_LOG_PRIVACY, ...patch };
}

describe('applyLogPrivacy', () => {
  it('defaults keep today\'s behaviour: visible everywhere with full details', () => {
    const out = applyLogPrivacy(ROW, SCOPE, DEFAULT_LOG_PRIVACY, null, stranger(null, null));
    assert.ok(out);
    assert.equal(out.executor.displayName, 'Sender');
    assert.equal(out.shockerName, 'Leg');
    assert.equal(out.intensity, 40);
    assert.equal(out.shareable, true);
  });

  it('wearer and sender always see the full row, even when private', () => {
    const p = prefs({ visibility: 'private', showSender: false, showDevice: false });
    const forWearer = applyLogPrivacy(ROW, SCOPE, p, null, { id: 'wearer', guildId: null, channelId: null });
    const forSender = applyLogPrivacy(ROW, SCOPE, p, null, { id: 'sender', guildId: null, channelId: null });
    assert.equal(forWearer?.executor.displayName, 'Sender');
    assert.equal(forSender?.shockerName, 'Leg');
  });

  it('private hides the row from everyone else', () => {
    assert.equal(applyLogPrivacy(ROW, SCOPE, prefs({ visibility: 'private' }), null, stranger('g1', 'c1')), null);
  });

  it('same-channel scope needs a matching verified channel', () => {
    const p = prefs({ visibility: 'channel' });
    assert.ok(applyLogPrivacy(ROW, SCOPE, p, null, stranger('g1', 'c1')));
    assert.equal(applyLogPrivacy(ROW, SCOPE, p, null, stranger('g1', 'c2')), null);
    assert.equal(applyLogPrivacy(ROW, SCOPE, p, null, stranger(null, null)), null);
  });

  it('same-server scope matches the guild; rows without a location stay hidden', () => {
    const p = prefs({ visibility: 'server' });
    assert.ok(applyLogPrivacy(ROW, SCOPE, p, null, stranger('g1', 'other')));
    assert.equal(applyLogPrivacy(ROW, SCOPE, p, null, stranger('g2', 'c1')), null);
    assert.equal(
      applyLogPrivacy(ROW, { guildId: null, channelId: null }, p, null, stranger('g1', 'c1')),
      null,
    );
  });

  it('redacts sender, device, intensity and location independently', () => {
    const out = applyLogPrivacy(
      ROW,
      SCOPE,
      prefs({ showSender: false, showDevice: false, showIntensity: false, showLocation: false }),
      null,
      stranger(null, null),
    );
    assert.ok(out);
    assert.equal(out.executor.displayName, 'Someone');
    assert.notEqual(out.executor.id, 'sender');
    assert.equal(out.shockerName, null);
    assert.equal(out.hubName, null);
    assert.equal(out.intensity, null);
    assert.equal(out.durationMs, null);
    assert.equal(out.location, null);
    assert.equal(out.target.displayName, 'Wearer');
  });

  it('a sender can hide themselves from third parties', () => {
    const out = applyLogPrivacy(ROW, SCOPE, DEFAULT_LOG_PRIVACY, prefs({ hideMeAsSender: true }), stranger(null, null));
    assert.equal(out?.executor.displayName, 'Someone');
  });

  it('filters actions the wearer excluded', () => {
    const p = prefs({ includeShock: false });
    assert.equal(applyLogPrivacy(ROW, SCOPE, p, null, stranger(null, null)), null);
    assert.ok(applyLogPrivacy({ ...ROW, action: 'vibrate' }, SCOPE, p, null, stranger(null, null)));
  });

  it('share cards: only the wearer may share when others are not allowed', () => {
    const p = prefs({ allowShareCards: false });
    assert.equal(applyLogPrivacy(ROW, SCOPE, p, null, stranger(null, null))?.shareable, false);
    assert.equal(
      applyLogPrivacy(ROW, SCOPE, p, null, { id: 'sender', guildId: null, channelId: null })?.shareable,
      false,
    );
    assert.equal(
      applyLogPrivacy(ROW, SCOPE, p, null, { id: 'wearer', guildId: null, channelId: null })?.shareable,
      true,
    );
  });
});

describe('log privacy parsing', () => {
  it('ignores unknown fields and bad values in patches', () => {
    assert.deepEqual(
      logPrivacyPatchToColumns({ visibility: 'nowhere', showSender: 'no', showDevice: false, admin: true }),
      { logShowDevice: false },
    );
    assert.deepEqual(logPrivacyPatchToColumns({ visibility: 'channel' }), { logVisibility: 'channel' });
  });

  it('falls back to defaults for missing rows', () => {
    assert.deepEqual(logPrivacyFromColumns(null), DEFAULT_LOG_PRIVACY);
    assert.equal(logPrivacyFromColumns({ logVisibility: 'weird' }).visibility, 'everywhere');
  });

  it('classifies prefixed actions', () => {
    assert.equal(logActionKind('participant_shock'), 'shock');
    assert.equal(logActionKind('participant_vibrate'), 'vibrate');
    assert.equal(logActionKind('beep'), 'beep');
    assert.equal(logActionKind('hold'), 'shock');
  });
});
