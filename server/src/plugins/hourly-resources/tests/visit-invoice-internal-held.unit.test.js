// specs/sas/outside-booking-sas.md rule 56 (c) (stabilisation loop t4 B4-5; reading of rule 31 « no caisse-interne line ») — the invoice is refused
// `INTERNAL_CASH` while the document still HOLDS caisse-interne money (the core's `totals.internalHeldCents`), not because a payment once had an internal
// tender: beers paid in the caisse interne, then offered and given back, leave a card-paid plank that is invoiced.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../../database');
const standaloneSale = require('../../../utils/standaloneSale');
const links = require('../../../utils/standaloneSaleLinks');
const sales = require('../../../models/standaloneSalesModel');
const { documentInvoiceRefusal } = require('../invoicing');

const option = (title, price, vatClass) => Number(db.prepare("INSERT INTO options (title, price, priceType, sellableExternally, vatClass) VALUES (?, ?, 'per_stay', 1, ?)")
  .run(title, price, vatClass).lastInsertRowid);
const beer = option('Bière interne B4', 6.5, 'drinks');
const board = option('Planche interne B4', 14, 'catering');
sales.setExternalRate('drinks', 20);
sales.setExternalRate('catering', 10);

const refusalOf = (id) => {
  const document = standaloneSale.documentOf(id);
  const money = {
    totalCents: document.totals.totalCents, remainingCents: document.totals.remainingCents, document, payments: standaloneSale.paymentsOf(id),
  };
  const refused = documentInvoiceRefusal({ reservationId: null, frozen: false }, money, { isReady: () => true });
  return refused ? refused.code : null;
};

test('B4-5 (I1) — caisse-interne beers given back: the card-paid plank is invoiceable; while the beers hold their internal money it is refused', () => {
  const sold = standaloneSale.sell({ lines: [{ articleRef: `option:${beer}`, quantity: 2 }] }).document;
  const { id } = sold.document;
  standaloneSale.pay(id, { tenders: [{ method: 'cash', amountCents: 1300, internal: true }] });
  standaloneSale.sell({ saleId: id, version: standaloneSale.documentOf(id).document.version, lines: [{ articleRef: `option:${board}`, quantity: 1 }], payment: { tenders: [{ method: 'card', amountCents: 1400 }] } });
  assert.equal(standaloneSale.documentOf(id).totals.internalHeldCents, 1300);
  assert.equal(refusalOf(id), 'INTERNAL_CASH');
  standaloneSale.offerLine(id, sold.lines[0].id, { offered: true, confirmRefund: true });
  const [row] = sales.obligationsOf(id);
  assert.equal(links.closeObligation(id, row.id, 'settled').status, 200);
  assert.equal(standaloneSale.documentOf(id).totals.internalHeldCents, 0);
  assert.equal(refusalOf(id), null, 'nothing internal left: the plank is invoiced');
});

test('B4-5 — internal money moved onto a line still due (rule 52) is still held: refused', () => {
  const sold = standaloneSale.sell({ lines: [{ articleRef: `option:${beer}`, quantity: 2 }, { articleRef: `option:${board}`, quantity: 1 }] }).document;
  const { id } = sold.document;
  standaloneSale.pay(id, { tenders: [{ method: 'cash', amountCents: 1300, internal: true }, { method: 'card', amountCents: 1400 }] });
  standaloneSale.offerLine(id, sold.lines[0].id, { offered: true, confirmRefund: true });
  standaloneSale.sell({ saleId: id, version: standaloneSale.documentOf(id).document.version, lines: [{ articleRef: `option:${board}`, quantity: 1 }], payment: { tenders: [{ method: 'card', amountCents: 100 }] } });
  assert.ok(standaloneSale.documentOf(id).totals.internalHeldCents > 0);
  assert.equal(refusalOf(id), 'INTERNAL_CASH');
});
