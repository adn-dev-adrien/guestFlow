// specs/hosting-h1-fleet-runtime.md rule 37 — a customer deprovisioned or erased after a fleet update
// started is skipped by it, and the deprovision export / the erasure run inside the customer's
// sequence lock, never alongside a snapshot or a rollback (audit R6 F1).

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeContext, makeRelease, NEW_CUSTOMER } = require('./helpers');

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

// The update is held on its first instance (`ombre`); `moulin` and `aulnes` are still queued.
async function heldFleet() {
  const h = makeContext({ versions: ['3.9.0'] });
  const { customers, fleet } = h.ctx.controllers;
  const a = await customers.create(NEW_CUSTOMER, 'op');
  const b = await customers.create({ ...NEW_CUSTOMER, slug: 'moulin', companyName: 'Le Moulin', contactEmail: 'jo@moulin.fr' }, 'op');
  const c = await customers.create({ ...NEW_CUSTOMER, slug: 'ombre', companyName: 'Domaine Ombre', contactEmail: 'li@ombre.fr' }, 'op');
  makeRelease(h.releasesDir, '3.10.0');
  let release;
  const gate = new Promise((r) => { release = r; });
  const start = h.host.drivers.process.start;
  h.host.drivers.process.start = async (inst) => { if (inst.slug === 'ombre') await gate; await start(inst); };
  fleet.startUpdate({ targetVersion: '3.10.0' }, 'op');
  await tick();
  return { ...h, a, b, c, release };
}

const itemOf = (h, c) => h.ctx.controllers.fleet.view().history[0].items.find((i) => i.customerId === c.id);

test('rule 37 — a customer deprovisioned while the update is queued is skipped, not restarted', async () => {
  const h = await heldFleet();
  try {
    await h.ctx.controllers.customers.deprovision(h.b.id, { confirmSlug: 'moulin' }, 'op');
    assert.equal(h.host.procs.get('moulin').running, false);
    h.release();
    await h.ctx.fleetUpdater.whenIdle();
    const [u] = h.ctx.controllers.fleet.view().history;
    assert.equal(u.state, 'done', 'the fleet carries on');
    const moulin = u.items.find((i) => i.customerId === h.b.id);
    assert.deepEqual([moulin.state, moulin.detail], ['skipped', 'Client archivé entre-temps.']);
    assert.equal(h.host.procs.get('moulin').running, false, 'still stopped');
    assert.equal(h.ctx.models.hosting.get(h.b.id).unit_state, 'stopped');
    assert.deepEqual(u.items.filter((i) => i.customerId !== h.b.id).map((i) => i.state), ['done', 'done']);
  } finally { h.cleanup(); }
});

test('rule 37 — a customer erased while the update is queued is skipped and the update does not abort', async () => {
  const h = await heldFleet();
  try {
    const { customers } = h.ctx.controllers;
    await customers.deprovision(h.b.id, { confirmSlug: 'moulin' }, 'op');
    await customers.eraseNow(h.b.id, { confirmSlug: 'moulin' }, 'op');
    h.release();
    await h.ctx.fleetUpdater.whenIdle();
    const [u] = h.ctx.controllers.fleet.view().history;
    assert.equal(u.state, 'done');
    assert.equal(u.items.find((i) => i.customerId === h.b.id).state, 'skipped');
    assert.deepEqual(u.items.filter((i) => i.customerId !== h.b.id).map((i) => i.state), ['done', 'done']);
  } finally { h.cleanup(); }
});

test('rule 37 — the deprovision export waits for the customer\'s running update step', async () => {
  const h = await heldFleet();
  try {
    const { customers } = h.ctx.controllers;
    const pending = customers.deprovision(h.c.id, { confirmSlug: 'ombre' }, 'op');
    await tick();
    assert.equal(h.ctx.models.provisioning.get(h.c.id, 'deprov-export') || null, null, 'no export while the snapshot step holds the instance');
    assert.equal(Boolean(h.ctx.models.customers.get(h.c.id).archivedAt), false);
    h.release();
    await pending;
    await h.ctx.fleetUpdater.whenIdle();
    assert.equal(h.ctx.models.provisioning.get(h.c.id, 'deprov-export').status, 'ok');
    assert.equal(itemOf(h, h.c).state, 'done', 'the step finished before the export');
    assert.equal(h.host.procs.get('ombre').running, false, 'and the deprovision stop came last');
  } finally { h.cleanup(); }
});

test('rule 37 — the erasure waits for the customer\'s running update step', async () => {
  const h = await heldFleet();
  try {
    const { customers } = h.ctx.controllers;
    h.ctx.models.customers.archive(h.c.id, '2026-10-08T00:00:00Z', '2027-01-06');
    h.ctx.models.provisioning.set(h.c.id, 'deprov-stop', 'ok', '', '2026-10-08T00:00:00Z');
    const pending = customers.eraseNow(h.c.id, { confirmSlug: 'ombre' }, 'op');
    await tick();
    assert.equal(Boolean(h.ctx.models.customers.get(h.c.id).erasedAt), false, 'not erased under the update');
    h.release();
    await pending;
    await h.ctx.fleetUpdater.whenIdle();
    assert.equal(Boolean(h.ctx.models.customers.get(h.c.id).erasedAt), true);
  } finally { h.cleanup(); }
});
