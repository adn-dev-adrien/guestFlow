// Audit R24, console F1-F5: specs/control-plane-plans-and-access.md rule 51 (« Réessayer » on a failed export closes
// like the main button), specs/hosting-h1-fleet-runtime.md rules 52-55 (a rename recorded before the slug moves, no
// licence download for a held customer, no creation resumed on a closed customer, the probe measures the address that
// answers). Fake host drivers, fake Qonto, real files and SQLite.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { makeContext, makeFakeQonto, NEW_CUSTOMER } = require('./helpers');
const { createCustomersController } = require('../controllers/customersController');
const { addDays, parisDay } = require('../utils/days');

const TODAY = parisDay(new Date());
const AT = `${TODAY}T10:00:00Z`;
const CUSTOMER = { ...NEW_CUSTOMER, startsAt: TODAY };
const OTHER = { ...CUSTOMER, companyName: 'Autre', contactEmail: 'contact@autre.test' };
const HELD = 'Une base de données existe déjà à cette adresse.';

const checkedOf = (h) => h.ctx.controllers.customers.RENAME_CHECKLIST.map((i) => i.key);
const renameTo = (h, id, slug) => h.ctx.controllers.customers.rename(id, { slug, checked: checkedOf(h) }, 'op');
const ticks = async (n = 5) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setImmediate(r)); };

async function rejects(promiseOrFn, status, code) {
  await assert.rejects(async () => (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn), (err) => {
    assert.equal(err.status, status);
    assert.equal(err.body.error, code);
    return true;
  });
}

test('control-plane-plans-and-access rule 51 — « Réessayer » on a failed export cancels the open invoice, as the main button does', async () => {
  const qonto = makeFakeQonto();
  const h = makeContext({ at: AT, qonto });
  try {
    const { customers, billing } = h.ctx.controllers;
    const c = await customers.create({ ...CUSTOMER, billing: 'monthly', length: 1 }, 'op');
    h.now.set(`${addDays(customers.view(c.id).endsAt, -7)}T08:00:00Z`);
    await billing.runDaily(() => {});
    const open = customers.view(c.id).invoices[0];
    assert.equal(open.statusLabel, 'À payer');

    const db = h.ctx.instances.dbPath('aulnes');
    const good = fs.readFileSync(db);
    fs.writeFileSync(db, 'not a database');
    let v = await billing.deprovision(c.id, { confirmSlug: 'aulnes' }, 'op');
    assert.equal(v.archivedAt, null);
    assert.deepEqual(v.deprovisionSteps.filter((s) => s.step === 'deprov-export').map((s) => [s.status, s.action]), [['failed', 'retry']]);

    fs.writeFileSync(db, good);
    v = await customers.stepAction(c.id, 'deprov-export', 'retry', 'op');
    assert.ok(v.archivedAt);
    assert.equal(v.invoices[0].statusLabel, 'Annulée');
    assert.equal(qonto.named('cancelInvoice').length, 1);
    assert.equal(qonto.named('deactivateLink').length, 1);
    assert.equal(billing.queue().length, 0);
  } finally {
    h.cleanup();
  }
});

test('hosting-h1-fleet-runtime rule 52 — a rename waiting for the lock is already recorded; a restart then offers « Réessayer »', async () => {
  const h = makeContext({ at: AT });
  try {
    const { customers } = h.ctx.controllers;
    const c = await customers.create(CUSTOMER, 'op');
    let release;
    h.ctx.provisioner.exclusive(c.id, () => new Promise((r) => { release = r; }));
    const pending = renameTo(h, c.id, 'bbb-b');
    await ticks();
    assert.equal(h.ctx.models.provisioning.get(c.id, 'rename').status, 'running', 'the row exists before the host step runs');

    // What a restart sees: the same database, no marks in memory.
    const fresh = createCustomersController(h.ctx);
    h.ctx.provisioner.recover();
    const stored = h.ctx.models.customers.get(c.id);
    assert.equal(fresh.renamePending(stored), true);
    assert.equal(fresh.servedSlug(stored), 'aulnes');
    const v = fresh.view(c.id);
    assert.equal(v.actions.rename, false);
    assert.equal(v.actions.deprovision, false);
    assert.deepEqual(v.steps.filter((s) => s.action).map((s) => [s.step, s.action]), [['rename', 'retry']]);
    await rejects(() => fresh.deprovision(c.id, { confirmSlug: 'bbb-b' }, 'op'), 409, 'RENAME_PENDING');

    release();
    await pending;
    assert.equal(h.ctx.models.provisioning.get(c.id, 'rename').status, 'ok');
  } finally {
    h.cleanup();
  }
});

test('hosting-h1-fleet-runtime rule 53 — a held customer gets no licence file from the route', async () => {
  const h = makeContext({ at: AT });
  try {
    const { customers } = h.ctx.controllers;
    const a = await customers.create(CUSTOMER, 'op');
    h.host.failNext['process.remove'] = new Error('systemctl busy');
    await renameTo(h, a.id, 'bbb-b');
    const later = addDays(TODAY, 400);
    h.now.set(`${later}T10:00:00Z`);
    const b = await customers.create({ ...OTHER, slug: 'aulnes', startsAt: later }, 'op');
    assert.equal(customers.view(b.id).actions.downloadLicence, false);
    assert.throws(() => customers.licenceDownload(b.id), (err) => err.status === 409 && err.body.error === 'ADDRESS_HELD' && err.message === HELD);
    assert.equal(customers.licenceDownload(a.id).filename, 'licence-bbb-b.jws', 'a customer that is not held still downloads');
  } finally {
    h.cleanup();
  }
});

test('hosting-h1-fleet-runtime rule 54 — a closed customer offers no « Reprendre » and the route refuses it', async () => {
  const h = makeContext({ at: AT });
  try {
    const { customers, billing } = h.ctx.controllers;
    h.host.failNext['proxy.writeSite'] = new Error('caddy');
    const c = await customers.create(CUSTOMER, 'op');
    assert.equal(customers.view(c.id).steps.find((s) => s.step === 'route').action, 'resume');
    await billing.deprovision(c.id, { confirmSlug: c.slug }, 'op');
    const v = customers.view(c.id);
    assert.ok(v.archivedAt);
    assert.equal(v.steps.find((s) => s.step === 'route').action, null);
    const journal = v.history.length;
    const calls = h.host.calls.length;
    await rejects(() => customers.stepAction(c.id, 'route', 'resume', 'op'), 409, 'ARCHIVED');
    assert.equal(customers.view(c.id).history.length, journal, 'nothing journaled');
    assert.equal(h.host.calls.length, calls, 'no driver call');
  } finally {
    h.cleanup();
  }
});

test('hosting-h1-fleet-runtime rule 55 — during an unfinished rename the probe measures the old address that still answers', async () => {
  const h = makeContext({ at: AT });
  try {
    const { customers } = h.ctx.controllers;
    const c = await customers.create(CUSTOMER, 'op');
    h.host.certs[c.slug] = '2027-01-02T10:00:00.000Z';
    h.host.certs['bbb-b'] = '2026-11-20T10:00:00.000Z';
    h.host.failNext['process.remove'] = new Error('systemctl busy');
    await renameTo(h, c.id, 'bbb-b');
    assert.equal(h.ctx.models.provisioning.get(c.id, 'rename').status, 'failed');
    await h.ctx.probe.runOnce();
    assert.equal(h.ctx.models.hosting.get(c.id).cert_expires_at, '2027-01-02T10:00:00.000Z', 'the certificate read is the old address’s (audit R24 R3)');
    h.now.set(new Date(h.now().getTime() + 4 * 60e3));
    await h.ctx.probe.runOnce();
    const row = h.ctx.models.hosting.get(c.id);
    assert.equal(row.unit_state, 'running');
    assert.equal(row.down_since, null);
    assert.equal(h.ctx.hostAlerts.list().some((a) => a.key === `down:${c.id}`), false, 'no false « ne répond plus »');
  } finally {
    h.cleanup();
  }
});
