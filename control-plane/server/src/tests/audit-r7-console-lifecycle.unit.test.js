// specs/hosting-h1-fleet-runtime.md rule 38 — an archived customer is never served again by a step
// retry, a restore or a second deprovision (audit R7 F2, F3, F3b).

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeContext, makeRelease, NEW_CUSTOMER } = require('./helpers');

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

// Deprovisioned, reactivated with a restart that failed, then deprovisioned again: the failed
// « restart » row is still there on an archived customer.
async function archivedWithFailedRestart() {
  const h = makeContext({ versions: ['3.9.0'] });
  const { customers, billing } = h.ctx.controllers;
  const c = await customers.create(NEW_CUSTOMER, 'op');
  await billing.deprovision(c.id, { confirmSlug: c.slug }, 'op');
  h.host.failNext['proxy.writeSite'] = new Error('caddy reload failed');
  const r = await customers.reactivate(c.id, 'op');
  assert.equal(r.steps.find((s) => s.step === 'restart').status, 'failed');
  const v = await billing.deprovision(c.id, { confirmSlug: c.slug }, 'op');
  assert.ok(v.archivedAt);
  return { h, c, v };
}

function assertClosed(h, c) {
  assert.equal(h.host.procs.get(c.slug).running, false, 'the process stays stopped');
  assert.notEqual((h.host.drivers.proxy.route(c.slug) || {}).kind, 'site', 'the route stays closed');
  assert.equal(h.ctx.models.hosting.get(c.id).unit_state, 'stopped');
}

test('rule 38 — an archived customer offers no « Réessayer » on its restart row', async () => {
  const { h, v } = await archivedWithFailedRestart();
  try {
    const row = v.steps.find((s) => s.step === 'restart');
    assert.equal(row.status, 'failed');
    assert.equal(row.action, null);
  } finally { h.cleanup(); }
});

test('rule 38 — « Réessayer » on the restart of an archived customer is refused and serves nothing', async () => {
  const { h, c } = await archivedWithFailedRestart();
  try {
    await assert.rejects(h.ctx.controllers.customers.stepAction(c.id, 'restart', 'retry', 'op'), (err) => err.status === 409 && err.body.error === 'ARCHIVED');
    assertClosed(h, c);
  } finally { h.cleanup(); }
});

test('rule 38 — a stale failed process-restart and rename are refused on an archived customer', async () => {
  const { h, c } = await archivedWithFailedRestart();
  try {
    const at = h.now().toISOString();
    h.ctx.models.provisioning.set(c.id, 'process-restart', 'failed', 'Contrôle de santé : délai dépassé.', at);
    h.ctx.models.provisioning.set(c.id, 'rename', 'failed', 'Le dossier existe déjà.', at);
    const view = h.ctx.controllers.customers.view(c.id);
    const shown = view.steps.filter((s) => s.step === 'process-restart' || s.step === 'rename');
    assert.ok(shown.length > 0);
    assert.deepEqual(shown.map((s) => s.action), shown.map(() => null));
    for (const step of ['process-restart', 'rename']) {
      await assert.rejects(h.ctx.controllers.customers.stepAction(c.id, step, 'retry', 'op'), (err) => err.status === 409 && err.body.error === 'ARCHIVED');
    }
    assertClosed(h, c);
  } finally { h.cleanup(); }
});

test('rule 38 — the provisioner itself never restarts an archived customer', async () => {
  const { h, c } = await archivedWithFailedRestart();
  try {
    assert.equal(await h.ctx.provisioner.restart(c.id), false);
    assert.equal(await h.ctx.provisioner.restartProcess(c.id), false);
    assertClosed(h, c);
    assert.equal(h.ctx.models.provisioning.get(c.id, 'restart').status, 'failed', 'the row is left as it was');
  } finally { h.cleanup(); }
});

test('rule 38 — a reactivation still restarts the customer', async () => {
  const { h, c } = await archivedWithFailedRestart();
  try {
    const v = await h.ctx.controllers.customers.reactivate(c.id, 'op');
    assert.equal(v.archivedAt, null);
    assert.equal(v.steps.find((s) => s.step === 'restart').status, 'ok');
    assert.equal(h.host.procs.get(c.slug).running, true);
  } finally { h.cleanup(); }
});

test('rule 38 — a restore that reaches the lock after the deprovision stop is refused, the instance stays stopped', async () => {
  const h = makeContext({ at: '2026-10-11T03:00:00Z' });
  try {
    const c = await h.ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
    let release;
    const gate = new Promise((r) => { release = r; });
    const send = h.mailer.send.bind(h.mailer);
    let hold = true;
    const window = h.host.drivers.backup.window;
    h.host.drivers.backup.window = async (i) => { await tick(150); return window(i); };
    h.mailer.send = async (m) => { if (hold && /fermé/.test(JSON.stringify(m))) { hold = false; await gate; } return send(m); };
    const deprov = h.ctx.controllers.billing.deprovision(c.id, { confirmSlug: c.slug }, 'op');
    await tick();
    const restore = h.ctx.controllers.fleet.restore(c.id, { at: '2026-10-11T02:00:00Z' }, 'op');
    await tick();
    release();
    const [d, r] = await Promise.allSettled([deprov, restore]);
    assert.equal(d.status, 'fulfilled');
    assert.equal(r.status, 'rejected');
    assert.equal(r.reason.body.error, 'ARCHIVED');
    assert.ok(h.ctx.models.customers.get(c.id).archivedAt);
    assertClosed(h, c);
    assert.equal(h.host.named('backup.restore').length, 0, 'the database on disk is the exported one');
  } finally { h.cleanup(); }
});

test('rule 38 — two deprovisions while the customer lock is held export and mail once', async () => {
  const h = makeContext({ versions: ['3.9.0'] });
  try {
    const { customers, fleet, billing } = h.ctx.controllers;
    const b = await customers.create({ ...NEW_CUSTOMER, slug: 'moulin', companyName: 'Le Moulin', contactEmail: 'jo@moulin.fr' }, 'op');
    makeRelease(h.releasesDir, '3.10.0');
    let release;
    const gate = new Promise((r) => { release = r; });
    const start = h.host.drivers.process.start;
    h.host.drivers.process.start = async (inst) => { if (inst.slug === 'moulin') await gate; await start(inst); };
    fleet.startUpdate({ targetVersion: '3.10.0' }, 'op');
    await tick(50);
    const p1 = billing.deprovision(b.id, { confirmSlug: 'moulin' }, 'op');
    const p2 = billing.deprovision(b.id, { confirmSlug: 'moulin' }, 'op');
    release();
    const results = await Promise.allSettled([p1, p2]);
    await h.ctx.fleetUpdater.whenIdle();
    assert.deepEqual(results.map((x) => x.status), ['fulfilled', 'fulfilled']);
    assert.equal(h.ctx.models.provisioning.exportsOf(b.id).length, 1);
    assert.equal(h.mailer.sent.filter((m) => /fermé/.test(JSON.stringify(m))).length, 1);
    assert.ok(h.ctx.models.customers.get(b.id).archivedAt);
    assert.equal(h.host.procs.get('moulin').running, false);
  } finally { h.cleanup(); }
});
