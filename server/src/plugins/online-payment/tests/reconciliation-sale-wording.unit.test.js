// specs/mollie-rolling-reserve-and-incoming-payments.md rule 1 (second half) (stabilisation loop t11 UI11-2, 2026-11-17) — the
// reconciliation screen words a sale outside a stay itself: « Attendu » (no fiche to wait on) and, with no client, no heading
// besides the sale's label. A stay keeps « La fiche attend » and its client. Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, dayAt, build, reset } = require('./mollieFixture');

test.beforeEach(() => { reset(); db.prepare('DELETE FROM payment_links WHERE saleRef IS NOT NULL').run(); });

test('a paid sale link without a listed sale: « Attendu », no client heading', () => {
  const paidDay = dayAt(-4);
  db.prepare(`INSERT INTO payment_links (reservationId, saleRef, type, provider, providerLinkId, url, amountCents, currency, status, createdAt, paidAt, providerPaymentId)
    VALUES (NULL, 'standalone:998', 'complement', 'qonto', 'LS998', 'u', 2000, 'EUR', 'paid', datetime('now'), ?, 'pay-s998')`).run(`${paidDay}T10:00:00Z`);
  const { controller } = build({ startDate: dayAt(-60) });
  const items = ['todo', 'waiting', 'done'].flatMap((view) => controller.list({ view }).body.items);
  const sale = items.filter((i) => i.reservation.saleKey);
  assert.ok(sale.length >= 1);
  sale.forEach((i) => {
    assert.equal(i.expectedWording, 'Attendu');
    assert.equal(i.clientHeading, '');
  });
  items.filter((i) => !i.reservation.saleKey).forEach((i) => assert.equal(i.expectedWording, 'La fiche attend'));
});
