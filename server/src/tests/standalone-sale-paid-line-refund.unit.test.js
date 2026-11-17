// specs/outside-booking-sas.md rules 25, 41, 44, 45 (loop t1 B-1, UI-18) — a counter document's paid line offered or removed with the confirmation, or the paid document
// cancelled, opens a `lineLowered` row for what it now owes back: the counter's « À rembourser » block lists it, « Marquer remboursé » closes it, and nothing is
// owed twice.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database');
const standaloneSale = require('../utils/standaloneSale');
const links = require('../utils/standaloneSaleLinks');
const sales = require('../models/standaloneSalesModel');

const option = (title, price, vatClass) => Number(db.prepare("INSERT INTO options (title, price, priceType, sellableExternally, vatClass) VALUES (?, ?, 'per_stay', 1, ?)")
  .run(title, price, vatClass).lastInsertRowid);
const beer = option('Bière ronde', 6.5, 'drinks');
const board = option('Planche ronde', 14, 'catering');
sales.setExternalRate('drinks', 20);
sales.setExternalRate('catering', 10);
const paidSale = () => standaloneSale.sell({ lines: [{ articleRef: `option:${beer}`, quantity: 2 }, { articleRef: `option:${board}`, quantity: 1 }], payment: { tenders: [{ method: 'card', amountCents: 2700 }] } });
const rowsOf = (saleId) => db.prepare('SELECT origin, amountCents, status, reason FROM standalone_sale_obligations WHERE saleId = ? ORDER BY id').all(saleId);

test('B-1 — offering the paid beers opens one 13 € row; the counter lists the document; closing it as refunded leaves nothing owed', () => {
  const sold = paidSale();
  const { id } = sold.document.document;
  const offered = standaloneSale.offerLine(id, sold.document.lines[0].id, { offered: true, confirmRefund: true });
  assert.equal(offered.status, 200, JSON.stringify(offered.body));
  assert.deepEqual(rowsOf(id).map((r) => [r.origin, r.amountCents, r.status]), [['lineLowered', 1300, 'open']]);
  assert.match(rowsOf(id)[0].reason, /offerte après paiement/);
  assert.deepEqual([offered.document.totals.refundOwedCents, offered.document.totals.refundUnheldCents], [1300, 0]);
  assert.ok(sales.counterSalesOwing().includes(id));
  const [row] = sales.obligationsOf(id);
  // Loop t4 B4-2 — the close writes the money given back (rule 49): no closed row is subtracted on its own any more.
  assert.equal(links.closeObligation(id, row.id, 'settled').status, 200);
  const after = standaloneSale.documentOf(id);
  assert.deepEqual([after.totals.refundOwedCents, after.refundObligations.length], [0, 0]);
  assert.ok(!sales.counterSalesOwing().includes(id));
});

test('B-1 — cancelling the paid document owes the rest once: one row for what no row held yet', () => {
  const sold = paidSale();
  const { id } = sold.document.document;
  standaloneSale.offerLine(id, sold.document.lines[0].id, { offered: true, confirmRefund: true });
  const cancelled = standaloneSale.cancel(id);
  assert.equal(cancelled.status, 200);
  assert.deepEqual(rowsOf(id).map((r) => r.amountCents), [1300, 1400]);
  assert.deepEqual([cancelled.document.totals.refundOwedCents, cancelled.document.totals.refundUnheldCents], [2700, 0]);
});

test('B-1 — an unpaid line removed opens nothing', () => {
  const sold = standaloneSale.sell({ lines: [{ articleRef: `option:${beer}`, quantity: 1 }] });
  const { id } = sold.document.document;
  assert.equal(standaloneSale.removeLine(id, sold.document.lines[0].id).status, 200);
  assert.deepEqual(rowsOf(id), []);
});

test('UI-18 — the counter list serves the « À rembourser » block on its own title, each row naming its sale\'s day', () => {
  const controller = require('../controllers/standaloneSalesController');
  const sold = paidSale();
  const { id } = sold.document.document;
  standaloneSale.offerLine(id, sold.document.lines[0].id, { offered: true, confirmRefund: true });
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  controller.list({ query: {} }, res);
  assert.equal(res.body.owedTitle, 'À rembourser');
  const row = res.body.owed.find((r) => r.id === id);
  assert.match(row.soldDayLabel, /^Vente du \d{2}\/\d{2}$/);
  assert.deepEqual(row.refundObligations.map((r) => r.amountCents), [1300]);
});
