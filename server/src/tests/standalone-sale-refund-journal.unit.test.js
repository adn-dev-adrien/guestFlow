// specs/outside-booking-sas.md rule 48 (stabilisation loop t1, B-1 accounting part; completes rules 25, 30, 44) and specs/pricing-components.md rules 63,
// 74 — « Marquer remboursé » on a document's `lineLowered` row writes the money given back as refund allocations, and the journal books the document's
// avoir on that day: the revenue and the VAT of the refunded line leave the books, the caisse interne stays off them, nothing is owed or refunded twice.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const standaloneSale = require('../utils/standaloneSale');
const links = require('../utils/standaloneSaleLinks');
const sales = require('../models/standaloneSalesModel');
const standaloneSales = require('../utils/standaloneSales');
const { todayIso } = require('../utils/localDate');
const { skipWithout } = require('../plugins/sdk/testing');

const NEEDS_PLAN = { skip: skipWithout(['accounting-export']) };
const option = (title, price, vatClass) => Number(db.prepare("INSERT INTO options (title, price, priceType, sellableExternally, vatClass) VALUES (?, ?, 'per_stay', 1, ?)")
  .run(title, price, vatClass).lastInsertRowid);
const beer = option('Bière avoir', 6.5, 'drinks');
const board = option('Planche avoir', 14, 'catering');
sales.setExternalRate('drinks', 20);
sales.setExternalRate('catering', 10);
const TODAY = todayIso();

const paidSale = (tenders = [{ method: 'card', amountCents: 2700 }]) => standaloneSale.sell({
  lines: [{ articleRef: `option:${beer}`, quantity: 2 }, { articleRef: `option:${board}`, quantity: 1 }], payment: { tenders },
}).document;
const refundRows = (id) => db.prepare("SELECT paymentRef, lineRef, amountCents, books, at, refundId FROM payment_allocations WHERE documentRef = ? AND kind = 'refund' ORDER BY id")
  .all(sales.documentRef(id));
const settleAll = (id) => sales.obligationsOf(id).map((row) => links.closeObligation(id, row.id, 'settled', { actor: 'admin@exemple.fr' }));
const entriesOf = (id) => standaloneSales.list({ from: TODAY, to: TODAY }).filter((sale) => String(sale.key).startsWith(`standalone:${id}:`));
const groupsOf = (sale) => sale.groups.map((g) => [g.vatClass, g.ttcCents, g.vatCents]);

test('rule 48 — the beers offered then refunded: one refund allocation on their line, the document owes nothing and asks nothing', () => {
  const sold = paidSale();
  const { id } = sold.document;
  standaloneSale.offerLine(id, sold.lines[0].id, { offered: true, confirmRefund: true });
  const [closed] = settleAll(id);
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  const [row] = db.prepare('SELECT id FROM standalone_sale_obligations WHERE saleId = ?').all(id);
  assert.deepEqual(refundRows(id), [{ paymentRef: `standalone-refund:${row.id}`, lineRef: sold.lines[0].ref, amountCents: -1300, books: 1, at: TODAY, refundId: row.id }]);
  const doc = standaloneSale.documentOf(id);
  assert.deepEqual([doc.totals.refundOwedCents, doc.totals.refundUnheldCents, doc.totals.remainingCents], [0, 0, 0]);
  assert.equal(sales.findSale(id).status, 'paid');
  assert.equal(closed.document.history.at(-1).text, '13,00 € remboursés');
});

test('rule 48 — the journal books the sale on its day and the avoir of the money given back; the drinks net to nothing', NEEDS_PLAN, () => {
  const sold = paidSale();
  const { id } = sold.document;
  standaloneSale.offerLine(id, sold.lines[0].id, { offered: true, confirmRefund: true });
  settleAll(id);
  const [sale, avoir] = entriesOf(id);
  assert.deepEqual(groupsOf(sale), [['catering', 1400, 127], ['drinks', 1300, 217]], 'the sale of the day is booked as it was');
  assert.equal(avoir.role, 'refund');
  assert.deepEqual([avoir.key, avoir.booksCents, avoir.cardCents, avoir.totalCents], [`standalone:${id}:${TODAY}:refund`, 1300, 0, 0]);
  assert.deepEqual(groupsOf(avoir), [['drinks', 1300, 217]]);

  const { buildStandaloneEntry } = require('../utils/accounting/accountingOutput');
  const { create } = require('../utils/accounting/journalLines');
  const lines = create({ accountPlan: require('../plugins/accounting-export/accountPlan') }).entryLines(buildStandaloneEntry(avoir));
  assert.deepEqual(lines.map((l) => [l.role, l.side, l.amountCents]), [['customer', 'credit', 1300], ['revenue:drinks', 'debit', 1083], ['vat:20', 'debit', 217]]);
  const entry = buildStandaloneEntry(avoir);
  assert.deepEqual([entry.kind, entry.standaloneRole], ['standaloneRefund', 'refund']);
});

test('rule 48 — the paid document cancelled then refunded: every cent of revenue and VAT leaves the books, nothing is refunded twice', NEEDS_PLAN, () => {
  const sold = paidSale();
  const { id } = sold.document;
  standaloneSale.cancel(id);
  settleAll(id);
  assert.equal(refundRows(id).reduce((sum, row) => sum + row.amountCents, 0), -2700);
  const [sale, avoir] = entriesOf(id);
  assert.deepEqual(groupsOf(avoir), groupsOf(sale));
  const doc = standaloneSale.documentOf(id);
  assert.deepEqual([doc.totals.refundOwedCents, doc.totals.refundUnheldCents], [0, 0]);
});

test('rule 48 — a line paid partly in the caisse interne gives back its booked part first; the avoir books only that part', NEEDS_PLAN, () => {
  const sold = paidSale([{ method: 'cash', amountCents: 1300, internal: true }, { method: 'card', amountCents: 1400 }]);
  const { id } = sold.document;
  standaloneSale.offerLine(id, sold.lines[1].id, { offered: true, confirmRefund: true });
  settleAll(id);
  assert.deepEqual(refundRows(id).map((row) => [row.amountCents, row.books]), [[-100, 1], [-1300, 0]]);
  const avoir = entriesOf(id).find((sale) => sale.role === 'refund');
  assert.deepEqual(groupsOf(avoir), [['catering', 100, 9]]);
});

test('rule 48 — a row closed « rien à rembourser » writes no refund: the line keeps the money it was paid', () => {
  const sold = paidSale();
  const { id } = sold.document;
  standaloneSale.offerLine(id, sold.lines[0].id, { offered: true, confirmRefund: true });
  const [row] = sales.obligationsOf(id);
  assert.equal(links.closeObligation(id, row.id, 'cancelled').status, 200);
  assert.deepEqual(refundRows(id), []);
  assert.equal(standaloneSale.documentOf(id).totals.refundOwedCents, 0);
  assert.equal(entriesOf(id).filter((sale) => sale.role).length, 0);
});
