// specs/qonto-bank-reconciliation.md rule 34 — the core mark, callable without a request, answers as
// `PATCH /reservations/:id/payment` does: same guards, same writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, USER, addReservation, reset, row } = require('./reconciliationFixture');
const { applyPaymentMark } = require('../../../utils/reservationPaymentMark');

test.beforeEach(() => { reset(); });

test('marks a balance received at the given date, and undoes it', () => {
  const id = addReservation({ balanceAmount: 700, finalPrice: 700 });
  const done = applyPaymentMark({ reservationId: id, body: { balancePaid: true, balancePaidDate: '2026-10-12' }, user: USER });
  assert.equal(done.status, 200);
  assert.equal(row(id).balancePaid, 1);
  assert.equal(row(id).balancePaidDate, '2026-10-12');
  const undone = applyPaymentMark({ reservationId: id, body: { balancePaid: false }, user: USER });
  assert.equal(undone.status, 200);
  assert.equal(row(id).balancePaid, 0);
});

test('keeps every guard: a bucket already received is never marked twice, a future date is refused', () => {
  const id = addReservation({ balanceAmount: 700, finalPrice: 700 });
  assert.equal(applyPaymentMark({ reservationId: id, body: { balancePaid: true, balancePaidDate: '2099-01-01' }, user: USER }).status, 400);
  applyPaymentMark({ reservationId: id, body: { balancePaid: true, balancePaidDate: '2026-10-12' }, user: USER });
  const again = applyPaymentMark({ reservationId: id, body: { balancePaid: true, balancePaidDate: '2026-10-13' }, user: USER });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'ALREADY_PAID');
  assert.equal(row(id).balancePaidDate, '2026-10-12');
});

test('an unknown reservation answers 404', () => {
  assert.equal(applyPaymentMark({ reservationId: 999999, body: { balancePaid: true }, user: USER }).status, 404);
  assert.ok(db);
});
