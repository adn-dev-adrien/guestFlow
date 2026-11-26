// specs/sas/outside-booking-sas.md rule 56 (d) (stabilisation loop t4 B4-6; rules 4, 45, 55 a) — the preview of a stored document is the plan its commit runs:
// the money on no line and a lowered line's money pay the lines being added, and the open rows are shown at the amounts that plan leaves them. Nothing
// is written by a quote.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const standaloneSale = require('../utils/standaloneSale');
const links = require('../utils/standaloneSaleLinks');
const sales = require('../models/standaloneSalesModel');
const { todayIso } = require('../utils/localDate');

const option = (title, price, vatClass) => Number(db.prepare("INSERT INTO options (title, price, priceType, sellableExternally, vatClass) VALUES (?, ?, 'per_stay', 1, ?)")
  .run(title, price, vatClass).lastInsertRowid);
const beer = option('Bière devis B4', 6.5, 'drinks');
const board = option('Planche devis B4', 14, 'catering');
sales.setExternalRate('drinks', 20);
sales.setExternalRate('catering', 10);

const sellBoth = (cents) => standaloneSale.sell({
  lines: [{ articleRef: `option:${beer}`, quantity: 2 }, { articleRef: `option:${board}`, quantity: 1 }],
  payment: { tenders: [{ method: 'card', amountCents: cents }], ...(cents < 2700 ? { shortfall: { kind: 'due' } } : {}) },
}).document;
const view = (document) => ({
  lines: document.lines.map((line) => [line.status, line.settledCents]),
  totals: [document.totals.totalCents, document.totals.remainingCents, document.totals.refundOwedCents, document.totals.refundUnheldCents],
  rows: document.refundObligations.map((row) => [row.origin, row.amountCents, row.label]),
});
const written = (id) => JSON.stringify([
  db.prepare('SELECT * FROM payment_allocations WHERE documentRef = ? ORDER BY id').all(sales.documentRef(id)),
  db.prepare('SELECT * FROM standalone_sale_obligations WHERE saleId = ? ORDER BY id').all(id),
]);

test('B4-6 (Q1) — a 13 € link surplus open: the quote of one beer more shows it paid by the surplus and the row at 6,50 €, and the commit agrees', () => {
  const sold = sellBoth(1300);
  const { id } = sold.document;
  standaloneSale.offerLine(id, sold.lines[0].id, { offered: true, confirmRefund: true });
  const link = Number(db.prepare("INSERT INTO payment_links (reservationId, saleRef, type, amountCents, status) VALUES (NULL, ?, 'complement', 1400, 'paid')").run(sales.documentRef(id)).lastInsertRowid);
  links.settlePaidLink({ link: { id: link, saleRef: sales.documentRef(id), amountCents: 1400 }, paidDate: todayIso() });
  const before = written(id);
  const quoted = standaloneSale.quote({ saleId: id, lines: [{ articleRef: `option:${beer}`, quantity: 1 }] });
  assert.equal(written(id), before, 'a quote writes nothing');
  assert.deepEqual(view(quoted.document), {
    lines: [['offered', 0], ['paid', 1400], ['paid', 650]],
    totals: [2050, 0, 650, 0],
    rows: [['linkSurplus', 650, '6,50 € à rembourser']],
  });
  const sold2 = standaloneSale.sell({ saleId: id, version: quoted.document.document.version, lines: [{ articleRef: `option:${beer}`, quantity: 1 }] });
  assert.deepEqual(view(sold2.document), view(quoted.document), 'the commit is what the preview showed');
});

test('B4-6 (Q2) — the paid beers offered (a 13 € row): the quote of a plank more shows the row gone and 1 € due, as the commit leaves it', () => {
  const sold = sellBoth(2700);
  const { id } = sold.document;
  standaloneSale.offerLine(id, sold.lines[0].id, { offered: true, confirmRefund: true });
  const quoted = standaloneSale.quote({ saleId: id, lines: [{ articleRef: `option:${board}`, quantity: 1 }] });
  assert.deepEqual(view(quoted.document), {
    lines: [['offered', 0], ['paid', 1400], ['due', 1300]],
    totals: [2800, 100, 0, 0],
    rows: [],
  });
  assert.equal(sales.obligationsOf(id).length, 1, 'the stored row is untouched by the quote');
  const sold2 = standaloneSale.sell({ saleId: id, version: quoted.document.document.version, lines: [{ articleRef: `option:${board}`, quantity: 1 }] });
  assert.deepEqual(view(sold2.document), view(quoted.document));
});
