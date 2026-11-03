// specs/reservation-payment-ledger.md rule 12, reading of 2026-11-03 (review of PR #939, out of scope) — a
// return is never dated before the receipt, also when one PATCH ticks both and sends no receipt date. The
// receipt is then stamped today, and the return used to keep any earlier date it carried (received today,
// returned three days ago) because the check read the absent date as ''. API-only: the fiche sends one mark
// at a time.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./reservationSaveFixture');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const TODAY = todayIso();

function call(body, id) {
  const res = f.respond();
  f.controller.updatePayment({ user: f.ADMIN, params: { id: String(id) }, query: {}, body }, res);
  return res;
}

test.before(() => f.seed());

function pastStay() {
  const id = f.createStay();
  f.db.prepare('UPDATE reservations SET startDate = ?, endDate = ? WHERE id = ?').run(f.inDays(-10), f.inDays(-7), id);
  return id;
}

const caution = (id) => {
  const r = f.rowOf(id);
  return { received: Number(r.cautionReceived), receivedOn: r.cautionReceivedDate, returned: Number(r.cautionReturned), returnedOn: r.cautionReturnedDate };
};

test('rule 12: received and returned in one PATCH with no receipt date — a return before today is refused, nothing written', () => {
  for (const back of [-1, -3]) {
    const id = pastStay();
    const res = call({ cautionReceived: true, cautionReturned: true, cautionReturnedDate: addDaysToIsoDate(TODAY, back) }, id);
    assert.equal(res.statusCode, 400, JSON.stringify(res.body));
    const [, m, d] = TODAY.split('-');
    assert.deepEqual(res.body, { error: `Restitution avant la réception (${d}/${m}).`, code: 'INVALID_PAYMENT_DATE', field: 'cautionReturnedDate' });
    assert.deepEqual(caution(id), { received: 0, receivedOn: null, returned: 0, returnedOn: null });
    for (const empty of ['', null]) {
      const again = call({ cautionReceived: true, cautionReceivedDate: empty, cautionReturned: true, cautionReturnedDate: addDaysToIsoDate(TODAY, back) }, id);
      assert.equal(again.statusCode, 400, `${JSON.stringify(empty)}: ${JSON.stringify(again.body)}`);
    }
  }
});

test('rule 12: received and returned in one PATCH on the same day, or with no dates at all, are both stamped today', () => {
  for (const body of [{ cautionReturnedDate: TODAY }, {}]) {
    const id = pastStay();
    const res = call({ cautionReceived: true, cautionReturned: true, ...body }, id);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.deepEqual(caution(id), { received: 1, receivedOn: TODAY, returned: 1, returnedOn: TODAY });
  }
});

test('rule 12: a dated receipt in the same PATCH is still judged on its own date, and a stored receipt on the stored one', () => {
  const early = addDaysToIsoDate(TODAY, -5);
  const id = pastStay();
  const res = call({ cautionReceived: true, cautionReceivedDate: early, cautionReturned: true, cautionReturnedDate: addDaysToIsoDate(TODAY, -2) }, id);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(caution(id), { received: 1, receivedOn: early, returned: 1, returnedOn: addDaysToIsoDate(TODAY, -2) });

  const stored = pastStay();
  assert.equal(call({ cautionReceived: true, cautionReceivedDate: early }, stored).statusCode, 200);
  assert.equal(call({ cautionReturned: true, cautionReturnedDate: addDaysToIsoDate(TODAY, -6) }, stored).statusCode, 400);
  assert.equal(call({ cautionReturned: true, cautionReturnedDate: addDaysToIsoDate(TODAY, -4) }, stored).statusCode, 200);
});
