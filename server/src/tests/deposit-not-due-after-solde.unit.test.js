// specs/payment-schedule-and-cancellation.md rule 47 (spec review 2026-10-27) — booked 31 to 36 days
// out, `booking + 7` fell after `arrival − 30`: the acompte was owed after the solde. It is now due no
// later than the solde; a date already stored keeps its promise (rule 4).
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveDepositDueDate } = require('../utils/paymentSchedule');
const f = require('./reservationSaveFixture');

const isoDay = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

test('a fresh acompte deadline is capped at the solde deadline', () => {
  assert.equal(resolveDepositDueDate({ bookingDate: '2026-10-27', depositDueDays: 7, notAfter: '2026-10-29' }), '2026-10-29');
  assert.equal(resolveDepositDueDate({ bookingDate: '2026-10-27', depositDueDays: 7, notAfter: '2026-12-01' }), '2026-11-03');
  assert.equal(resolveDepositDueDate({ bookingDate: '2026-10-27', depositDueDays: 7 }), '2026-11-03');
});

test('a stored acompte deadline is never moved by the cap', () => {
  assert.equal(resolveDepositDueDate({ existingDepositDueDate: '2026-11-03', notAfter: '2026-10-29' }), '2026-11-03');
});

test('a stay booked 32 days ahead owes its acompte no later than its solde', () => {
  const id = f.createStay({ startDate: isoDay(32), endDate: isoDay(35) });
  const row = f.rowOf(id);
  assert.ok(row.depositAmount > 0, 'still a split stay');
  assert.ok(row.depositDueDate <= row.balanceDueDate, `${row.depositDueDate} > ${row.balanceDueDate}`);
});
