// specs/pricing/pricing-components.md §3 rules 36, 75, 97 (loop t1 D-1, D-5, D-6) — the S9 backfill of the refund register reads the links once: a link the live
// register already holds (any origin) gets no second row, a link with no stay is skipped without failing the boot, and the sale link is no stay's to settle.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database');
const { runPricingLinesMigration } = require('../utils/pricingLinesMigration');
const { settleWithdrawnPayment } = require('../utils/withdrawnPayments');
const paymentLinksModel = require('../models/paymentLinksModel');

db.prepare("INSERT INTO properties (id, name) VALUES (9801, 'S9')").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9801, 'Test', 'S9')").run();
const stay = (kind = 'reservation') => Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, kind, finalPrice, totalPrice)
  VALUES (9801, 9801, date('now', '+20 day'), date('now', '+23 day'), ?, 300, 300)`).run(kind).lastInsertRowid);
const link = (fields) => {
  const row = { type: 'full', amountCents: 3000, status: 'paid', paidAt: "datetime('now')", ...fields };
  return Number(db.prepare(`INSERT INTO payment_links (reservationId, type, amountCents, status, paidAt, cancelReason, basketJson, saleRef)
    VALUES (?, ?, ?, ?, datetime('now'), ?, ?, ?)`).run(row.reservationId ?? null, row.type, row.amountCents, row.status, row.cancelReason ?? null, row.basketJson ?? null, row.saleRef ?? null).lastInsertRowid);
};
const rowsOf = (linkId) => db.prepare('SELECT origin, amountCents, status FROM refund_obligations WHERE paymentLinkId = ? ORDER BY id').all(linkId);
const rerunS9 = () => {
  db.prepare("DELETE FROM migrations WHERE name = 'pricing_obligations_s9_v1'").run();
  return runPricingLinesMigration(db);
};

test('D-1 — a basket the poll flagged and opened as `orderConflict` gets no `basket` row at the next boot, even once the operator closed it', () => {
  const id = stay();
  const paid = link({ reservationId: id, basketJson: JSON.stringify({ source: 'guestOrder', refundOwed: true }) });
  db.prepare("INSERT INTO refund_obligations (reservationId, origin, paymentLinkId, amountCents, status) VALUES (?, 'orderConflict', ?, 3000, 'settled')").run(id, paid);
  rerunS9();
  assert.deepEqual(rowsOf(paid), [{ origin: 'orderConflict', amountCents: 3000, status: 'settled' }]);
});

test('D-5 — a devis link refunded as `neverBooked` gets no `withdrawnLink` twin', () => {
  const id = stay('devis');
  const withdrawn = link({ reservationId: id, status: 'cancelled', cancelReason: 'refunded' });
  db.prepare("INSERT INTO refund_obligations (reservationId, origin, paymentLinkId, amountCents, status, settledBy) VALUES (?, 'neverBooked', ?, 3000, 'settled', 'provider')").run(id, withdrawn);
  rerunS9();
  assert.deepEqual(rowsOf(withdrawn), [{ origin: 'neverBooked', amountCents: 3000, status: 'settled' }]);
});

test('D-6 — a refunded link that names no stay is skipped: the boot does not fail', () => {
  const orphan = link({ status: 'cancelled', cancelReason: 'refunded', saleRef: 'standalone:1' });
  assert.doesNotThrow(() => rerunS9());
  assert.deepEqual(rowsOf(orphan), []);
});

test('rule 36 — S9 runs once: a later flagged link is the live register\'s, the next boot writes nothing', () => {
  rerunS9();
  const id = stay();
  const later = link({ reservationId: id, basketJson: JSON.stringify({ source: 'shop', refundOwed: true }) });
  assert.equal(runPricingLinesMigration(db).obligations, 0);
  assert.deepEqual(rowsOf(later), []);
});

test('D-6 — settling a withdrawn payment refuses an outside sale\'s link (409 SALE_LINK) and leaves it unsettled', async () => {
  const sale = link({ status: 'cancelled', cancelReason: 'operator', saleRef: 'standalone:2' });
  await assert.rejects(settleWithdrawnPayment(sale, { database: db, paymentLinksModel, outcome: 'refunded', bookPaid: async () => {} }), (err) => err.error === 'SALE_LINK');
  assert.equal(db.prepare('SELECT cancelReason FROM payment_links WHERE id = ?').get(sale).cancelReason, 'operator');
});
