// specs/pricing-components.md §3 rule 103 (stabilisation loop t3, T3-1 b, 2026-11-16) — the check-in box ticked before the check-in hour starts the
// stay (rule 102 a); unticked through the payments PATCH before that hour, the false start is undone: the lines it carved out to the departure come
// back to the arrival with their money, the baseline goes, and the next sale, the move and the SAS read « before the arrival ». Unticked once the hour
// has passed (or once something was collected) the start stands. Stays booked 20 days ahead (`saleRound1Fixtures`, check-in 15:00).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stay, row, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const reservations = require('../models/reservationsModel');
const controller = require('../controllers/reservationsController');
const { withNow } = require('../utils/localDate');

const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const money = (id) => [Math.round(row(id).complementAmount * 100), Math.round(row(id).endOfStayComplementAmount * 100)];
const patch = (id, body, now) => withNow(now, () => {
  let status = 200;
  let json = null;
  const res = { status(code) { status = code; return this; }, json(payload) { json = payload; return this; } };
  controller.updatePayment({ params: { id: String(id) }, body, query: {}, user: { id: 1, role: 'admin' } }, res);
  return [status, json];
});

function tickedSale(id) {
  assert.equal(patch(id, { checkInDone: true }, at(id, '10:00'))[0], 200);
  const sold = extraSale.sell(id, [{ articleRef: 'custom', label: 'Panier du terroir', amount: 45 }], { now: at(id, '10:00') });
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  assert.deepEqual(money(id), [0, 4500], 'the ticked arrival carved the sale out to the departure');
  assert.notEqual(row(id).arrivalExtrasBaseline, null);
  return sold.saleDetail.lines.find((l) => l.label === 'Panier du terroir').ref;
}

test('T3-1 b — unticked before the hour: the false start is undone, the line and its money back at the arrival', () => {
  const id = stay(20);
  const ref = tickedSale(id);
  const now = at(id, '11:00');
  assert.equal(patch(id, { checkInDone: false }, now)[0], 200);
  assert.deepEqual([row(id).checkInDone, row(id).arrivalExtrasBaseline], [0, null]);
  assert.deepEqual(money(id), [4500, 0]);
  assert.equal(extraSale.collectionOf(id, now), 'arrival');
  const line = extraSale.saleDetailOf(id, now).lines.find((l) => l.ref === ref);
  assert.deepEqual([line.collectAt, line.moments], ['arrival', ['arrival']]);
  const next = extraSale.sell(id, [{ articleRef: 'custom', label: 'Cidre', amount: 65 }], { now });
  assert.equal(next.status, 200, JSON.stringify(next.body));
  assert.deepEqual(money(id), [11000, 0]);
  const plan = withNow(now, () => reservations.planArrivalSas(id, {}));
  assert.deepEqual([plan.arrivalComplementTotal, plan.lines.map((l) => l.label)], [110, ['Panier du terroir', 'Cidre']]);
});

test('T3-1 b — unticked after the check-in hour: the stay has started by the clock, nothing moves', () => {
  const id = stay(20);
  tickedSale(id);
  const now = at(id, '18:00');
  assert.equal(patch(id, { checkInDone: false }, now)[0], 200);
  assert.equal(row(id).checkInDone, 0);
  assert.notEqual(row(id).arrivalExtrasBaseline, null);
  assert.deepEqual(money(id), [0, 4500]);
  assert.equal(extraSale.collectionOf(id, now), 'departure');
});

test('T3-1 b — unticked before the hour once the arrival complement is collected: the baseline stays, and the sale reads it (departure everywhere)', () => {
  const id = stay(20);
  tickedSale(id);
  const now = at(id, '11:00');
  withNow(now, () => require('../database').prepare('UPDATE reservations SET complementPaid = 1 WHERE id = ?').run(id));
  assert.equal(patch(id, { checkInDone: false }, now)[0], 200);
  assert.notEqual(row(id).arrivalExtrasBaseline, null);
  assert.deepEqual(money(id), [0, 4500]);
  assert.equal(extraSale.collectionOf(id, now), 'departure');
});
