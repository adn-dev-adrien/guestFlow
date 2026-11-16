// specs/outside-booking-sas.md rule 56 (b) reading of rule 49 (stabilisation loop t4 B4-3) — the money a row gives back (or keeps) is taken from its own line
// first, then from the excess no other open row names, and only then from what another row holds: a whole document cancelled (`lineRef` NULL) after its
// paid beers were offered gives back the plank, so the books keep (or tip) the beers' money at the beers' rate.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const standaloneSale = require('../utils/standaloneSale');
const links = require('../utils/standaloneSaleLinks');
const sales = require('../models/standaloneSalesModel');
const standaloneSales = require('../utils/standaloneSales');
const { refundRowsOfDocument } = require('../utils/pricing/refunds/owed');
const { todayIso } = require('../utils/localDate');

const option = (title, price, vatClass) => Number(db.prepare("INSERT INTO options (title, price, priceType, sellableExternally, vatClass) VALUES (?, ?, 'per_stay', 1, ?)")
  .run(title, price, vatClass).lastInsertRowid);
const beer = option('Bière ordre B4', 6.5, 'drinks');
const board = option('Planche ordre B4', 14, 'catering');
sales.setExternalRate('drinks', 20);
sales.setExternalRate('catering', 10);
const TODAY = todayIso();

// 27 € by card; the beers offered (a 13 € row on the beers), then the document cancelled (a 14 € row on no line).
function cancelledAfterOffer() {
  const sold = standaloneSale.sell({
    lines: [{ articleRef: `option:${beer}`, quantity: 2 }, { articleRef: `option:${board}`, quantity: 1 }], payment: { tenders: [{ method: 'card', amountCents: 2700 }] },
  }).document;
  const { id } = sold.document;
  standaloneSale.offerLine(id, sold.lines[0].id, { offered: true, confirmRefund: true });
  standaloneSale.cancel(id);
  const [beersRow, cancelRow] = sales.obligationsOf(id);
  assert.deepEqual([beersRow.lineRef, beersRow.amountCents, cancelRow.lineRef, cancelRow.amountCents], [sold.lines[0].ref, 1300, null, 1400]);
  return {
    id, beers: sold.lines[0], plank: sold.lines[1], beersRow, cancelRow,
  };
}
const leaving = (id, kind) => db.prepare(`SELECT lineRef, amountCents FROM payment_allocations WHERE documentRef = ? AND ${kind} ORDER BY id`).all(sales.documentRef(id));
function net(id) {
  const out = {};
  let tips = 0;
  for (const sale of standaloneSales.list({ from: TODAY, to: TODAY }).filter((s) => String(s.key).startsWith(`standalone:${id}:`))) {
    if (sale.role === 'tip') { tips += sale.booksCents; continue; }
    for (const g of sale.groups) {
      out[g.vatClass] = (out[g.vatClass] || 0) + (sale.role === 'refund' ? -1 : 1) * g.ttcCents;
    }
  }
  return { revenue: Object.fromEntries(Object.entries(out).filter(([, v]) => v)), tips };
}

test('B4-3 (C17) — the cancel row refunded first gives back the plank, not the beers its sibling row holds; the beers row then « rien » tips the beers', () => {
  const {
    id, plank, beers, beersRow, cancelRow,
  } = cancelledAfterOffer();
  assert.equal(links.closeObligation(id, cancelRow.id, 'settled').status, 200);
  assert.deepEqual(leaving(id, "kind = 'refund'"), [{ lineRef: plank.ref, amountCents: -1400 }]);
  assert.equal(links.closeObligation(id, beersRow.id, 'cancelled').status, 200);
  assert.deepEqual(leaving(id, "paymentRef LIKE 'standalone-kept:%'"), [{ lineRef: beers.ref, amountCents: -1300 }]);
  assert.deepEqual(net(id), { revenue: {}, tips: 1300 });
});

test('B4-3 (C17b) — the beers row « rien » first, then the cancel row refunded: the same cut', () => {
  const {
    id, plank, beers, beersRow, cancelRow,
  } = cancelledAfterOffer();
  links.closeObligation(id, beersRow.id, 'cancelled');
  links.closeObligation(id, cancelRow.id, 'settled');
  assert.deepEqual(leaving(id, "paymentRef LIKE 'standalone-kept:%'"), [{ lineRef: beers.ref, amountCents: -1300 }]);
  assert.deepEqual(leaving(id, "kind = 'refund'"), [{ lineRef: plank.ref, amountCents: -1400 }]);
  assert.deepEqual(net(id), { revenue: {}, tips: 1300 });
});

test('B4-3 — the cancel row kept « rien » keeps the plank, and the beers row refunded gives back the beers', () => {
  const {
    id, plank, beers, beersRow, cancelRow,
  } = cancelledAfterOffer();
  links.closeObligation(id, cancelRow.id, 'cancelled');
  links.closeObligation(id, beersRow.id, 'settled');
  assert.deepEqual(leaving(id, "paymentRef LIKE 'standalone-kept:%'"), [{ lineRef: plank.ref, amountCents: -1400 }]);
  assert.deepEqual(leaving(id, "kind = 'refund'"), [{ lineRef: beers.ref, amountCents: -1300 }]);
  assert.deepEqual(net(id), { revenue: {}, tips: 1400 });
});

test('refundRowsOfDocument — `reserved`: own line first, then the excess no other row names in sale order, then the rest; nothing reserved reads as before', () => {
  const B = 'line:b';
  const P = 'line:p';
  const lines = [{ ref: B, dueCents: 0, settledCents: 1300 }, { ref: P, dueCents: 0, settledCents: 1400 }];
  const allocations = [{ lineRef: B, amountCents: 1300, books: 1 }, { lineRef: P, amountCents: 1400, books: 1 }];
  const kept = (rows) => rows.filter((row) => row.amountCents > 0);
  assert.deepEqual(kept(refundRowsOfDocument({ lines, allocations, amountCents: 1400, reserved: [{ lineRef: B, amountCents: 1300 }] })), [{ lineRef: P, amountCents: 1400, internal: false }]);
  assert.deepEqual(kept(refundRowsOfDocument({ lines, allocations, amountCents: 1400 })), [{ lineRef: B, amountCents: 1300, internal: false }, { lineRef: P, amountCents: 100, internal: false }]);
  assert.deepEqual(kept(refundRowsOfDocument({ lines, allocations, amountCents: 2000, reserved: [{ lineRef: B, amountCents: 1300 }] })),
    [{ lineRef: P, amountCents: 1400, internal: false }, { lineRef: B, amountCents: 600, internal: false }], 'the named excess is taken last');
  assert.deepEqual(kept(refundRowsOfDocument({
    lines, allocations, amountCents: 1300, lineRef: B, reserved: [{ lineRef: B, amountCents: 1300 }],
  })), [{ lineRef: B, amountCents: 1300, internal: false }], 'a row\'s own line is never reserved from it');
});
