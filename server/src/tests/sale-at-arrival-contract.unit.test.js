// specs/pricing/pricing-components.md §3 rule 103 (stabilisation loop t3, T3-6, 2026-11-16) — the `atArrival` contract (guest-app rule 110 a) is carried
// whole: the quote takes it and announces the arrival bucket the sale writes, and a sale `atArrival` is refused 409 `ARRIVAL_CLOSED` once the arrival
// is validated or its complement collected (before: the line read « arrival » while its money went to the departure). Stays booked 20 days ahead.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');

const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const request = () => [{ articleRef: `option:${beer}`, quantity: 1 }];

test('T3-6 — at the open arrival the quote announces what the `atArrival` sale writes: the arrival bucket', () => {
  const id = stay(20);
  const door = at(id, '18:00');
  const quoted = extraSale.quote(id, request(), { now: door, atArrival: true });
  assert.equal(quoted.status, 200, JSON.stringify(quoted.body));
  assert.deepEqual([quoted.buckets.arrival, quoted.buckets.departure, quoted.lines[0].collectAt], [600, 0, 'arrival']);
  const sold = extraSale.sell(id, request(), { now: door, source: 'shop', atArrival: true, acceptedTotalCents: quoted.totalCents });
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  assert.deepEqual([Math.round(row(id).complementAmount * 100), Math.round(row(id).endOfStayComplementAmount * 100)], [600, 0]);
});

for (const [closed, mark] of [['the arrival validated', 'checkInDone = 1'], ['the arrival complement collected', 'complementPaid = 1']]) {
  test(`T3-6 — ${closed}: an \`atArrival\` quote and sale are refused 409 ARRIVAL_CLOSED`, () => {
    const id = stay(20);
    db.prepare(`UPDATE reservations SET ${mark} WHERE id = ?`).run(id);
    const door = at(id, '18:00');
    const quoted = extraSale.quote(id, request(), { now: door, atArrival: true });
    const sold = extraSale.sell(id, request(), { now: door, source: 'shop', atArrival: true });
    assert.deepEqual([quoted.status, quoted.body.code, sold.status, sold.body.code], [409, 'ARRIVAL_CLOSED', 409, 'ARRIVAL_CLOSED']);
  });
}
