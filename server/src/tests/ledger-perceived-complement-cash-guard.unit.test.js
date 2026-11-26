// specs/payments/reservation-payment-ledger.md rule 38 — a complement already perceived is never marked again,
// through its flag OR through its caisse-interne flag (which would re-date it and move it to the internal cash).
// The undo-then-redo path (rules 14, 41) stays open.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, inDays, createStay, rowOf, mark } = require('./ledgerFixture');
const { getTodayIsoDate } = require('../utils/reservationHelpers');

const TODAY = getTodayIsoDate();

function perceivedStay(extra = '') {
  const id = createStay();
  db.prepare(`UPDATE reservations SET complementAmount = 24, complementPaid = 1, complementPaidCash = 0,
              complementPaidDate = ?, endOfStayComplementAmount = 18, endOfStayComplementPaid = 1,
              endOfStayComplementPaidCash = 0, endOfStayComplementPaidDate = ? ${extra} WHERE id = ?`)
    .run(inDays(-3), inDays(-3), id);
  return id;
}

test('rule 38: the caisse-interne flag re-dating a perceived complement is refused 409 ALREADY_PAID, nothing re-dated', () => {
  const id = perceivedStay();
  for (const body of [
    { complementPaidCash: true, complementPaidDate: TODAY },
    { complementPaidCash: 1, complementPaidDate: inDays(-1) },
  ]) {
    const res = mark(id, body);
    assert.deepEqual([res.statusCode, res.body.code], [409, 'ALREADY_PAID'], JSON.stringify(body));
  }
  const row = rowOf(id);
  assert.deepEqual([row.complementPaid, row.complementPaidCash, row.complementPaidDate], [1, 0, inDays(-3)]);
});

test('rule 38: the move to the caisse interne on the day the complement already stores is not a re-dating', () => {
  const id = perceivedStay();
  const res = mark(id, { complementPaidCash: true, complementPaidDate: inDays(-3) });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const row = rowOf(id);
  assert.deepEqual([row.complementPaidCash, row.complementPaidDate], [1, inDays(-3)]);
});

test('rule 38: same for the end-of-stay complement', () => {
  const id = perceivedStay();
  const res = mark(id, { endOfStayComplementPaidCash: true, endOfStayComplementPaidDate: TODAY });
  assert.deepEqual([res.statusCode, res.body.code], [409, 'ALREADY_PAID']);
  const row = rowOf(id);
  assert.deepEqual([row.endOfStayComplementPaidCash, row.endOfStayComplementPaidDate], [0, inDays(-3)]);
});

test('rule 38: a flag turned OFF on a perceived complement is not a mark (the undo of rules 14, 41 goes through)', () => {
  const id = perceivedStay();
  const res = mark(id, { complementPaid: false, complementPaidCash: false });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(rowOf(id).complementPaid, 0);
});

test('rule 38: once undone, the complement can be perceived again through the caisse interne, on the date chosen', () => {
  const id = perceivedStay();
  assert.equal(mark(id, { complementPaid: false, complementPaidCash: false }).statusCode, 200);
  const redo = mark(id, { complementPaidCash: true, complementPaidDate: inDays(-1) });
  assert.equal(redo.statusCode, 200, JSON.stringify(redo.body));
  const row = rowOf(id);
  assert.deepEqual([row.complementPaid, row.complementPaidCash, row.complementPaidDate], [1, 1, inDays(-1)]);
});

for (const cash of [false, 0, 'true', 'false', null]) {
  test(`rule 38: complementPaidCash ${JSON.stringify(cash)} with a new date never re-dates a perceived complement`, () => {
    const id = perceivedStay();
    const res = mark(id, { complementPaidCash: cash, complementPaidDate: inDays(-1) });
    const row = rowOf(id);
    assert.equal(row.complementPaidDate, inDays(-3), `${res.statusCode} ${JSON.stringify(res.body)}`);
    assert.equal(row.complementPaid, 1);
  });
}

test('rule 38: same for the end-of-stay complement sent unticked-cash with a new date', () => {
  const id = perceivedStay();
  mark(id, { endOfStayComplementPaidCash: false, endOfStayComplementPaidDate: inDays(-1) });
  assert.equal(rowOf(id).endOfStayComplementPaidDate, inDays(-3));
});
