// specs/outside-booking-sas.md rule 55 (stabilisation loop t3, B3-1, B3-2; completes rules 41, 49, 50, 52, 53) and specs/pricing-components.md rules 72, 74,
// 75 — one money model for a sale document: every cent received sits on a line or on no line (the unallocated money, a link paid above the reste). The
// unallocated money pays the lines still due before anything is owed back, its `linkSurplus` row follows it, and closing the row takes the money off the
// document — « remboursé » as a refund on no line, « rien à rembourser » as a kept allocation (the tip) — so it never pays a line sold later. In every
// scenario the journal nets, per VAT class, exactly what the Qonto invoice of the document states (its paid lines at their frozen rate).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const standaloneSale = require('../utils/standaloneSale');
const links = require('../utils/standaloneSaleLinks');
const sales = require('../models/standaloneSalesModel');
const standaloneSales = require('../utils/standaloneSales');
const { refileDocumentExcess } = require('../utils/pricing/settlement');
const { documentRowsInStep, refundRowsOfDocument } = require('../utils/pricing/refunds/owed');
const { todayIso } = require('../utils/localDate');

const option = (title, price, vatClass) => Number(db.prepare("INSERT INTO options (title, price, priceType, sellableExternally, vatClass) VALUES (?, ?, 'per_stay', 1, ?)")
  .run(title, price, vatClass).lastInsertRowid);
const beer = option('Bière sans ligne', 6.5, 'drinks');
const board = option('Planche sans ligne', 14, 'catering');
sales.setExternalRate('drinks', 20);
sales.setExternalRate('catering', 10);
const TODAY = todayIso();
const RATES = { drinks: 20, catering: 10 };

let linkId = 7000;
const sell = (tenders, { shortfall = { kind: 'due' } } = {}) => standaloneSale.sell({
  lines: [{ articleRef: `option:${beer}`, quantity: 2 }, { articleRef: `option:${board}`, quantity: 1 }],
  payment: { tenders, shortfall },
}).document;
const payLink = (id, amountCents) => links.settlePaidLink({ link: { id: linkId += 1, saleRef: sales.documentRef(id), amountCents }, paidDate: TODAY });
const openRows = (id) => sales.obligationsOf(id).map((row) => [row.origin, row.amountCents]);
const totals = (document) => {
  const t = document.totals;
  return {
    total: t.totalCents, paid: t.paidCents, remaining: t.remainingCents, owed: t.refundOwedCents,
  };
};
const sellBeer = (id) => standaloneSale.sell({ saleId: id, version: standaloneSale.documentOf(id).document.version, lines: [{ articleRef: `option:${beer}`, quantity: 1 }] });
const tips = (id) => standaloneSales.list({ from: TODAY, to: TODAY }).filter((s) => String(s.key).startsWith(`standalone:${id}:`) && s.role === 'tip').map((s) => s.booksCents);

// What the books keep of each class over the document's life: sales less avoirs, TTC and VAT.
function booked(id) {
  const net = {};
  for (const sale of standaloneSales.list({ from: TODAY, to: TODAY }).filter((s) => String(s.key).startsWith(`standalone:${id}:`))) {
    for (const g of sale.groups || []) {
      const sign = sale.role === 'refund' ? -1 : 1;
      net[g.vatClass] = net[g.vatClass] || [0, 0];
      net[g.vatClass][0] += sign * g.ttcCents;
      net[g.vatClass][1] += sign * g.vatCents;
    }
  }
  return Object.fromEntries(Object.entries(net).filter(([, v]) => v[0] || v[1]));
}
// The Qonto invoice's basis (hourly-resources `documentRequestOf`): the paid lines at their frozen rate, the VAT of each class on its TTC.
function invoiced(id) {
  const out = {};
  for (const line of standaloneSale.documentOf(id).lines.filter((l) => l.status === 'paid' && l.totalCents > 0)) {
    out[line.vatClass] = out[line.vatClass] || [0, 0];
    out[line.vatClass][0] += line.totalCents;
  }
  for (const [vatClass, v] of Object.entries(out)) v[1] = Math.round((v[0] * RATES[vatClass]) / (100 + RATES[vatClass]));
  return out;
}

// The p4/p5 start of the review: 2 beers 13 € + a plank 14 €, 13 € by card on the beers, the beers offered (their 13 € pay the plank, reste 1 €), then a
// 14 € link minted earlier is paid late: 1 € on the plank, 13 € on no line.
function lateLink() {
  const sold = sell([{ method: 'card', amountCents: 1300 }]);
  const { id } = sold.document;
  const [beers] = sold.lines;
  standaloneSale.offerLine(id, beers.id, { offered: true, confirmRefund: true });
  const effect = payLink(id, 1400);
  assert.equal(effect.surplusCents, 1300);
  assert.deepEqual(openRows(id), [['linkSurplus', 1300]]);
  return { id, beers };
}

test('B3-1 — a link surplus, then the offered beers made payable again: the surplus pays them, the row closes by itself, the invoice basis is booked', () => {
  const { id, beers } = lateLink();
  const after = standaloneSale.offerLine(id, beers.id, { offered: false });
  assert.deepEqual(totals(after.document), {
    total: 2700, paid: 2700, remaining: 0, owed: 0,
  });
  assert.deepEqual(after.document.lines.map((l) => l.status), ['paid', 'paid'], 'the beers are paid by the money the link brought');
  assert.deepEqual(openRows(id), [], 'nothing to refund');
  assert.deepEqual(db.prepare('SELECT status, settledBy FROM standalone_sale_obligations WHERE saleId = ?').all(id), [{ status: 'cancelled', settledBy: 'system' }]);
  assert.ok(!sales.counterSalesOwing().includes(id), 'the counter no longer lists it « À rembourser »');
  assert.deepEqual(tips(id), [], 'a row the document closed itself is no tip');
  assert.deepEqual(booked(id), invoiced(id));
  assert.deepEqual(booked(id), { catering: [1400, 127], drinks: [1300, 217] });
});

test('B3-1 — a link surplus, then a beer sold on the document: the row holds what is left, « Marquer remboursé » gives that back on no line', () => {
  const { id } = lateLink();
  const sold = sellBeer(id);
  assert.deepEqual(totals(sold.document), {
    total: 2050, paid: 2700, remaining: 0, owed: 650,
  });
  assert.equal(sold.document.lines[2].status, 'paid');
  const [row] = sales.obligationsOf(id);
  assert.equal(row.amountCents, 650);
  const closed = links.closeObligation(id, row.id, 'settled');
  assert.deepEqual(totals(closed.document), {
    total: 2050, paid: 2050, remaining: 0, owed: 0,
  });
  assert.deepEqual(db.prepare("SELECT lineRef, amountCents FROM payment_allocations WHERE documentRef = ? AND kind = 'refund'").all(sales.documentRef(id)),
    [{ lineRef: null, amountCents: -650 }], 'the surplus leaves no line: it never was revenue');
  assert.deepEqual(booked(id), invoiced(id));
  assert.deepEqual(booked(id), { catering: [1400, 127], drinks: [650, 108] });
});

for (const close of ['settled', 'cancelled']) {
  test(`B3-2 — a link surplus closed ${close === 'settled' ? '« remboursé »' : '« rien à rembourser » (tip)'}, then a beer sold: the beer is asked and booked`, () => {
    const { id } = lateLink();
    const [row] = sales.obligationsOf(id);
    const closed = links.closeObligation(id, row.id, close);
    assert.deepEqual(totals(closed.document), {
      total: 1400, paid: 1400, remaining: 0, owed: 0,
    });
    const sold = sellBeer(id);
    assert.deepEqual(totals(sold.document), {
      total: 2050, paid: 1400, remaining: 650, owed: 0,
    }, 'the money given back or kept pays nothing');
    assert.equal(sold.document.document.status, 'due');
    assert.equal(sold.document.lines[2].status, 'due');
    const paid = standaloneSale.pay(id, { tenders: [{ method: 'card', amountCents: 650 }] });
    assert.deepEqual(totals(paid.document), {
      total: 2050, paid: 2050, remaining: 0, owed: 0,
    });
    assert.deepEqual(booked(id), invoiced(id));
    assert.deepEqual(booked(id), { catering: [1400, 127], drinks: [650, 108] });
    assert.deepEqual(tips(id), close === 'cancelled' ? [1300] : [], 'the tip is the whole surplus, no VAT');
  });
}

test('B3-1 + B3-2 — a surplus partly used by a beer sold, the rest kept: the tip is that rest only', () => {
  const { id } = lateLink();
  sellBeer(id);
  const [row] = sales.obligationsOf(id);
  assert.equal(row.amountCents, 650);
  const closed = links.closeObligation(id, row.id, 'cancelled');
  assert.deepEqual(totals(closed.document), {
    total: 2050, paid: 2050, remaining: 0, owed: 0,
  });
  assert.deepEqual(tips(id), [650]);
  assert.deepEqual(booked(id), invoiced(id));
});

test('combination — surplus used by the beers made payable again, the beers offered once more: a lowered row opens on them, refunded as an avoir', () => {
  const { id, beers } = lateLink();
  standaloneSale.offerLine(id, beers.id, { offered: false });
  const ask = standaloneSale.offerLine(id, beers.id, { offered: true });
  assert.equal(ask.status, 409);
  assert.equal(ask.body.refundCents, 1300, 'the dialog names what the confirmation opens');
  standaloneSale.offerLine(id, beers.id, { offered: true, confirmRefund: true });
  assert.deepEqual(openRows(id), [['lineLowered', 1300]]);
  const [row] = sales.obligationsOf(id);
  const closed = links.closeObligation(id, row.id, 'settled');
  assert.deepEqual(totals(closed.document), {
    total: 1400, paid: 1400, remaining: 0, owed: 0,
  });
  assert.deepEqual(booked(id), invoiced(id));
  assert.deepEqual(booked(id), { catering: [1400, 127] });
});

test('combination — partial payments, then a surplus with a lowered row open: each row holds its own bucket, the plan never counts a euro twice', () => {
  // 27 € sold, 20 € in two card payments (beers 13 €, plank 7 €), plank due 7 €; a 7 € link is minted, the beers offered (7 € of theirs pay the plank,
  // 6 € owed on their row), then the link is paid: 7 € on no line.
  const sold = sell([{ method: 'card', amountCents: 1000 }]);
  const { id } = sold.document;
  const [beers] = sold.lines;
  assert.equal(standaloneSale.pay(id, { tenders: [{ method: 'card', amountCents: 1000 }], shortfall: { kind: 'due' } }).status, 200);
  standaloneSale.offerLine(id, beers.id, { offered: true, confirmRefund: true });
  assert.deepEqual(openRows(id), [['lineLowered', 600]]);
  payLink(id, 700);
  assert.deepEqual(openRows(id), [['lineLowered', 600], ['linkSurplus', 700]]);
  // A beer sold: the 7 € on no line pay it first (6,50 €), the beers' row stays whole, the surplus row keeps the 0,50 € left.
  const more = sellBeer(id);
  assert.deepEqual(totals(more.document), {
    total: 2050, paid: 2700, remaining: 0, owed: 650,
  });
  assert.deepEqual(openRows(id), [['lineLowered', 600], ['linkSurplus', 50]]);
  for (const row of sales.obligationsOf(id)) links.closeObligation(id, row.id, 'settled');
  const end = standaloneSale.documentOf(id);
  assert.deepEqual(totals(end), {
    total: 2050, paid: 2050, remaining: 0, owed: 0,
  });
  assert.deepEqual(booked(id), invoiced(id));
  assert.deepEqual(booked(id), { catering: [1400, 127], drinks: [650, 108] });
});

test('combination — a link paid after the document was cancelled: the whole link is on no line, given back off the books', () => {
  const sold = sell([{ method: 'card', amountCents: 1300 }]);
  const { id } = sold.document;
  standaloneSale.cancel(id);
  assert.deepEqual(openRows(id), [['lineLowered', 1300]]);
  payLink(id, 1400);
  assert.deepEqual(openRows(id), [['lineLowered', 1300], ['linkSurplus', 1400]]);
  for (const row of sales.obligationsOf(id)) links.closeObligation(id, row.id, 'settled');
  const end = standaloneSale.documentOf(id);
  assert.deepEqual(totals(end), {
    total: 0, paid: 0, remaining: 0, owed: 0,
  });
  assert.deepEqual(booked(id), {}, 'the beers refunded as an avoir, the link never reached the books');
  assert.ok(standaloneSales.list({ from: TODAY, to: TODAY }).filter((s) => String(s.key).startsWith(`standalone:${id}:`)).every((s) => s.role !== 'refund' || s.groups.length > 0),
    'no empty avoir for money that left no line');
});

test('SETTLEMENT / REFUNDS — the no-line bucket is the first giver, a surplus row holds at most it, its refund leaves no line first', () => {
  const lines = [{ ref: 'a', totalCents: 1300, offered: false }, { ref: 'b', totalCents: 1400, offered: false }];
  const allocations = [
    { lineRef: 'a', amountCents: 1300, books: 1, kind: 'payment' },
    { lineRef: 'b', amountCents: 1400, books: 1, kind: 'payment' },
    { lineRef: null, amountCents: 1300, books: 1, kind: 'payment' },
  ];
  assert.deepEqual(refileDocumentExcess({ lines: [...lines, { ref: 'c', totalCents: 650 }], allocations }),
    [{ lineRef: null, amountCents: -650, books: 1 }, { lineRef: 'c', amountCents: 650, books: 1 }]);
  assert.deepEqual(refileDocumentExcess({ lines, allocations: [...allocations, { lineRef: null, amountCents: -1300, books: 1, kind: 'payment' }] }), [],
    'a kept surplus pays nothing');
  const settled = [{ ref: 'a', dueCents: 1300, settledCents: 1300 }, { ref: 'b', dueCents: 1400, settledCents: 1400 }];
  assert.deepEqual(documentRowsInStep({
    rows: [{ id: 1, lineRef: null, unallocated: true, amountCents: 1300 }], lines: settled, owedCents: 650, unallocatedCents: 650,
  }).amounts, [{ id: 1, amountCents: 650 }]);
  assert.deepEqual(documentRowsInStep({
    rows: [{ id: 1, lineRef: null, unallocated: true, amountCents: 1300 }], lines: settled, owedCents: 0, unallocatedCents: 0,
  }).amounts, [{ id: 1, amountCents: 0 }]);
  assert.deepEqual(refundRowsOfDocument({
    lines: settled, allocations, amountCents: 1300, unallocated: true,
  }), [{ lineRef: null, amountCents: 1300, internal: false }]);
});
