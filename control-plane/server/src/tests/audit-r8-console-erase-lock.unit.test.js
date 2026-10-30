// specs/hosting-h1-fleet-runtime.md rule 39 — a reactivation or a cancellation never lands while an
// erasure is queued or running, and the erasure re-reads the customer inside the lock (audit R8 N1).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeContext, NEW_CUSTOMER } = require('./helpers');

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

async function archived() {
  const h = makeContext({ versions: ['3.9.0'] });
  const { customers, billing } = h.ctx.controllers;
  const c = await customers.create(NEW_CUSTOMER, 'op');
  await billing.deprovision(c.id, { confirmSlug: c.slug }, 'op');
  return { h, c, customers };
}

// « queued »: a fleet item holds the customer's lock, the erasure waits behind it.
// « running »: the erasure holds the lock and waits on the replica purge.
function hold(h, c, variant) {
  let release;
  const gate = new Promise((r) => { release = r; });
  if (variant === 'queued') h.ctx.provisioner.exclusive(c.id, () => gate);
  else {
    const purge = h.host.drivers.backup.purge;
    h.host.drivers.backup.purge = async (...args) => { await gate; return purge.apply(h.host.drivers.backup, args); };
  }
  return release;
}

// Settled without awaiting: on the unfixed code a reactivation waits on the lock the test holds.
const outcome = (p) => p.then(() => 'accepted', (err) => err);
const erasing = (err) => err.status === 409 && err.body.error === 'ERASING' && err.body.message === 'Effacement en cours.';

for (const variant of ['queued', 'running']) {
  test(`rule 39 — « Réactiver » is refused while an erasure is ${variant}, and nothing is unarchived`, async () => {
    const { h, c, customers } = await archived();
    try {
      const release = hold(h, c, variant);
      const starts = h.host.named('process.enableNow').length;
      const erase = customers.eraseNow(c.id, { confirmSlug: c.slug }, 'op');
      await tick();
      const reactivated = outcome(customers.reactivate(c.id, 'op'));
      await tick();
      const row = h.ctx.models.customers.get(c.id);
      const exportKept = h.ctx.models.provisioning.exportsOf(c.id).some((e) => fs.existsSync(e.path));
      release();
      assert.ok(erasing(await reactivated));
      assert.ok(row.archivedAt, 'still archived');
      assert.ok(exportKept, 'the export is kept');
      assert.equal((await erase).erased, true);
      assert.ok(h.ctx.models.customers.get(c.id).erasedAt);
      assert.equal(h.host.named('process.enableNow').length, starts, 'no restart was queued behind the erasure');
      assert.notEqual((h.host.drivers.proxy.route(c.slug) || {}).kind, 'site');
    } finally { h.cleanup(); }
  });

  test(`rule 39 — « Annuler l’effacement » is refused while an erasure is ${variant}`, async () => {
    const { h, c, customers } = await archived();
    try {
      const release = hold(h, c, variant);
      const erase = customers.eraseNow(c.id, { confirmSlug: c.slug }, 'op');
      await tick();
      let cancelled = 'accepted';
      try { customers.cancelErase(c.id, 'op'); } catch (err) { cancelled = err; }
      const eraseAt = h.ctx.models.customers.get(c.id).eraseAt;
      release();
      await erase;
      assert.ok(erasing(cancelled));
      assert.ok(eraseAt, 'the erasure stays scheduled');
      assert.ok(h.ctx.models.customers.get(c.id).erasedAt);
    } finally { h.cleanup(); }
  });
}

test('rule 39 — « Réactiver » is refused while the scheduled erasure runs on that customer', async () => {
  const { h, c, customers } = await archived();
  try {
    h.now.set('2026-12-28T10:00:00Z');
    const release = hold(h, c, 'queued');
    const due = customers.eraseDue('système', () => {});
    await tick();
    const reactivated = outcome(customers.reactivate(c.id, 'op'));
    let cancelled = 'accepted';
    try { customers.cancelErase(c.id, 'op'); } catch (err) { cancelled = err; }
    await tick();
    release();
    assert.equal((await due).length, 1);
    assert.ok(erasing(await reactivated));
    assert.ok(erasing(cancelled));
  } finally { h.cleanup(); }
});

test('rule 39 — once the erasure ends, a reactivation of the erased customer is a 404 and the next one is accepted again', async () => {
  const { h, c, customers } = await archived();
  try {
    await customers.eraseNow(c.id, { confirmSlug: c.slug }, 'op');
    await assert.rejects(customers.reactivate(c.id, 'op'), (err) => err.status === 404);
    const other = await archived();
    try {
      const r = await other.customers.reactivate(other.c.id, 'op');
      assert.equal(r.archivedAt, null);
    } finally { other.h.cleanup(); }
  } finally { h.cleanup(); }
});

test('rule 39 — inside the lock, an erasure leaves a customer no longer archived untouched', async () => {
  const { h, c, customers } = await archived();
  try {
    const release = hold(h, c, 'queued');
    const erase = customers.eraseNow(c.id, { confirmSlug: c.slug }, 'op');
    await tick();
    h.ctx.models.customers.unarchive(c.id);
    release();
    assert.equal((await erase).erased, false);
    const row = h.ctx.models.customers.get(c.id);
    assert.equal(row.erasedAt, null);
    assert.ok(fs.existsSync(path.join(h.root, c.slug)), 'the instance folder is kept');
    assert.equal(h.host.named('backup.purge').length, 0, 'the replica is kept');
  } finally { h.cleanup(); }
});

test('rule 39 — inside the lock, the scheduled erasure skips a customer whose erasure was cancelled meanwhile', async () => {
  const { h, c, customers } = await archived();
  try {
    h.now.set('2026-12-28T10:00:00Z');
    const release = hold(h, c, 'queued');
    const due = customers.eraseDue('système', () => {});
    await tick();
    h.ctx.models.customers.setEraseAt(c.id, null);
    release();
    assert.deepEqual(await due, []);
    assert.equal(h.ctx.models.customers.get(c.id).erasedAt, null);
    assert.ok(fs.existsSync(path.join(h.root, c.slug)));
  } finally { h.cleanup(); }
});

test('rule 39 — a second erasure queued behind the first finds the customer erased and does nothing', async () => {
  const { h, c, customers } = await archived();
  try {
    const release = hold(h, c, 'queued');
    const first = customers.eraseNow(c.id, { confirmSlug: c.slug }, 'op');
    const second = customers.eraseNow(c.id, { confirmSlug: c.slug }, 'op');
    await tick();
    release();
    assert.equal((await first).erased, true);
    assert.equal((await second).erased, false, 'the second one finds the customer erased and does nothing');
    assert.equal(h.host.named('backup.purge').length, 1);
  } finally { h.cleanup(); }
});
