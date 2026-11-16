// specs/pricing-components.md §3 rules 23, 37, 95, 104, 105 (stabilisation loop t5, S5-4 and S5-5, 2026-11-16) — a paid line once offered is still the
// note's: it can be re-billed, never removed nor moved. Before: the offer netted its allocations to 0, so `removeLine` took it off (the note then
// claimed the next line of the article, which read « Payée ») and `changeLine` moved it to the arrival of a validated stay, where un-offering it
// was refused.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stay, row, beer, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const { storedBody } = require('../utils/stayOrderLines');

const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const cents = (v) => Math.round(Number(v || 0) * 100);
const patch = (id, body) => {
  let status = 200;
  const res = { status(s) { status = s; return this; }, json() { return this; } };
  ctrl.updatePayment({ params: { id: String(id) }, body, query: {}, user: { id: 1, role: 'admin' } }, res);
  return status;
};

// A direct stay started, a 45 € basket due in its arrival complement, 30 € of beer paid in cash the day after the arrival, then offered (the
// 30 € come off the basket still due, rule 104).
function offeredPaidBeer() {
  const id = stay(20);
  assert.equal(ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true }).status, 200);
  assert.equal(extraSale.sell(id, [{ articleRef: 'custom', label: 'Panier du terroir', amount: 45 }], { now: at(id, '12:00', -3) }).status, 200);
  assert.equal(patch(id, { balancePaid: true, balancePaidDate: todayIso() }), 200);
  assert.equal(patch(id, { checkInDone: true }), 200);
  const sold = extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 5 }], { now: at(id, '12:00', 1), payment: 'cash' });
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  const { ref } = sold.saleDetail.lines.find((line) => line.articleKey === `option:${beer}`);
  const offered = extraSale.changeLine(id, ref, { offered: true }, { now: at(id, '12:30', 1) });
  assert.equal(offered.status, 200, JSON.stringify(offered.body));
  assert.equal(cents(row(id).complementAmount), 1500);
  return { id, ref };
}

test('S5-4 — an offered paid line is refused removal (409 LINE_PAID); re-sold, the article is a line of its own, unpaid', () => {
  const { id, ref } = offeredPaidBeer();
  const removed = extraSale.removeLine(id, ref, { now: at(id, '13:00', 1) });
  assert.deepEqual([removed.status, removed.body.code], [409, 'LINE_PAID']);
  const resold = extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 1 }], { now: at(id, '14:00', 1) });
  assert.equal(resold.status, 200, JSON.stringify(resold.body));
  const lines = resold.saleDetail.lines.filter((line) => line.articleKey === `option:${beer}`);
  assert.deepEqual(lines.map((line) => line.status).sort(), ['dueAtDeparture', 'offered']);
  assert.equal(cents(row(id).complementAmount), 1500, 'the credit stays where rule 104 put it');
});

test('S5-5 — an offered paid line has no moment and is not moved (409 LINE_PAID); re-billed, it is the note\'s again', () => {
  const { id, ref } = offeredPaidBeer();
  const detail = extraSale.saleDetailOf(id, at(id, '13:00', 1)).lines.find((line) => line.ref === ref);
  assert.deepEqual([detail.moments, detail.movable], [[], false]);
  for (const moment of ['arrival', 'departure']) {
    const moved = extraSale.changeLine(id, ref, { collectAt: moment }, { now: at(id, '13:00', 1) });
    assert.deepEqual([moved.status, moved.body.code], [409, 'LINE_PAID']);
  }
  const rebilled = extraSale.changeLine(id, ref, { offered: false }, { now: at(id, '13:30', 1) });
  assert.equal(rebilled.status, 200, JSON.stringify(rebilled.body));
  assert.equal(cents(row(id).complementAmount), 4500);
  assert.equal(rebilled.saleDetail.lines.find((line) => line.ref === ref).status, 'paid');
});
