// specs/outside-booking-sas.md rules 49, 52, 53 (stabilisation loop t2, B2-1, B2-2, B2-3) and specs/pricing-components.md rules 62, 74, 75 — a document's
// `lineLowered` row names the line it was opened for and gives the money back from that line; the open rows follow what the document owes after every
// change; money a lowered line holds while another line still asks is filed on that line, dated the day of the change, so the journal books what the
// money pays and never rewrites an earlier day.
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
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const option = (title, price, vatClass) => Number(db.prepare("INSERT INTO options (title, price, priceType, sellableExternally, vatClass) VALUES (?, ?, 'per_stay', 1, ?)")
  .run(title, price, vatClass).lastInsertRowid);
const beer = option('Bière en phase', 6.5, 'drinks');
const board = option('Planche en phase', 14, 'catering');
sales.setExternalRate('drinks', 20);
sales.setExternalRate('catering', 10);
const TODAY = todayIso();
const EARLIER = addDaysToIsoDate(TODAY, -3);

const sell = (tenders, { shortfall, paidAt } = {}) => standaloneSale.sell({
  lines: [{ articleRef: `option:${beer}`, quantity: 2 }, { articleRef: `option:${board}`, quantity: 1 }],
  payment: { tenders, ...(shortfall ? { shortfall } : {}), ...(paidAt ? { paidAt } : {}) },
}).document;
const allRows = (id) => db.prepare('SELECT id, lineRef, amountCents, status, settledBy FROM standalone_sale_obligations WHERE saleId = ? ORDER BY id').all(id);
const journal = (id, from = TODAY, to = TODAY) => standaloneSales.list({ from, to }).filter((sale) => String(sale.key).startsWith(`standalone:${id}:`))
  .map((sale) => [sale.date === TODAY ? 'today' : sale.date, sale.role || 'sale', sale.totalCents, sale.groups.map((g) => `${g.vatClass} ${g.ttcCents}/${g.vatCents}`).join(', ')]);
// What the books keep of a class over the document's life: sales less avoirs.
function kept(id, from, to) {
  const net = {};
  for (const sale of standaloneSales.list({ from, to }).filter((s) => String(s.key).startsWith(`standalone:${id}:`))) {
    for (const g of sale.groups) {
      const sign = sale.role === 'refund' ? -1 : 1;
      net[g.vatClass] = net[g.vatClass] || [0, 0];
      net[g.vatClass][0] += sign * g.ttcCents;
      net[g.vatClass][1] += sign * g.vatCents;
    }
  }
  return Object.fromEntries(Object.entries(net).filter(([, v]) => v[0] || v[1]));
}

test('B2-1 — two rows settled out of order: the plank row refunds the plank, the beers row closed « rien à rembourser » keeps the beers', () => {
  const sold = sell([{ method: 'card', amountCents: 2700 }]);
  const { id } = sold.document;
  const [beers, plank] = sold.lines;
  standaloneSale.offerLine(id, beers.id, { offered: true, confirmRefund: true });
  standaloneSale.offerLine(id, plank.id, { offered: true, confirmRefund: true });
  const [beersRow, plankRow] = sales.obligationsOf(id);
  assert.deepEqual([beersRow.lineRef, beersRow.amountCents, plankRow.lineRef, plankRow.amountCents], [beers.ref, 1300, plank.ref, 1400]);
  assert.equal(links.closeObligation(id, plankRow.id, 'settled').status, 200);
  assert.deepEqual(db.prepare("SELECT lineRef, amountCents FROM payment_allocations WHERE documentRef = ? AND kind = 'refund'").all(sales.documentRef(id)),
    [{ lineRef: plank.ref, amountCents: -1400 }]);
  assert.equal(links.closeObligation(id, beersRow.id, 'cancelled').status, 200);
  assert.deepEqual(kept(id, TODAY, TODAY), { drinks: [1300, 217] }, 'the beers kept, at 20 %');
});

test('B2-2 — offered then payable again: the row is no longer owed, the counter and the invoice stop waiting for it', () => {
  const sold = sell([{ method: 'card', amountCents: 2700 }]);
  const { id } = sold.document;
  standaloneSale.offerLine(id, sold.lines[0].id, { offered: true, confirmRefund: true });
  assert.equal(sales.obligationsOf(id).length, 1);
  const back = standaloneSale.offerLine(id, sold.lines[0].id, { offered: false });
  assert.equal(back.status, 200);
  assert.deepEqual(back.document.refundObligations, []);
  assert.equal(back.document.totals.refundOwedCents, 0);
  assert.ok(!sales.counterSalesOwing().includes(id));
  assert.deepEqual(allRows(id).map((row) => [row.status, row.settledBy]), [['cancelled', 'system']]);
  // Offered again: owed again, in full — the row cancelled by the system is not money kept.
  const again = standaloneSale.offerLine(id, sold.lines[0].id, { offered: true, confirmRefund: true, version: back.document.document.version });
  assert.deepEqual(again.document.refundObligations.map((row) => row.amountCents), [1300]);
});

test('B2-2, B2-3 — offered, then a plank more sold: the beers\' money pays the new plank, the row shrinks to nothing, 1 € is due', () => {
  const sold = sell([{ method: 'card', amountCents: 2700 }]);
  const { id } = sold.document;
  const offered = standaloneSale.offerLine(id, sold.lines[0].id, { offered: true, confirmRefund: true });
  const more = standaloneSale.sell({ saleId: id, version: offered.document.document.version, lines: [{ articleRef: `option:${board}`, quantity: 1 }] });
  assert.equal(more.status, 200);
  assert.deepEqual(more.document.refundObligations, []);
  assert.equal(more.document.totals.remainingCents, 100);
  assert.deepEqual(kept(id, TODAY, TODAY), { catering: [2700, 245] }, 'the 27 € pay two planks; no beer revenue is left');
});

test('B2-3 — a partly paid document, the paid beers offered, the rest paid: the journal books the plank only, at 10 %', () => {
  const sold = sell([{ method: 'card', amountCents: 1300 }], { shortfall: { kind: 'due' } });
  const { id } = sold.document;
  const offered = standaloneSale.offerLine(id, sold.lines[0].id, { offered: true, confirmRefund: true });
  assert.equal(offered.document.totals.remainingCents, 100);
  assert.deepEqual(offered.document.refundObligations, [], 'nothing owed back: the money pays the plank');
  standaloneSale.pay(id, { tenders: [{ method: 'card', amountCents: 100 }] });
  assert.deepEqual(kept(id, TODAY, TODAY), { catering: [1400, 127] });
});

test('B2-3 — the transfer is dated the day of the change: the day the money came in keeps what it booked', () => {
  const sold = sell([{ method: 'card', amountCents: 1300 }], { shortfall: { kind: 'due' }, paidAt: EARLIER });
  const { id } = sold.document;
  const before = journal(id, EARLIER, EARLIER);
  assert.deepEqual(before, [[EARLIER, 'sale', 1300, 'drinks 1300/217']]);
  standaloneSale.offerLine(id, sold.lines[0].id, { offered: true, confirmRefund: true });
  assert.deepEqual(journal(id, EARLIER, EARLIER), before, 'the earlier day is not rewritten');
  assert.deepEqual(journal(id), [['today', 'sale', 0, 'catering 1300/118'], ['today', 'refund', 0, 'drinks 1300/217']], 'no money moves today');
  assert.deepEqual(kept(id, EARLIER, TODAY), { catering: [1300, 118] });
});

test('B2-3 — a caisse-interne part moves off the books: the transfer keeps each part where it was', () => {
  const sold = sell([{ method: 'card', amountCents: 800 }, { method: 'cash', amountCents: 500, internal: true }], { shortfall: { kind: 'due' } });
  const { id } = sold.document;
  standaloneSale.offerLine(id, sold.lines[0].id, { offered: true, confirmRefund: true });
  standaloneSale.pay(id, { tenders: [{ method: 'card', amountCents: 100 }] });
  assert.deepEqual(kept(id, TODAY, TODAY), { catering: [900, 82] }, 'the 8 € card and the 1 € rest on the books, the 5 € caisse interne off them');
});
