// specs/hosting-h1-fleet-runtime.md rule 28 — a release that an update had to roll back, and that no
// instance runs, reads « En échec » on the Versions page and is never the default target: the
// default is the newest release that did not fail.

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeContext, makeRelease, NEW_CUSTOMER } = require('./helpers');

test('rule 28 — after a forced rollback the failed release is marked and the default target is the last good one', async () => {
  const h = makeContext({ versions: ['3.9.0'], hostingEnv: { CP_HEALTH_TIMEOUT_MS: '100' } });
  try {
    const { customers, fleet } = h.ctx.controllers;
    const a = await customers.create(NEW_CUSTOMER, 'op');
    await customers.create({ ...NEW_CUSTOMER, slug: 'moulin', companyName: 'Le Moulin', contactEmail: 'jo@moulin.fr' }, 'op');
    makeRelease(h.releasesDir, '3.10.0');
    makeRelease(h.releasesDir, '3.10.1');
    assert.equal(fleet.view().defaultTarget, '3.10.1', 'before any failure, the newest');
    h.host.unhealthy.add('3.10.1');
    fleet.startUpdate({ targetVersion: '3.10.1', customerIds: [a.id] }, 'op');
    await h.ctx.fleetUpdater.whenIdle();
    let v = fleet.view();
    assert.equal(v.history[0].items[0].state, 'rolled_back');
    assert.deepEqual(v.releases.map((r) => [r.version, r.failed, r.statusLabel]), [
      ['3.10.1', true, 'En échec'], ['3.10.0', false, '0 instance'], ['3.9.0', false, '2 instances'],
    ]);
    assert.equal(v.defaultTarget, '3.10.0');

    // Once the release runs somewhere it is no longer « En échec ».
    h.host.unhealthy.delete('3.10.1');
    fleet.startUpdate({ targetVersion: '3.10.1', customerIds: [a.id] }, 'op');
    await h.ctx.fleetUpdater.whenIdle();
    v = fleet.view();
    assert.equal(v.releases[0].failed, false);
    assert.equal(v.releases[0].statusLabel, '1 instance');
    assert.equal(v.defaultTarget, '3.10.1');
  } finally {
    h.cleanup();
  }
});
