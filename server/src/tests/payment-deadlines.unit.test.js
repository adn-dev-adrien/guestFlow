// Payment-deadline alert rows (specs/payment-schedule-and-cancellation.md §3.4): which reservations
// surface, in which state, with which actions.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPaymentDeadlineRow, buildPaymentDeadlineRows } = require('../utils/paymentDeadlines');

const TODAY = '2026-08-19';

// A direct booking, arriving in a month, acompte paid, solde due 10 days ago. Both requests have
// already left: since the 2026-08-20 amendment a row whose money was never claimed is a `*_to_request`
// to-do, not a late payment, so a fixture about LATENESS has to say the guest was asked.
function row(overrides = {}) {
  return {
    id: 1,
    depositRequestSent: 1,
    balanceRequestSent: 1,
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
  assert.equal(
    out.remindType, 'deposit',
    'the button must ask for what the row is about: this said « Acompte en retard » and sent a SOLDE request',
  );
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

// specs/platform-payout-due-date.md — a platform booking that ended, whose payout deadline
// (departure + payoutDueDays) has passed with the solde still unpaid.
function platformRow(overrides = {}) {
  return row({
    platform: 'Airbnb',
    startDate: '2026-07-15',
    endDate: '2026-07-22',
    depositAmount: 0,
    depositPaid: 0,
    depositDueDate: null,
    finalPrice: 640,
    payoutDueDays: 10,
    balanceDueDate: '2026-08-01', // the stored cache; the row derives departure + payoutDueDays
    ...overrides,
  });
}

test('platform bookings never surface in a GUEST-facing state (rule 15)', () => {
  // A platform booking still in the future can never be « arrivée non réglée » nor « à annuler »:
  // its solde is the platform's payout, and it is not late until the guest has left.
  for (const state of [{}, { startDate: '2026-08-01' }, { startDate: TODAY }]) {
    const out = buildPaymentDeadlineRow(row({ platform: 'Airbnb', ...state }), TODAY);
    assert.equal(out, null);
  }
  // The booking engine on our own site is a direct channel — unchanged behaviour (rule 2).
  const lodgify = buildPaymentDeadlineRow(row({ platform: 'Lodgify' }), TODAY);
  assert.equal(lodgify.state, 'cancel_due');
  assert.equal(lodgify.platformLabel, null);
});

test('a late platform payout gets its own state, with no dunning and no cancellation', () => {
  const out = buildPaymentDeadlineRow(platformRow(), TODAY);
  assert.equal(out.state, 'platform_payout_overdue');
  assert.equal(out.severity, 'warning');
  assert.equal(out.platformLabel, 'Airbnb');
  assert.equal(out.daysLate, 18);
  assert.equal(out.dueDate, '2026-08-01');
  assert.equal(out.balanceDue, 640);
  assert.equal(out.totalDue, 640);
  assert.equal(out.depositDue, 0, 'the acompte never drives a platform row (rule 14)');
  // Never email an OTA guest about money they already paid the platform (rule 16), and never offer
  // to cancel a stay that already happened (rule 17).
  assert.equal(out.canRemind, false);
  assert.equal(out.remindType, null);
  assert.equal(out.canCancel, false);
  assert.equal(out.cancelOn, null);
  assert.equal(out.retainedDepositAmount, 0);
});

test('a platform payout is not late before the deadline — nor before the guest has left', () => {
  // Departure + 10 still ahead.
  assert.equal(buildPaymentDeadlineRow(platformRow({ endDate: '2026-08-12' }), TODAY), null);
  // Deadline on the day itself: due, not late.
  assert.equal(buildPaymentDeadlineRow(platformRow({ endDate: '2026-08-09' }), TODAY), null);
  // Already settled.
  assert.equal(buildPaymentDeadlineRow(platformRow({ balancePaid: 1 }), TODAY), null);
  // Priced, but nothing left on the solde (an offered stay, or everything collected at the door):
  // the books know the money. A booking never priced AT ALL is a different state — see below.
  assert.equal(buildPaymentDeadlineRow(platformRow({ balanceAmount: 0 }), TODAY), null);
  // The stay is still ahead → nothing can be late yet, whatever the stored column says.
  const future = platformRow({ startDate: '2026-09-18', endDate: '2026-09-25', balanceDueDate: '2026-08-09' });
  assert.equal(buildPaymentDeadlineRow(future, TODAY), null);
});

test('the deadline is derived from the departure, never read from the stored column (rule 12bis)', () => {
  // A reservation created BEFORE this change still carries the old guest-facing date (arrival − 30
  // or − 7). Trusting it would announce « en retard de 26 jours » for a payout that is not due yet —
  // exactly what shipping without a migration would otherwise cost.
  const legacy = platformRow({ startDate: '2026-08-01', endDate: '2026-08-15', balanceDueDate: '2026-07-25' });
  assert.equal(buildPaymentDeadlineRow(legacy, TODAY), null, 'departure + 10 = 2026-08-25, not late yet');
  // Same row a week later: late by the real rule, and by the right number of days.
  const later = buildPaymentDeadlineRow(legacy, '2026-08-28');
  assert.equal(later.dueDate, '2026-08-25');
  assert.equal(later.daysLate, 3);
});

test('the platform\'s own delay drives the row', () => {
  // Booking invoices monthly: the same stay is not late on the day Airbnb would be.
  const slow = platformRow({ payoutDueDays: 45 });
  assert.equal(buildPaymentDeadlineRow(slow, TODAY), null);
  const fast = buildPaymentDeadlineRow(platformRow({ payoutDueDays: 3 }), TODAY);
  assert.equal(fast.dueDate, '2026-07-25');
  assert.equal(fast.daysLate, 25);
  // An absent setting falls back to 10, never to 0.
  const fallback = buildPaymentDeadlineRow(platformRow({ payoutDueDays: undefined }), TODAY);
  assert.equal(fallback.dueDate, '2026-08-01');
});

test('an unpaid acompte on a platform that takes one never raises a row (rule 14)', () => {
  const out = buildPaymentDeadlineRow(platformRow({
    depositAmount: 200, depositPaid: 0, depositDueDate: '2026-06-01',
    balanceAmount: 0,
  }), TODAY);
  assert.equal(out, null);
});

test('a snoozed platform row is hidden too (rule 18)', () => {
  assert.equal(buildPaymentDeadlineRow(platformRow({ paymentAlertSnoozedUntil: '2026-08-26' }), TODAY), null);
  assert.ok(buildPaymentDeadlineRow(platformRow({ paymentAlertSnoozedUntil: '2026-08-18' }), TODAY));
});

test('rows leave the card on their own clock — departure for a guest, deadline for a platform (rule 21)', () => {
  // Own channel: 30 days after the DEPARTURE.
  const stayEnded = { startDate: '2026-06-20', endDate: '2026-07-20', balanceDueDate: '2026-06-01' };
  assert.ok(buildPaymentDeadlineRow(row(stayEnded), '2026-08-19'), 'still visible 30 days after the stay');
  assert.equal(buildPaymentDeadlineRow(row(stayEnded), '2026-08-20'), null, 'gone on day 31');
  // Platform: 30 days after the PAYOUT DEADLINE (departure + 10 = 2026-08-01), itself after the stay.
  const payout = platformRow();
  assert.ok(buildPaymentDeadlineRow(payout, '2026-08-31'), 'still visible 30 days late');
  assert.equal(buildPaymentDeadlineRow(payout, '2026-09-01'), null, 'gone on day 31');
});

test('a late payout ranks after every guest-facing state', () => {
  const rows = buildPaymentDeadlineRows([
    { ...platformRow(), id: 4 },
    { ...row(), id: 1 },                                        // cancel_due
    { ...row({ balanceDueDate: '2026-08-18', startDate: '2026-09-18' }), id: 2 }, // balance_overdue
  ], TODAY);
  assert.deepEqual(rows.map((r) => r.state), ['cancel_due', 'balance_overdue', 'platform_payout_overdue']);
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

// ── Montant plateforme jamais saisi (specs/platform-payout-due-date.md §3.2bis) ───────────────

// An iCal import that was never priced: no total, no buckets, nothing.
function unpricedRow(overrides = {}) {
  return platformRow({ finalPrice: 0, balanceAmount: 0, depositAmount: 0, ...overrides });
}

test('a platform booking with no figures at all asks for the amount, not for the money', () => {
  const out = buildPaymentDeadlineRow(unpricedRow(), TODAY);
  assert.equal(out.state, 'platform_amount_missing');
  assert.equal(out.severity, 'warning');
  assert.equal(out.platformLabel, 'Airbnb');
  assert.equal(out.dueDate, '2026-08-01', 'the payout deadline is what makes the omission certain');
  assert.equal(out.daysLate, 18);
  // Nothing to print, nothing to chase, nothing to cancel.
  assert.equal(out.balanceDue, 0);
  assert.equal(out.depositDue, 0);
  assert.equal(out.totalDue, 0);
  assert.equal(out.canRemind, false);
  assert.equal(out.remindType, null);
  assert.equal(out.canCancel, false);
});

test('the amount is only « missing » once the payout deadline has passed (rule 27)', () => {
  // Before the departure: not having typed the figures yet is not an oversight.
  assert.equal(buildPaymentDeadlineRow(unpricedRow({ endDate: '2026-09-30' }), TODAY), null);
  // Departed, but the payout is not due yet → still nothing to say.
  assert.equal(buildPaymentDeadlineRow(unpricedRow({ endDate: '2026-08-12' }), TODAY), null);
  // On the deadline itself: due, not missed.
  assert.equal(buildPaymentDeadlineRow(unpricedRow({ endDate: '2026-08-09' }), TODAY), null);
});

test('a booking whose amount IS known stays a payout row, never an amount-missing one', () => {
  const priced = buildPaymentDeadlineRow(platformRow({ finalPrice: 640 }), TODAY);
  assert.equal(priced.state, 'platform_payout_overdue');
  // Priced and already settled → no row at all.
  assert.equal(buildPaymentDeadlineRow(platformRow({ finalPrice: 640, balancePaid: 1 }), TODAY), null);
  // Priced, but the whole stay is collected at the door (complement) → the books know the money.
  assert.equal(buildPaymentDeadlineRow(platformRow({ finalPrice: 640, balanceAmount: 0 }), TODAY), null);
});

test('an amount-missing row never expires — unlike every other state (rule 29)', () => {
  const ancient = unpricedRow({ startDate: '2025-07-15', endDate: '2025-07-22' });
  const out = buildPaymentDeadlineRow(ancient, TODAY);
  assert.equal(out.state, 'platform_amount_missing');
  assert.equal(out.daysLate, 383, 'a year later it is still a hole in the books');
  // The payout row, by contrast, is long gone by then.
  assert.equal(buildPaymentDeadlineRow(platformRow({ startDate: '2025-07-15', endDate: '2025-07-22' }), TODAY), null);
});

test('an amount-missing row can be snoozed like any other', () => {
  assert.equal(buildPaymentDeadlineRow(unpricedRow({ paymentAlertSnoozedUntil: '2026-08-26' }), TODAY), null);
});

test('amount-missing ranks last, after the late payouts', () => {
  const rows = buildPaymentDeadlineRows([
    { ...unpricedRow(), id: 5 },
    { ...platformRow(), id: 4 },
    { ...row(), id: 1 },
  ], TODAY);
  assert.deepEqual(rows.map((r) => r.state), ['cancel_due', 'platform_payout_overdue', 'platform_amount_missing']);
});

test('an own channel with no figures is never flagged — this is about platform imports', () => {
  assert.equal(buildPaymentDeadlineRow(unpricedRow({ platform: 'direct' }), TODAY), null);
  assert.equal(buildPaymentDeadlineRow(unpricedRow({ platform: 'Lodgify' }), TODAY), null);
});


// ── 2026-08-20 amendment: nothing is sent automatically, so the card carries the to-dos ────────────

test('a fresh booking whose acompte was never requested is a to-do, not a late payment', () => {
  const out = buildPaymentDeadlineRow(
    row({ depositPaid: 0, depositRequestSent: 0, depositDueDate: '2026-08-26', balanceDueDate: '2026-09-01' }),
    TODAY,
  );
  assert.equal(out.state, 'deposit_to_request');
  assert.equal(out.severity, 'info', 'every new booking passes here — it must not paint the card yellow');
  assert.equal(out.requestSent, false);
  assert.equal(out.remindType, 'deposit');
  assert.equal(out.daysLate, 0, 'nothing is late: the deadline has not passed');
  assert.equal(out.canCancel, false);
});

test('an acompte never requested stays a to-do after its deadline (the to-do is still to ASK)', () => {
  const out = buildPaymentDeadlineRow(
    row({ depositPaid: 0, depositRequestSent: 0, depositDueDate: '2026-08-15', balanceDueDate: '2026-09-01' }),
    TODAY,
  );
  assert.equal(out.state, 'deposit_to_request');
  assert.equal(out.daysLate, 4, 'the client appends « échéance dépassée de 4 jours »');
});

test('sending the request flips the row to its overdue twin', () => {
  const asked = row({ depositPaid: 0, depositRequestSent: 1, depositDueDate: '2026-08-15', balanceDueDate: '2026-09-01' });
  assert.equal(buildPaymentDeadlineRow(asked, TODAY).state, 'deposit_overdue');
  assert.equal(buildPaymentDeadlineRow({ ...asked, depositRequestSent: 0 }, TODAY).state, 'deposit_to_request');
});

test('a solde becomes « à demander » ON its due date, the day the deleted cron used to mail it', () => {
  const base = row({ balanceRequestSent: 0, balanceDueDate: TODAY });
  const out = buildPaymentDeadlineRow(base, TODAY);
  assert.equal(out.state, 'balance_to_request');
  assert.equal(out.remindType, 'balance');
  assert.equal(out.requestSent, false);
  assert.equal(
    buildPaymentDeadlineRow({ ...base, balanceDueDate: '2026-08-20' }, TODAY), null,
    'the day before its deadline there is nothing to ask for yet',
  );
});

test('a solde nobody ever asked for never proposes a cancellation (rule 12bis)', () => {
  const out = buildPaymentDeadlineRow(row({ balanceRequestSent: 0 }), TODAY);
  assert.equal(out.state, 'balance_to_request', 'past cancelOn, but the guest was never asked');
  assert.equal(out.canCancel, false);
  assert.equal(buildPaymentDeadlineRow(row(), TODAY).canCancel, true, 'asked → the cancellation is offered');
});

test('« à demander » outranks « en retard » but stays under the two red states', () => {
  const rows = buildPaymentDeadlineRows([
    { ...row({ id: 1, depositPaid: 0, depositRequestSent: 0, depositDueDate: '2026-08-01', balanceAmount: 0 }) },
    { ...row({ id: 2, balanceRequestSent: 0 }) },
    { ...row({ id: 3, startDate: '2026-08-18' }) },
  ], TODAY);
  assert.deepEqual(rows.map((r) => r.state), ['unpaid_at_arrival', 'balance_to_request', 'deposit_to_request']);
});

test('a platform booking never produces a « à demander » row — its solde is the platform\'s', () => {
  const out = buildPaymentDeadlineRow(
    row({ platform: 'airbnb', balanceRequestSent: 0, depositRequestSent: 0, payoutDueDays: 10 }),
    TODAY,
  );
  assert.notEqual(out && out.state, 'balance_to_request');
  assert.notEqual(out && out.state, 'deposit_to_request');
});
