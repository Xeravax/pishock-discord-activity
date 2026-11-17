import { describe, expect, it } from 'vitest';
import type { DiscordParticipant, ParticipantShockerStatus, ParticipantStatus } from '../participants';
import { buildFriendShockers } from './friendShockers';

const shocker = (over: Partial<ParticipantShockerStatus> = {}): ParticipantShockerStatus => ({
  shockerId: 1,
  shockerName: 'Collar',
  hubClientId: '11',
  hubName: 'Hub',
  deviceMaxIntensity: 100,
  deviceMaxDurationMs: 15_000,
  minIntensity: 5,
  maxIntensity: 30,
  minDurationMs: 300,
  maxDurationMs: 2_000,
  canShock: true,
  canVibrate: true,
  canBeep: true,
  canHold: true,
  paused: false,
  ...over,
});

const status = (over: Partial<ParticipantStatus> = {}): ParticipantStatus => ({
  discordUserId: 'u1',
  username: 'bob',
  globalName: 'Bob',
  avatar: null,
  linked: true,
  consent: true,
  available: true,
  paused: false,
  bannedYou: false,
  shockers: [shocker()],
  ...over,
});

const people: DiscordParticipant[] = [
  { id: 'u1', displayName: 'Bobby', avatarUrl: '', username: 'bob' },
];

const build = (map: Record<string, ParticipantStatus>, live = new Set<number>(), ids = ['u1']) =>
  buildFriendShockers(ids, map, people, live);

describe('buildFriendShockers — access gating', () => {
  it('returns nothing without a selection, status, or shockers', () => {
    expect(build({})).toEqual([]);
    expect(build({ u1: status() }, new Set(), [])).toEqual([]);
    expect(build({ u1: status({ shockers: [] }) })).toEqual([]);
  });

  it('hides all shockers of someone who blocked you', () => {
    expect(build({ u1: status({ bannedYou: true }) })).toEqual([]);
  });

  it('an engaged e-stop disables every mode', () => {
    const [s] = build({ u1: status({ shockers: [shocker({ emergencyStop: true })] }) });
    expect(s).toMatchObject({
      emergencyStop: true,
      canShock: false,
      canVibrate: false,
      canBeep: false,
      canHold: false,
    });
  });

  it('a paused device (reported or live) disables every mode', () => {
    const reported = build({ u1: status({ shockers: [shocker({ paused: true })] }) })[0]!;
    expect([reported.paused, reported.canShock, reported.canBeep]).toEqual([true, false, false]);
    const live = build({ u1: status() }, new Set([1]))[0]!;
    expect([live.paused, live.canShock, live.canVibrate]).toEqual([true, false, false]);
  });

  it('a target without consent or a linked session keeps rows visible but disables every mode', () => {
    for (const st of [status({ consent: false }), status({ linked: false })]) {
      const [s] = build({ u1: st });
      expect(s).toBeDefined();
      expect([s!.canShock, s!.canVibrate, s!.canBeep, s!.canHold]).toEqual([false, false, false, false]);
    }
    const stopped = build({
      u1: status({ consent: false, shockers: [shocker({ emergencyStop: true, paused: true })] }),
    })[0]!;
    expect([stopped.emergencyStop, stopped.paused]).toEqual([true, true]);
  });

  it('available:false alone does not disable controls (consent + session decide)', () => {
    const [s] = build({ u1: status({ available: false }) });
    expect(s!.canShock).toBe(true);
  });

  it('respects the share capability flags when not stopped', () => {
    const [s] = build({ u1: status({ shockers: [shocker({ canShock: false, canHold: false })] }) });
    expect([s!.canShock, s!.canVibrate, s!.canBeep, s!.canHold]).toEqual([false, true, true, false]);
  });

  it('friend shockers are never owned and cannot be paused from here', () => {
    const [s] = build({ u1: status() });
    expect(s).toMatchObject({ owned: false, canPause: false, targetDiscordUserId: 'u1' });
  });
});

describe('buildFriendShockers — ceilings', () => {
  it('clamps to the device maximum even if the share band claims more', () => {
    const [s] = build({
      u1: status({
        shockers: [
          shocker({
            deviceMaxIntensity: 20,
            deviceMaxDurationMs: 1_000,
            maxIntensity: 90,
            maxDurationMs: 9_000,
            vibMaxIntensity: 95,
            beepMaxDurationMs: 8_000,
          }),
        ],
      }),
    });
    expect(s!.maxIntensity).toBe(20);
    expect(s!.maxDuration).toBe(1_000);
    expect(s!.vibMaxIntensity).toBe(20);
    expect(s!.beepMaxDuration).toBe(1_000);
  });

  it('caps absurd device values at 100% / 15s', () => {
    const [s] = build({
      u1: status({
        shockers: [shocker({ deviceMaxIntensity: 500, deviceMaxDurationMs: 99_000, maxIntensity: 500, maxDurationMs: 99_000 })],
      }),
    });
    expect(s!.deviceMaxIntensity).toBe(100);
    expect(s!.deviceMaxDuration).toBe(15_000);
    expect(s!.maxIntensity).toBe(100);
  });

  it('never produces min above max', () => {
    const [s] = build({
      u1: status({ shockers: [shocker({ minIntensity: 80, maxIntensity: 10, minDurationMs: 5_000, maxDurationMs: 500 })] }),
    });
    expect(s!.minIntensity).toBeLessThanOrEqual(s!.maxIntensity);
    expect(s!.minDuration).toBeLessThanOrEqual(s!.maxDuration);
  });

  it('unknown required warning levels collapse to none', () => {
    const odd = shocker({ requiredWarningLevel: 'bogus' as never });
    expect(build({ u1: status({ shockers: [odd] }) })[0]!.requiredWarningLevel).toBe('none');
    const mid = shocker({ requiredWarningLevel: 'mid' });
    expect(build({ u1: status({ shockers: [mid] }) })[0]!.requiredWarningLevel).toBe('mid');
  });
});

describe('buildFriendShockers — labels', () => {
  it('falls back hub name → display name → global name → username → "Friend"', () => {
    const name = (st: Partial<ParticipantStatus>, hub: string | null, list = people) =>
      buildFriendShockers(['u1'], { u1: status({ ...st, shockers: [shocker({ hubName: hub })] }) }, list, new Set())[0]!.hubName;
    expect(name({}, 'Their Hub')).toBe('Their Hub');
    expect(name({}, ' ')).toBe('Bobby');
    expect(name({}, null, [])).toBe('Bob');
    expect(name({ globalName: null }, null, [])).toBe('bob');
    expect(name({ globalName: null, username: null }, null, [])).toBe('Friend');
  });
});
