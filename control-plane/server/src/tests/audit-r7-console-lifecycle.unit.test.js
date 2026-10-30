// specs/hosting-h1-fleet-runtime.md rule 38 — an archived customer is never served again by a step
// retry, a rename, a restore or a second deprovision (audit R7 F2, F3, F3b; review of PR #892 R1, H2,
// R2).

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
    let hold = true;
    const window = h.host.drivers.backup.window;
    h.host.drivers.backup.window = async (i) => { if (hold) { hold = false; await gate; } return window(i); };
    const restore = h.ctx.controllers.fleet.restore(c.id, { at: '2026-10-11T02:00:00Z' }, 'op');
    await tick();
    const deprov = h.ctx.controllers.billing.deprovision(c.id, { confirmSlug: c.slug }, 'op');
    const d = await Promise.allSettled([deprov]).then(([x]) => x);
    release();
    const [r] = await Promise.allSettled([restore]);
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

const ALL_CHECKED = ['wordpress', 'ical', 'oauth', 'push'];

test('rule 38 — a rename sent while a deprovision is running is refused, the closed space keeps its address', async () => {
  const h = makeContext({ versions: ['3.9.0'] });
  try {
    const { customers, billing } = h.ctx.controllers;
    const c = await customers.create(NEW_CUSTOMER, 'op');
    let release;
    const gate = new Promise((r) => { release = r; });
    const disableNow = h.host.drivers.process.disableNow;
    h.host.drivers.process.disableNow = async (i) => { await gate; return disableNow(i); };
    const deprov = billing.deprovision(c.id, { confirmSlug: c.slug }, 'op');
    await tick();
    const rename = customers.rename(c.id, { slug: 'nouveau-nom', checked: ALL_CHECKED }, 'op');
    rename.catch(() => {});
    await tick();
    release();
    const [d, r] = await Promise.allSettled([deprov, rename]);
    assert.equal(d.status, 'fulfilled');
    assert.equal(r.status, 'rejected');
    assert.equal(r.reason.status, 409);
    assert.equal(r.reason.body.error, 'DEPROVISIONING');
    const now = h.ctx.models.customers.get(c.id);
    assert.ok(now.archivedAt);
    assert.equal(now.slug, c.slug);
    assertClosed(h, c);
    assert.ok(!h.host.drivers.proxy.route('nouveau-nom'));
    assert.equal(h.host.procs.has('nouveau-nom'), false);
  } finally { h.cleanup(); }
});

test('rule 38 — the provisioner itself never moves an archived customer to a new address', async () => {
  const { h, c } = await archivedWithFailedRestart();
  try {
    const replicas = h.host.named('backup.addReplica').length;
    h.ctx.models.customers.setSlug(c.id, 'nouveau-nom');
    assert.equal(await h.ctx.provisioner.rename(c.id, c.slug), false);
    assertClosed(h, c);
    assert.equal(h.host.procs.has('nouveau-nom'), false);
    assert.ok(!h.host.drivers.proxy.route('nouveau-nom'));
    assert.equal(h.host.named('backup.addReplica').length, replicas);
  } finally { h.cleanup(); }
});

test('rule 38 — a restore sent while a deprovision is running is refused, the export stays the database on disk', async () => {
  const h = makeContext({ at: '2026-10-11T03:00:00Z' });
  try {
    const c = await h.ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
    let release;
    const gate = new Promise((r) => { release = r; });
    const send = h.mailer.send.bind(h.mailer);
    let hold = true;
    h.mailer.send = async (m) => { if (hold && /fermé/.test(JSON.stringify(m))) { hold = false; await gate; } return send(m); };
    const deprov = h.ctx.controllers.billing.deprovision(c.id, { confirmSlug: c.slug }, 'op');
    await tick();
    const restore = h.ctx.controllers.fleet.restore(c.id, { at: '2026-10-11T02:00:00Z' }, 'op');
    restore.catch(() => {});
    await tick(100);
    release();
    const [d, r] = await Promise.allSettled([deprov, restore]);
    assert.equal(d.status, 'fulfilled');
    assert.equal(r.status, 'rejected');
    assert.equal(r.reason.status, 409);
    assert.equal(r.reason.body.error, 'DEPROVISIONING');
    assert.equal(h.host.named('backup.restore').length, 0);
    assert.ok(h.ctx.models.customers.get(c.id).archivedAt);
    assertClosed(h, c);
  } finally { h.cleanup(); }
});

for (const renameFails of [true, false]) {
  test(`rule 38 — a deprovision sent while a rename waits for the lock is refused (rename ${renameFails ? 'fails' : 'succeeds'})`, async () => {
    const h = makeContext({ versions: ['3.9.0'] });
    try {
      const { customers, billing } = h.ctx.controllers;
      const c = await customers.create(NEW_CUSTOMER, 'op');
      let release;
      const gate = new Promise((r) => { release = r; });
      h.ctx.provisioner.exclusive(c.id, () => gate);
      if (renameFails) h.host.failNext['proxy.writeSite'] = new Error('caddy reload failed');
      const rename = customers.rename(c.id, { slug: 'nouveau-nom', checked: ALL_CHECKED }, 'op');
      rename.catch(() => {});
      await tick();
      const deprov = billing.deprovision(c.id, { confirmSlug: 'nouveau-nom' }, 'op');
      deprov.catch(() => {});
      await tick();
      release();
      const [, d] = await Promise.allSettled([rename, deprov]);
      assert.equal(d.status, 'rejected');
      assert.equal(d.reason.status, 409);
      assert.equal(d.reason.body.error, 'RENAME_PENDING');
      assert.equal(h.ctx.models.customers.get(c.id).archivedAt, null);
      assert.equal(h.ctx.models.provisioning.exportsOf(c.id).length, 0);
      const old = h.host.drivers.proxy.route(c.slug);
      if (!renameFails) assert.equal(old.kind, 'redirect');
    } finally { h.cleanup(); }
  });
}

test('rule 38 — the erase removes the route of every old address still reserved, even one a failed rename left serving', async () => {
  const h = makeContext({ versions: ['3.9.0'] });
  try {
    const { customers, billing } = h.ctx.controllers;
    const c = await customers.create(NEW_CUSTOMER, 'op');
    const port = h.ctx.models.hosting.get(c.id).port;
    h.host.failNext['proxy.writeSite'] = new Error('caddy reload failed');
    await customers.rename(c.id, { slug: 'nouveau-nom', checked: ALL_CHECKED }, 'op').catch(() => {});
    assert.equal(h.ctx.models.provisioning.get(c.id, 'rename').status, 'failed');
    assert.equal(h.host.drivers.proxy.route(c.slug).kind, 'site');
    // Stands in for a state the guards no longer let through: closed and erased with that route left.
    h.ctx.models.provisioning.set(c.id, 'rename', 'ok', 'Dossier renommé.', h.now().toISOString());
    await billing.deprovision(c.id, { confirmSlug: 'nouveau-nom' }, 'op');
    await customers.eraseNow(c.id, { confirmSlug: 'nouveau-nom' }, 'op');
    assert.ok(!h.host.drivers.proxy.route(c.slug));
    assert.ok(!h.host.drivers.proxy.route('nouveau-nom'));
    const other = await customers.create({ ...NEW_CUSTOMER, companyName: 'Autre', contactEmail: 'contact@autre.test', slug: 'autre' }, 'op');
    assert.equal(h.ctx.models.hosting.get(other.id).port, port);
    assert.ok(!h.host.drivers.proxy.route(c.slug));
  } finally { h.cleanup(); }
});
