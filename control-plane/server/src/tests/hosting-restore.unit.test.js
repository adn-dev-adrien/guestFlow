// specs/hosting-h1-fleet-runtime.md rules 13–14 — every Sunday each customer's latest backup is
// restored into a temporary folder, checked (integrity, reservations counted) and recorded, a failure
// being an alert; « Restaurer à une date » stops the instance, keeps the current database aside as
// guestflow.db.before-restore-<ts>, restores, restarts and checks health.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { makeContext, NEW_CUSTOMER } = require('./helpers');

async function oneCustomer(at = '2026-10-11T03:00:00Z') {
  const h = makeContext({ at });
  const c = await h.ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
  return { ...h, c };
}

test('rule 13 — on Sunday the latest backup is restored aside, checked, its reservations counted, and recorded', async () => {
  const h = await oneCustomer('2026-10-11T04:30:00Z');
  try {
    const out = await h.ctx.weeklyRestore.runIfDue();
    assert.deepEqual(out.map((r) => [r.ok, r.reservations]), [[true, 1]]);
    assert.equal(h.ctx.models.hosting.get(h.c.id).last_backup_verified_at, '2026-10-11T04:30:00.000Z');
    assert.equal(h.ctx.models.hosting.lastCheck(h.c.id).reservations, 1);
    assert.equal(await h.ctx.weeklyRestore.runIfDue(), null, 'once a Sunday');
    assert.equal(h.host.named('process.stop').length, 0, 'the running instance is never touched');
    h.now.set('2026-10-12T04:30:00Z');
    assert.equal(await h.ctx.weeklyRestore.runIfDue(), null, 'Monday: nothing');
    assert.match(h.ctx.controllers.customers.view(h.c.id).hosting.lines.find((l) => l.label === 'Restauration vérifiée').value, /^11\/10\/2026 — 1 réservation\(s\)$/);
  } finally {
    h.cleanup();
  }
});

test('rule 13 — a restore that fails is an alert, closed by the next good one', async () => {
  const h = await oneCustomer('2026-10-11T04:30:00Z');
  try {
    h.host.failNext.restoreCorrupt = true;
    await h.ctx.weeklyRestore.runIfDue();
    const alert = h.ctx.controllers.alerts.list().alerts.find((a) => /restauration de contrôle a échoué/.test(a.text));
    assert.ok(alert);
    assert.equal(alert.customerId, h.c.id);
    assert.equal(h.ctx.models.hosting.get(h.c.id).last_backup_verified_at, null);
    h.now.set('2026-10-18T04:30:00Z');
    await h.ctx.weeklyRestore.runIfDue();
    assert.ok(!h.ctx.controllers.alerts.list().alerts.some((a) => /restauration de contrôle/.test(a.text)));
  } finally {
    h.cleanup();
  }
});

test('rule 14 — « Restaurer à une date »: stopped, current database kept aside, restored, restarted, healthy', async () => {
  const h = await oneCustomer('2026-10-08T10:00:00Z');
  try {
    const dbPath = path.join(h.root, 'aulnes', 'data', 'guestflow.db');
    const w = await h.ctx.controllers.fleet.restoreWindow(h.c.id);
    assert.equal(w.available, true);
    assert.match(w.text, /^Du 01\/09\/2026 02:00 au 08\/10\/2026 12:00\.$/);
    const v = await h.ctx.controllers.fleet.restore(h.c.id, { at: '2026-10-08T09:00:00Z' }, 'op');
    assert.equal(v.notice, 'Base restaurée (1 réservation(s)).');
    const aside = fs.readdirSync(path.dirname(dbPath)).filter((f) => f.startsWith('guestflow.db.before-restore-'));
    assert.deepEqual(aside, ['guestflow.db.before-restore-2026-10-08T10-00-00-000Z']);
    const names = h.host.calls.map((c) => c.name);
    const tail = names.slice(names.indexOf('backup.restore'));
    assert.deepEqual(tail, ['backup.restore', 'process.stop', 'backup.removeReplica', 'process.start', 'backup.addReplica']);
    assert.equal(h.host.procs.get('aulnes').running, true);
    const db = new Database(dbPath, { readonly: true });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservations').get().n, 1);
    db.close();
    assert.ok(v.history.some((x) => /^Base restaurée au 08\/10\/2026 11:00 \(1 réservation\(s\)\)/.test(x.text)));
  } finally {
    h.cleanup();
  }
});

test('rule 14 — a moment outside the retention, or a backup that does not read, is refused before anything stops', async () => {
  const h = await oneCustomer('2026-10-08T10:00:00Z');
  try {
    const { fleet } = h.ctx.controllers;
    await assert.rejects(fleet.restore(h.c.id, { at: '2026-08-01T00:00:00Z' }, 'op'), (e) => e.body.error === 'OUT_OF_RANGE');
    await assert.rejects(fleet.restore(h.c.id, { at: 'demain' }, 'op'), (e) => e.body.error === 'INVALID');
    h.host.failNext.restoreCorrupt = true;
    await assert.rejects(fleet.restore(h.c.id, { at: '2026-10-08T09:00:00Z' }, 'op'), (e) => e.body.error === 'BAD_BACKUP');
    assert.equal(h.host.named('process.stop').length, 0);
  } finally {
    h.cleanup();
  }
});
