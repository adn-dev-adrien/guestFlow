// specs/sas/outside-booking-sas.md rule 56 (a), (b) (stabilisation loop t4 B4-1, B4-2; owner decision 2026-11-16) — a paid line lowered, then its row
// closed « rien à rembourser », is money kept: a tip like a kept link surplus (rule 50). Kept allocations take it off the line (its revenue and VAT
// leave the journal on the close day, the tip comes in), so the journal nets exactly the paid lines the Qonto invoice states, and what the document
// owes afterwards follows its lines — no closed row is subtracted forever.
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

const option = (title, price, vatClass) => Number(db.prepare("INSERT INTO options (title, price, priceType, sellableExternally, vatClass) VALUES (?, ?, 'per_stay', 1, ?)")
  .run(title, price, vatClass).lastInsertRowid);
const beer = option('Bière gardée B4', 6.5, 'drinks');
const board = option('Planche gardée B4', 14, 'catering');
sales.setExternalRate('drinks', 20);
sales.setExternalRate('catering', 10);
const TODAY = todayIso();

// 2 beers 13 € + a plank 14 €, 27 € by card.
function paidSale() {
  const sold = standaloneSale.sell({
    lines: [{ articleRef: `option:${beer}`, quantity: 2 }, { articleRef: `option:${board}`, quantity: 1 }], payment: { tenders: [{ method: 'card', amountCents: 2700 }] },
  }).document;
  return { id: sold.document.id, beers: sold.lines[0], plank: sold.lines[1] };
}
const entries = (id) => standaloneSales.list({ from: TODAY, to: TODAY }).filter((sale) => String(sale.key).startsWith(`standalone:${id}:`));
// The journal net per (class, rate) — sales less avoirs — and the tips.
function books(id) {
  const net = {};
  let tips = 0;
  for (const sale of entries(id)) {
    if (sale.role === 'tip') { tips += sale.booksCents; continue; }
    const sign = sale.role === 'refund' ? -1 : 1;
    for (const g of sale.groups) {
      const key = `${g.vatClass}|${g.rate}`;
      net[key] = net[key] || [0, 0];
      net[key][0] += sign * g.ttcCents;
      net[key][1] += sign * g.vatCents;
    }
  }
  return { net: Object.fromEntries(Object.entries(net).filter(([, v]) => v[0] || v[1])), tips };
}
const keptRows = (id) => db.prepare("SELECT paymentRef, lineRef, amountCents, kind, books FROM payment_allocations WHERE documentRef = ? AND paymentRef LIKE 'standalone-kept:%' ORDER BY id")
  .all(sales.documentRef(id));
const closeRien = (id) => {
  const [row] = sales.obligationsOf(id);
  const closed = links.closeObligation(id, row.id, 'cancelled');
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  return { row, document: closed.document };
};

test('B4-1 (C1) — beers offered, row closed « rien »: kept allocations on the beers, the journal keeps the plank only and books a 13 € tip', () => {
  const { id, beers } = paidSale();
  standaloneSale.offerLine(id, beers.id, { offered: true, confirmRefund: true });
  const { row, document } = closeRien(id);
  assert.deepEqual(keptRows(id), [{
    paymentRef: `standalone-kept:${row.id}`, lineRef: beers.ref, amountCents: -1300, kind: 'payment', books: 1,
  }]);
  assert.equal(document.history.at(-1).text, '13,00 € gardés en pourboire');
  assert.deepEqual(books(id), { net: { 'catering|10': [1400, 127] }, tips: 1300 }, 'the books state the plank the invoice states');
  assert.deepEqual([document.totals.totalCents, document.totals.paidCents, document.totals.refundOwedCents, document.document.status], [1400, 1400, 0, 'paid']);
});

test('B4-1 (C2) — a paid line removed then closed « rien »: the same tip, the same books', () => {
  const { id, beers } = paidSale();
  standaloneSale.removeLine(id, beers.id, { confirmRefund: true });
  closeRien(id);
  assert.deepEqual(books(id), { net: { 'catering|10': [1400, 127] }, tips: 1300 });
});

test('B4-2 (C13) — after a « rien », the beers made payable again are asked again; removing the plank owes what the lines say', () => {
  const { id, beers, plank } = paidSale();
  standaloneSale.offerLine(id, beers.id, { offered: true, confirmRefund: true });
  closeRien(id);
  const back = standaloneSale.offerLine(id, beers.id, { offered: false });
  assert.deepEqual([back.document.totals.totalCents, back.document.totals.paidCents, back.document.totals.remainingCents], [2700, 1400, 1300],
    'the 13 € kept were a tip: they pay no line any more');
  const asked = standaloneSale.removeLine(id, plank.id, {});
  assert.deepEqual([asked.status, asked.body.refundCents], [409, 100], 'the plank\'s 14 € pay the beers 13 €, 1 € is owed back');
  const removed = standaloneSale.removeLine(id, plank.id, { confirmRefund: true });
  assert.deepEqual([removed.document.totals.refundOwedCents, removed.document.refundObligations.map((r) => r.amountCents)], [100, [100]]);
  const [open] = sales.obligationsOf(id);
  const refunded = links.closeObligation(id, open.id, 'settled').document;
  assert.deepEqual([refunded.totals.totalCents, refunded.totals.paidCents, refunded.totals.refundOwedCents, refunded.document.status], [1300, 1300, 0, 'paid']);
  assert.deepEqual(books(id), { net: { 'drinks|20': [1300, 217] }, tips: 1300 }, 'journal = the beers the invoice would state');
});

test('B4-2 (C14) — after a « rien », the whole document cancelled owes the plank\'s 14 €, never less', () => {
  const { id, beers } = paidSale();
  standaloneSale.offerLine(id, beers.id, { offered: true, confirmRefund: true });
  closeRien(id);
  const cancelled = standaloneSale.cancel(id);
  assert.deepEqual([cancelled.document.totals.refundOwedCents, cancelled.document.refundObligations.map((r) => r.amountCents)], [1400, [1400]]);
  const [open] = sales.obligationsOf(id);
  links.closeObligation(id, open.id, 'settled');
  assert.deepEqual(books(id), { net: {}, tips: 1300 }, 'nothing sold stays on the books; the 13 € kept are the tip');
});

test('B4-2 (C21) — after a « rien » and the beers payable again, a late 14 € link is 1 € above the reste: a 1 € row, nothing hidden on no line', () => {
  const { id, beers } = paidSale();
  standaloneSale.offerLine(id, beers.id, { offered: true, confirmRefund: true });
  closeRien(id);
  standaloneSale.offerLine(id, beers.id, { offered: false });
  const link = Number(db.prepare("INSERT INTO payment_links (reservationId, saleRef, type, amountCents, status) VALUES (NULL, ?, 'complement', 1400, 'paid')").run(sales.documentRef(id)).lastInsertRowid);
  links.settlePaidLink({ link: { id: link, saleRef: sales.documentRef(id), amountCents: 1400 }, paidDate: TODAY });
  const document = standaloneSale.documentOf(id);
  assert.deepEqual([document.totals.remainingCents, document.totals.refundOwedCents, document.refundObligations.map((r) => [r.origin, r.amountCents])],
    [0, 100, [['linkSurplus', 100]]]);
});
