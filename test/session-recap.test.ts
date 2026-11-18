import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildRecap, recapEmbed, type RecapRow } from '../src/server/session-recap.js';

const row = (over: Partial<RecapRow>): RecapRow => ({
  action: 'participant_shock',
  intensity: 20,
  durationMs: 1000,
  success: true,
  executorDiscordUserId: 'a',
  executorLabel: null,
  adminBypass: false,
  ...over,
});

describe('session recap', () => {
  const start = new Date('2026-11-18T20:00:00Z');
  const end = new Date('2026-11-18T21:30:00Z');

  it('counts actions, shock time, max intensity and top senders', () => {
    const recap = buildRecap(
      [
        row({ intensity: 30, durationMs: 1500 }),
        row({ action: 'participant_hold', intensity: 55, durationMs: 2000, executorDiscordUserId: 'b' }),
        row({ action: 'participant_vibrate', executorDiscordUserId: 'b' }),
        row({ action: 'participant_beep', executorDiscordUserId: 'b' }),
        row({ success: false }),
        row({ action: 'roulette_safe' }),
        row({ adminBypass: true, executorDiscordUserId: 'admin' }),
        row({ action: 'participant_end' }),
      ],
      start,
      end,
    );
    assert.equal(recap.commands, 5);
    assert.equal(recap.shocks, 3);
    assert.equal(recap.vibrates, 1);
    assert.equal(recap.beeps, 1);
    assert.equal(recap.totalShockMs, 4500);
    assert.equal(recap.maxShockIntensity, 55);
    assert.equal(recap.refused, 1);
    assert.equal(recap.rouletteSafe, 1);
    assert.equal(recap.adminBypasses, 1);
    assert.deepEqual(recap.topSenders[0], { id: 'b', count: 3 });
    assert.equal(recap.durationMs, 90 * 60_000);
  });

  it('website senders are grouped by label', () => {
    const recap = buildRecap(
      [row({ executorDiscordUserId: null, executorLabel: 'PiShock web' })],
      start,
      end,
    );
    assert.deepEqual(recap.topSenders, [{ id: 'label:PiShock web', count: 1 }]);
  });

  it('the DM embed names senders and flags admin bypasses in red', () => {
    const recap = buildRecap([row({ adminBypass: true })], start, end);
    const embed = recapEmbed(recap, new Map([['a', 'Alex']]));
    assert.match(embed.description, /Alex ×1/);
    assert.match(embed.description, /admin bypass/);
    assert.equal(embed.color, 0xe53935);
  });
});
