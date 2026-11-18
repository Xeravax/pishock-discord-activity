import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

/**
 * Runs against a real, migrated Postgres (DB_TESTS=1, DATABASE_URL). Skipped otherwise.
 * Locks in that concurrent STOP requests cannot overwrite each other's latch.
 */
const enabled = process.env.DB_TESTS === '1';

describe('setEmergencyStops against Postgres', { skip: !enabled && 'set DB_TESTS=1' }, () => {
  const owner = `estop-db-${process.pid}`;
  let db: typeof import('../src/server/db.js');
  let estop: typeof import('../src/server/services/emergency-stop.js');

  before(async () => {
    db = await import('../src/server/db.js');
    estop = await import('../src/server/services/emergency-stop.js');
    await db.prisma.discordUser.create({ data: { id: owner, username: 'estop-test' } });
  });

  after(async () => {
    await db.prisma.discordUser.deleteMany({ where: { id: owner } });
    await db.prisma.$disconnect();
  });

  it('concurrent engages on different shockers all stay latched', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => i + 1);
    await Promise.all(ids.map((id) => estop.setEmergencyStops(owner, [id], true)));
    const stored = await estop.getEmergencyStopShockerIds(owner);
    assert.deepEqual([...stored].sort((a, b) => a - b), ids);
  });

  it('releases remove only the requested ids, keep order, and stay idempotent', async () => {
    const res = await estop.setEmergencyStops(owner, [3, 5, 5, 99], false);
    assert.ok(!res.emergencyStopShockerIds.includes(3));
    assert.ok(!res.emergencyStopShockerIds.includes(5));
    assert.equal(res.emergencyStopShockerIds.length, 18);
    assert.deepEqual(res.engagedIds, []);
    const again = await estop.setEmergencyStops(owner, [3], false);
    assert.equal(again.emergencyStopShockerIds.length, 18);
  });

  it('engaging an already-latched id does not duplicate it', async () => {
    const res = await estop.setEmergencyStops(owner, [1, 1, 3], true);
    assert.deepEqual(res.engagedIds, [1, 3]);
    assert.equal(res.emergencyStopShockerIds.filter((id) => id === 1).length, 1);
  });

  it('concurrent engage + release of different shockers do not clobber each other', async () => {
    await Promise.all([
      estop.setEmergencyStops(owner, [100], true),
      estop.setEmergencyStops(owner, [2], false),
      estop.setEmergencyStops(owner, [101], true),
    ]);
    const stored = await estop.getEmergencyStopShockerIds(owner);
    assert.ok(stored.includes(100) && stored.includes(101));
    assert.ok(!stored.includes(2));
  });

  it('a successful write updates the synchronous latch', async () => {
    await estop.setEmergencyStops(owner, [200], true);
    assert.equal(estop.isEmergencyStopLatched(owner, 200), true);
    await estop.setEmergencyStops(owner, [200], false);
    assert.equal(estop.isEmergencyStopLatched(owner, 200), false);
  });

  it('throws for an unknown user instead of silently doing nothing', async () => {
    await assert.rejects(estop.setEmergencyStops('no-such-user', [1], true));
  });
});
