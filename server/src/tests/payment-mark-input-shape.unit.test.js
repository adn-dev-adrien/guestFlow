// specs/reservation-payment-ledger.md rule 66 (audit R20-M1, 2026-11-03) — what `PATCH /reservations/:id/payment`
// stores is what it validated. A paid date is a `YYYY-MM-DD` string, stored as the day it was judged on (never
// the raw text sent with it); a date that rides an unticked mark is never written; a payment flag is
// `true` / `false` / `1` / `0`, anything else refused with nothing written. Covers the four shapes of the audit:
// (a) a suffixed or non-string paid date, (b) the re-date of a note settled in the stay, (c) a return date sent
// with `cautionReturned: false`, (d) string flags. Rules 9, 12 and 14 are the guards these shapes slipped past.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./reservationSaveFixture');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');
const { create: accountingModel } = optionalPlugin(() => require('../plugins/accounting-export/accountingModel'));
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');
const { validateCollectionDate } = require('../utils/arrivalPaymentDate');

const TODAY = todayIso();
const DAY = addDaysToIsoDate(TODAY, -3);

function call(body, id) {
  const res = f.respond();
  f.controller.updatePayment({ user: f.ADMIN, params: { id: String(id) }, query: {}, body }, res);
  return res;
}

test.before(() => f.seed());

/** A stay that ended a week ago, with an arrival and an end-of-stay complement to collect. */
function pastStay() {
  const id = f.createStay();
  f.db.prepare('UPDATE reservations SET startDate = ?, endDate = ?, complementAmount = 50, endOfStayComplementAmount = 30 WHERE id = ?')
    .run(f.inDays(-10), f.inDays(-7), id);
  return id;
}

const MARKS = [
  ['depositPaid', 'depositPaidDate'],
  ['balancePaid', 'balancePaidDate'],
  ['complementPaid', 'complementPaidDate'],
  ['endOfStayComplementPaid', 'endOfStayComplementPaidDate'],
  ['cautionReceived', 'cautionReceivedDate'],
];

test('rule 66 (a): a paid date with a suffix is stored as the day it was judged on, on every mark', () => {
  for (const suffixed of [`${DAY}junk`, `${DAY}T23:59:59Z`, `${DAY} `, `${DAY}<b>x</b>`]) {
    for (const [flag, field] of MARKS) {
      const id = pastStay();
      const res = call({ [flag]: true, [field]: suffixed }, id);
      assert.equal(res.statusCode, 200, `${field} ${JSON.stringify(suffixed)}: ${JSON.stringify(res.body)}`);
      assert.equal(f.rowOf(id)[field], DAY, `${field} ${JSON.stringify(suffixed)}`);
    }
    const id = pastStay();
    assert.equal(call({ cautionReceived: true, cautionReceivedDate: DAY }, id).statusCode, 200);
    const back = call({ cautionReturned: true, cautionReturnedDate: suffixed }, id);
    assert.equal(back.statusCode, 200, JSON.stringify(back.body));
    assert.equal(f.rowOf(id).cautionReturnedDate, DAY);
  }
});

test('rule 66 (a): a paid date that is not a string is refused, and nothing is written', () => {
  for (const shape of [[DAY], { day: DAY }, 20261030, true]) {
    for (const [flag, field] of MARKS) {
      const id = pastStay();
      const res = call({ [flag]: true, [field]: shape }, id);
      assert.equal(res.statusCode, 400, `${field} ${JSON.stringify(shape)}: ${JSON.stringify(res.body)}`);
      assert.deepEqual(res.body, { error: 'Date invalide.', code: 'INVALID_PAYMENT_DATE', field });
      assert.equal(Number(f.rowOf(id)[flag]), 0, field);
      assert.equal(f.rowOf(id)[field], null, field);
    }
  }
  assert.deepEqual(validateCollectionDate([DAY], { today: TODAY }), { ok: false, reason: "Date d'encaissement invalide." });
  assert.deepEqual(validateCollectionDate(DAY, { today: TODAY }), { ok: true, date: DAY });
});

test('rule 66 (a): a complement marked in the caisse interne has its date judged too', () => {
  const id = pastStay();
  const res = call({ complementPaidCash: true, complementPaidDate: addDaysToIsoDate(TODAY, 1) }, id);
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.equal(res.body.field, 'complementPaidDate');
  assert.equal(Number(f.rowOf(id).complementPaid), 0);
  const cash = call({ complementPaidCash: true, complementPaidDate: `${DAY}junk` }, id);
  assert.equal(cash.statusCode, 200, JSON.stringify(cash.body));
  assert.equal(f.rowOf(id).complementPaidDate, DAY);
});

test('rule 66 (a) + rule 13 of reservations-backend-mvc: a mark sent back with its stored day keeps the stored value', () => {
  const id = pastStay();
  assert.equal(call({ complementPaid: true, complementPaidDate: DAY }, id).statusCode, 200);
  const res = call({ complementPaidCash: true, complementPaidDate: `${DAY}T10:00:00Z` }, id);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(f.rowOf(id).complementPaidDate, DAY);
  assert.equal(Number(f.rowOf(id).complementPaidCash), 1);
});

test('rule 66: a date riding an unticked complement never re-dates the stored one', () => {
  const id = pastStay();
  assert.equal(call({ complementPaid: true, complementPaidDate: DAY }, id).statusCode, 200);
  const res = call({ complementPaidCash: false, complementPaidDate: `${f.inDays(-2000)}` }, id);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(Number(f.rowOf(id).complementPaid), 1);
  assert.equal(f.rowOf(id).complementPaidDate, DAY);
});

test('rule 66 (b): re-dating a settled note stores the judged day; a non-string date is refused and the books keep the note', { skip: skipWithout(['accounting-export']) }, () => {
  const id = pastStay();
  const notes = [{ id: 1, paidDate: TODAY, total: 40, paidCash: 0, items: [{ key: 'x', label: 'Bois', amount: 40, ttc: 40 }] }];
  f.db.prepare('UPDATE reservations SET midStaySettledNotes = ? WHERE id = ?').run(JSON.stringify(notes), id);
  const month = Number(TODAY.slice(5, 7));
  const year = Number(TODAY.slice(0, 4));
  const noteEntries = () => accountingModel(f.db).encaissementsByMonth({ month, year })
    .filter((e) => Number(e.reservationId || e.id) === id && e.kind === 'midStayComplement');
  assert.equal(noteEntries().length, 1);

  for (const shape of [[TODAY], { day: TODAY }, 20261101]) {
    const res = call({ adjustMidStayNote: { id: 1, paidDate: shape } }, id);
    assert.equal(res.statusCode, 400, `${JSON.stringify(shape)}: ${JSON.stringify(res.body)}`);
    assert.deepEqual(res.body, { error: 'Date invalide.', code: 'INVALID_PAYMENT_DATE', field: 'paidDate' });
    assert.equal(JSON.parse(f.rowOf(id).midStaySettledNotes)[0].paidDate, TODAY);
    assert.equal(noteEntries().length, 1, 'the note stays in the journal');
  }

  const res = call({ adjustMidStayNote: { id: 1, paidDate: `${TODAY}T08:00:00Z` } }, id);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(JSON.parse(f.rowOf(id).midStaySettledNotes)[0].paidDate, TODAY);
  assert.equal(noteEntries().length, 1);
});

test('rule 66 (c): a return date sent with an unticked return is never written (rule 14)', () => {
  const id = pastStay();
  const res = call({ cautionReturned: false, cautionReturnedDate: '1900-01-01' }, id);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const row = f.rowOf(id);
  assert.equal(Number(row.cautionReturned), 0);
  assert.equal(row.cautionReturnedDate, null);

  assert.equal(call({ cautionReceived: true, cautionReceivedDate: DAY }, id).statusCode, 200);
  assert.equal(call({ cautionReturned: true, cautionReturnedDate: DAY }, id).statusCode, 200);
  const undo = call({ cautionReturned: false, cautionReturnedDate: DAY }, id);
  assert.equal(undo.statusCode, 200, JSON.stringify(undo.body));
  assert.equal(Number(f.rowOf(id).cautionReturned), 0);
  assert.equal(f.rowOf(id).cautionReturnedDate, null);
});

const FLAGS = [
  'depositPaid', 'balancePaid', 'complementPaid', 'endOfStayComplementPaid',
  'complementPaidCash', 'endOfStayComplementPaidCash', 'cautionReceived', 'cautionReturned',
];

test('rule 66 (d): a payment flag that is not true / false / 1 / 0 is refused, and nothing is written', () => {
  for (const shape of ['false', '0', 'true', '1', 'non', null, 2, [], {}]) {
    for (const flag of FLAGS) {
      const id = pastStay();
      const before = f.rowOf(id);
      const res = call({ [flag]: shape }, id);
      assert.equal(res.statusCode, 400, `${flag} ${JSON.stringify(shape)}: ${JSON.stringify(res.body)}`);
      assert.deepEqual(res.body, { error: 'Valeur invalide.', code: 'INVALID_PAYMENT_FLAG', field: flag });
      assert.deepEqual(f.rowOf(id), before, `${flag} ${JSON.stringify(shape)}`);
    }
  }
});

test('rule 66 (d): the cash mode of a note settled in the stay obeys the same shape', () => {
  const id = pastStay();
  const notes = [{ id: 1, paidDate: DAY, total: 40, paidCash: 0, items: [] }];
  f.db.prepare('UPDATE reservations SET midStaySettledNotes = ? WHERE id = ?').run(JSON.stringify(notes), id);
  const adjust = call({ adjustMidStayNote: { id: 1, cash: 'false' } }, id);
  assert.equal(adjust.statusCode, 400, JSON.stringify(adjust.body));
  assert.deepEqual(adjust.body, { error: 'Valeur invalide.', code: 'INVALID_PAYMENT_FLAG', field: 'cash' });
  assert.equal(Number(JSON.parse(f.rowOf(id).midStaySettledNotes)[0].paidCash), 0);
  const settle = call({ settleMidStayNote: { checkedKeys: [], opening: [], cash: 'true' } }, id);
  assert.equal(settle.statusCode, 400, JSON.stringify(settle.body));
  assert.equal(settle.body.code, 'INVALID_PAYMENT_FLAG');
});

test('rule 66 (d): true / false / 1 / 0 are the accepted shapes', () => {
  const id = pastStay();
  assert.equal(call({ depositPaid: 1, depositPaidDate: DAY }, id).statusCode, 200);
  assert.equal(Number(f.rowOf(id).depositPaid), 1);
  assert.equal(call({ depositPaid: 0 }, id).statusCode, 200);
  assert.equal(Number(f.rowOf(id).depositPaid), 0);
  assert.equal(call({ depositPaid: true }, id).statusCode, 200);
  assert.equal(f.rowOf(id).depositPaidDate, TODAY);
  assert.equal(call({ depositPaid: false }, id).statusCode, 200);
  assert.equal(f.rowOf(id).depositPaidDate, null);
  assert.equal(call({ complementPaidCash: 1, complementPaidDate: DAY }, id).statusCode, 200);
  assert.equal(Number(f.rowOf(id).complementPaidCash), 1);
  assert.equal(call({ complementPaid: 0, complementPaidCash: 0 }, id).statusCode, 200);
  assert.equal(Number(f.rowOf(id).complementPaid), 0);
});

test('rule 66 (d): the check-in, check-out and deferral marks are held to the same shapes', () => {
  const STATUS_FLAGS = ['checkInReady', 'checkInDone', 'checkOutDone', 'complementDeferredToCheckout'];
  for (const shape of ['false', 'true', 'x', 2, null, {}, []]) {
    for (const flag of STATUS_FLAGS) {
      const id = pastStay();
      const before = f.rowOf(id);
      const res = call({ [flag]: shape }, id);
      assert.equal(res.statusCode, 400, `${flag} ${JSON.stringify(shape)}: ${JSON.stringify(res.body)}`);
      assert.deepEqual(res.body, { error: 'Valeur invalide.', code: 'INVALID_PAYMENT_FLAG', field: flag });
      assert.deepEqual(f.rowOf(id), before, `${flag} ${JSON.stringify(shape)}`);
    }
  }
  for (const flag of ['checkInReady', 'checkInDone', 'checkOutDone']) {
    const id = pastStay();
    for (const [sent, stored] of [[true, 1], [false, 0], [1, 1], [0, 0]]) {
      const res = call({ [flag]: sent }, id);
      assert.equal(res.statusCode, 200, `${flag} ${sent}: ${JSON.stringify(res.body)}`);
      assert.equal(Number(f.rowOf(id)[flag]), stored, `${flag} ${sent}`);
    }
  }
});

test('rule 66 (d): a reception session gets the same refusal, and its toggles still work', () => {
  const reception = { id: 2, roles: ['reception'] };
  const id = f.createStay();
  f.db.prepare('UPDATE reservations SET startDate = ?, endDate = ? WHERE id = ?').run(TODAY, f.inDays(2), id);
  const patch = (body) => {
    const res = f.respond();
    f.controller.updatePayment({ user: reception, params: { id: String(id) }, query: {}, body }, res);
    return res;
  };
  const refused = patch({ checkInDone: 'false' });
  assert.equal(refused.statusCode, 400, JSON.stringify(refused.body));
  assert.equal(refused.body.code, 'INVALID_PAYMENT_FLAG');
  assert.equal(Number(f.rowOf(id).checkInDone || 0), 0);
  assert.equal(patch({ checkInDone: true }).statusCode, 200);
  assert.equal(Number(f.rowOf(id).checkInDone), 1);
  // A money flag forged beside it is still dropped before the shape is judged.
  assert.equal(patch({ checkInDone: false, depositPaid: 'x' }).statusCode, 200);
  assert.equal(Number(f.rowOf(id).depositPaid || 0), 0);
});
