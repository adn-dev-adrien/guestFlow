// Payment-deadline alert rows (specs/payment-schedule-and-cancellation.md §3.4): which reservations
// surface, in which state, with which actions.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPaymentDeadlineRow, buildPaymentDeadlineRows } = require('../utils/paymentDeadlines');

const TODAY = '2026-08-19';

// A direct booking, arriving in a month, acompte paid, solde due 10 days ago.
function row(overrides = {}) {
  return {
    id: 1,
    reservationNumber: '2026-09-004',
    platform: 'direct',
    startDate: '2026-09-18',
    endDate: '2026-09-25',
    depositAmount: 274,
    depositPaid: 1,
    depositDueDate: '2026-05-10',
    balanceAmount: 640,
    balancePaid: 0,
    balanceDueDate: '2026-08-09',
    paymentAlertSnoozedUntil: null,
    cancelAfterBalanceDueDays: 7,
    firstName: 'Marie',
    lastName: 'Dupont',
    email: 'marie@example.com',
    propertyName: 'Le Lodge',
    ...overrides,
  };
}

test('a solde late past the cancellation deadline proposes the cancellation', () => {
  const out = buildPaymentDeadlineRow(row(), TODAY);
  assert.equal(out.state, 'cancel_due');
  assert.equal(out.severity, 'error');
  assert.equal(out.cancelOn, '2026-08-16');
  assert.equal(out.daysLate, 10);
  assert.equal(out.canCancel, true);
  assert.equal(out.balanceDue, 640);
  assert.equal(out.depositDue, 0, 'a paid acompte is not owed');
  assert.equal(out.retainedDepositAmount, 274, 'what cancelling now would keep');
  assert.equal(out.remindType, 'balance');
});

test('a solde late but before the deadline is a warning, with no cancel action', () => {
  const out = buildPaymentDeadlineRow(row({ balanceDueDate: '2026-08-17' }), TODAY);
  assert.equal(out.state, 'balance_overdue');
  assert.equal(out.severity, 'warning');
  assert.equal(out.canCancel, false);
  assert.equal(out.daysLate, 2);
});

test('a late acompte surfaces on its own', () => {
  const out = buildPaymentDeadlineRow(
    row({ depositPaid: 0, depositDueDate: '2026-08-15', balanceAmount: 640, balanceDueDate: '2026-09-01' }),
    TODAY,
  );
  assert.equal(out.state, 'deposit_overdue');
  assert.equal(out.depositDue, 274);
  assert.equal(out.dueDate, '2026-08-15');
  assert.equal(out.daysLate, 4);
  assert.equal(out.retainedDepositAmount, 0, 'an unpaid acompte keeps nothing (rule 27)');
  assert.equal(out.remindType, 'balance', 'the solde is still unpaid too — chase the bigger one');
});

test('late on both échéances yields ONE row, in the more severe state (rule 16)', () => {
  const rows = buildPaymentDeadlineRows(
    [row({ depositPaid: 0, depositDueDate: '2026-06-01' })],
    TODAY,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, 'cancel_due');
  assert.equal(rows[0].depositDue, 274);
  assert.equal(rows[0].balanceDue, 640);
  assert.equal(rows[0].totalDue, 914);
});

test('from the arrival day on, the row warns but never offers to cancel (rule 13)', () => {
  const out = buildPaymentDeadlineRow(row({ startDate: TODAY }), TODAY);
  assert.equal(out.state, 'unpaid_at_arrival');
  assert.equal(out.severity, 'error');
  assert.equal(out.canCancel, false);
});

test('platform bookings never surface (rule 1)', () => {
  assert.equal(buildPaymentDeadlineRow(row({ platform: 'Airbnb' }), TODAY), null);
  assert.equal(buildPaymentDeadlineRow(row({ platform: 'Booking.com' }), TODAY), null);
  // The booking engine on our own site is a direct channel.
  assert.ok(buildPaymentDeadlineRow(row({ platform: 'Lodgify' }), TODAY));
});

test('nothing outstanding → no row', () => {
  assert.equal(buildPaymentDeadlineRow(row({ balancePaid: 1 }), TODAY), null);
  assert.equal(buildPaymentDeadlineRow(row({ balanceAmount: 0 }), TODAY), null);
  // Due but not late yet.
  assert.equal(buildPaymentDeadlineRow(row({ balanceDueDate: '2026-08-25' }), TODAY), null);
});

test('a snoozed row is hidden until its date, then comes back (rule 18)', () => {
  assert.equal(buildPaymentDeadlineRow(row({ paymentAlertSnoozedUntil: '2026-08-26' }), TODAY), null);
  assert.equal(buildPaymentDeadlineRow(row({ paymentAlertSnoozedUntil: TODAY }), TODAY), null, 'still hidden on the day itself');
  const back = buildPaymentDeadlineRow(row({ paymentAlertSnoozedUntil: '2026-08-18' }), TODAY);
  assert.equal(back.state, 'cancel_due');
  assert.equal(back.cancelOn, '2026-08-16', 'the deadline itself never moved');
});

test('a client without an email cannot be reminded from the card', () => {
  assert.equal(buildPaymentDeadlineRow(row({ email: '' }), TODAY).canRemind, false);
});

test('rows are ordered by severity, then by how late they are', () => {
  const rows = buildPaymentDeadlineRows([
    row({ id: 1, depositPaid: 0, depositDueDate: '2026-08-18', balanceAmount: 0, balanceDueDate: null }),
    row({ id: 2 }),                                              // cancel_due, 10 days late
    row({ id: 3, startDate: '2026-08-01', endDate: '2026-08-30' }), // unpaid_at_arrival
    row({ id: 4, balanceDueDate: '2026-08-14' }),                // cancel_due, 5 days late
  ], TODAY);
  assert.deepEqual(rows.map((r) => r.reservationId), [3, 2, 4, 1]);
});
