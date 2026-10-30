// specs/payment-link-lifecycle.md rule 5 — at the first boot of this version every OPEN link whose stay row
// is missing is withdrawn once (`cancelled` / `orphan`, deactivation owed when it has a provider id), with
// one log line per link; paid and cancelled rows are untouched, no network call, a second boot does nothing.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const { runOrphanPaymentLinksMigration, MIGRATION_NAME } = require('../utils/orphanPaymentLinksMigration');

const NOW = new Date('2026-10-30T10:00:00Z');

function link({ reservationId, type = 'full', status = 'open', amountCents = 76280, providerLinkId = 'pl_x', provider = 'qonto', cancelReason = null, paidAt = null }) {
  return Number(db.prepare(`INSERT INTO payment_links (reservationId, type, status, amountCents, providerLinkId, provider, cancelReason, paidAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(reservationId, type, status, amountCents, providerLinkId, provider, cancelReason, paidAt).lastInsertRowid);
}
const row = (id) => db.prepare('SELECT * FROM payment_links WHERE id = ?').get(id);

test('rule 5 — the boot of a fresh database already recorded the migration', () => {
  assert.equal(MIGRATION_NAME, 'orphan_payment_links_withdrawn_v1');
  assert.ok(db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(MIGRATION_NAME));
  const logged = [];
  const out = runOrphanPaymentLinksMigration(db, { now: NOW, logger: { log: (m) => logged.push(m) } });
  assert.deepEqual(out, { ran: false, withdrawn: [] }, 'a second boot does nothing');
  assert.deepEqual(logged, []);
});

test('rule 5 — open orphans are withdrawn once, paid / cancelled / live links untouched, one log line per link', () => {
  db.prepare('DELETE FROM migrations WHERE name = ?').run(MIGRATION_NAME);
  const propertyId = Number(db.prepare("INSERT INTO properties (name) VALUES ('Gite')").run().lastInsertRowid);
  const clientId = Number(db.prepare("INSERT INTO clients (firstName, lastName) VALUES ('Test', 'Client')").run().lastInsertRowid);
  const stayId = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate) VALUES ('reservation', ?, ?, '2026-12-01', '2026-12-03')`).run(propertyId, clientId).lastInsertRowid);

  const full = link({ reservationId: 922299, type: 'full', amountCents: 76280, providerLinkId: 'pl_13' });
  const deposit = link({ reservationId: 922300, type: 'deposit', amountCents: 21494, providerLinkId: 'pl_14' });
  const local = link({ reservationId: 922301, type: 'balance', amountCents: 5000, providerLinkId: null });
  const paid = link({ reservationId: 922302, status: 'paid', paidAt: '2026-10-01T10:00:00Z' });
  const cancelled = link({ reservationId: 922303, status: 'cancelled', cancelReason: 'settled' });
  const expired = link({ reservationId: 922304, status: 'expired' });
  const live = link({ reservationId: stayId, type: 'deposit' });
  const before = { paid: row(paid), cancelled: row(cancelled), expired: row(expired), live: row(live) };

  const logged = [];
  const out = runOrphanPaymentLinksMigration(db, { now: NOW, logger: { log: (m) => logged.push(m) } });
  assert.equal(out.ran, true);
  assert.deepEqual(out.withdrawn.map((l) => l.id), [full, deposit, local]);

  for (const id of [full, deposit]) {
    const r = row(id);
    assert.equal(r.status, 'cancelled');
    assert.equal(r.cancelReason, 'orphan');
    assert.equal(r.remoteCancelPendingAt, NOW.toISOString(), 'deactivation owed, done by the first poll pass');
  }
  assert.equal(row(local).status, 'cancelled');
  assert.equal(row(local).cancelReason, 'orphan');
  assert.equal(row(local).remoteCancelPendingAt, null, 'no provider id: nothing to deactivate');

  assert.deepEqual(row(paid), before.paid, 'a paid orphan is a money record: untouched');
  assert.deepEqual(row(cancelled), before.cancelled);
  assert.deepEqual(row(expired), before.expired);
  assert.deepEqual(row(live), before.live, 'a link whose stay exists is not an orphan');

  const flat = logged.map((m) => m.replace(/[  ]/g, ' '));
  assert.deepEqual(flat, [
    `[migration:orphan-links] link #${full} (full, 762,80 €, former stay 922299) withdrawn: deactivation owed at qonto`,
    `[migration:orphan-links] link #${deposit} (deposit, 214,94 €, former stay 922300) withdrawn: deactivation owed at qonto`,
    `[migration:orphan-links] link #${local} (balance, 50,00 €, former stay 922301) withdrawn: no provider link to deactivate`,
  ]);
  assert.ok(db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(MIGRATION_NAME));

  const reopened = link({ reservationId: 922399 });
  const again = runOrphanPaymentLinksMigration(db, { now: NOW, logger: { log: (m) => logged.push(m) } });
  assert.deepEqual(again, { ran: false, withdrawn: [] }, 'keyed in migrations: runs once');
  assert.equal(row(reopened).status, 'open');
  assert.equal(logged.length, 3);
});

test('rule 5 — a withdrawn orphan joins the retry list the first poll pass reads (rule 8)', () => {
  const pending = require('../models/paymentLinksModel').buildModel(db).listRemoteCancelPending();
  assert.ok(pending.some((l) => l.cancelReason === 'orphan'));
});

test('rule 5 — the boot warning still lists the cancelled orphans whose deactivation is owed', () => {
  const owed = require('../models/paymentLinksModel').buildModel(db).listOrphanOpen();
  assert.ok(owed.some((l) => l.status === 'cancelled'));
});
