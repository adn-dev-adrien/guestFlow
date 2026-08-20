// Payment schedule (specs/payment-schedule-and-cancellation.md §3.1 to §3.3): the acompte is due
// after the BOOKING and never moves again, the solde 30 days before arrival but never before the
// booking day, and the cancellation deadline is the solde's + the property's delay.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveDepositDueDate, resolveBalanceDueDate, resolveCancelOn, daysBetween,
} = require('../utils/paymentSchedule');

test('acompte: booking date + depositDueDays', () => {
  assert.equal(resolveDepositDueDate({ bookingDate: '2026-03-01', depositDueDays: 7 }), '2026-03-08');
  assert.equal(resolveDepositDueDate({ bookingDate: '2026-03-01', depositDueDays: 0 }), '2026-03-01');
  // A datetime (what `createdAt` actually stores) is read as its day.
  assert.equal(resolveDepositDueDate({ bookingDate: '2026-03-01 18:42:07', depositDueDays: 7 }), '2026-03-08');
  // Blank / nonsense delays fall back to the 7-day policy default rather than inventing a deadline.
  assert.equal(resolveDepositDueDate({ bookingDate: '2026-03-01', depositDueDays: null }), '2026-03-08');
  assert.equal(resolveDepositDueDate({ bookingDate: '2026-03-01', depositDueDays: -5 }), '2026-03-08');
});

test('acompte: a stored deadline wins over any recomputation (rule 4)', () => {
  const kept = resolveDepositDueDate({
    bookingDate: '2026-03-01', depositDueDays: 7, existingDepositDueDate: '2026-02-10',
  });
  assert.equal(kept, '2026-02-10', 'the promise made on the booking day is never pushed around');
});

test('acompte: a devis takes its validity date as the deadline (rule 5)', () => {
  assert.equal(
    resolveDepositDueDate({ kind: 'devis', validUntil: '2026-04-15', bookingDate: '2026-03-01' }),
    '2026-04-15',
  );
  assert.equal(resolveDepositDueDate({ kind: 'devis', validUntil: null }), null);
});

test('acompte: nothing to collect → no deadline (rule 6)', () => {
  assert.equal(resolveDepositDueDate({ hasDeposit: false, bookingDate: '2026-03-01' }), null);
  // No booking date at all (a stateless quote) → the engine states no deadline rather than a wrong one.
  assert.equal(resolveDepositDueDate({ bookingDate: null }), null);
});

test('solde: 30 days before arrival', () => {
  assert.equal(
    resolveBalanceDueDate({ startDate: '2026-08-01', bookingDate: '2026-02-01', balanceDaysBefore: 30 }),
    '2026-07-02',
  );
});

test('solde: a late booking clamps the deadline to the booking day (rule 9)', () => {
  // Booked 12 days before arrival: acompte and solde are both immediately payable.
  assert.equal(
    resolveBalanceDueDate({ startDate: '2026-08-01', bookingDate: '2026-07-20', balanceDaysBefore: 30 }),
    '2026-07-20',
  );
});

test('solde: nothing left pre-arrival → no deadline (rule 10)', () => {
  assert.equal(resolveBalanceDueDate({ hasBalance: false, startDate: '2026-08-01' }), null);
  assert.equal(resolveBalanceDueDate({ startDate: null }), null);
});

test('annulation: solde deadline + the property delay (rule 11)', () => {
  assert.equal(resolveCancelOn({ balanceDueDate: '2026-07-02', cancelAfterBalanceDueDays: 7 }), '2026-07-09');
  assert.equal(resolveCancelOn({ balanceDueDate: '2026-07-02', cancelAfterBalanceDueDays: null }), '2026-07-09');
  assert.equal(resolveCancelOn({ balanceDueDate: null }), null);
});

test('daysBetween counts whole days, negative into the future', () => {
  assert.equal(daysBetween('2026-07-02', '2026-07-09'), 7);
  assert.equal(daysBetween('2026-07-09', '2026-07-02'), -7);
  assert.equal(daysBetween(null, '2026-07-02'), null);
});

// ── Platform payout (specs/platform-payout-due-date.md §3.1) ──────────────────────────────────

test('solde on a platform: due payoutDueDays AFTER the departure, not before the arrival (rule 4)', () => {
  const stay = { startDate: '2026-07-02', endDate: '2026-07-09', bookingDate: '2026-05-01' };
  assert.equal(
    resolveBalanceDueDate({ ...stay, platform: 'Airbnb' }),
    '2026-07-19',
    'default 10 days after the guest leaves',
  );
  assert.equal(
    resolveBalanceDueDate({ ...stay, platform: 'Booking', platformPayoutDueDays: 45 }),
    '2026-08-23',
    'a platform invoicing monthly can be given its own delay',
  );
  assert.equal(
    resolveBalanceDueDate({ ...stay, platform: 'Airbnb', platformPayoutDueDays: 0 }),
    '2026-07-09',
    '0 is a legitimate setting: paid on the departure day itself',
  );
});

test('own channels keep the guest-facing schedule — Lodgify included (rule 2)', () => {
  const stay = { startDate: '2026-08-01', endDate: '2026-08-08', bookingDate: '2026-02-01', balanceDaysBefore: 30 };
  assert.equal(resolveBalanceDueDate({ ...stay, platform: 'direct' }), '2026-07-02');
  assert.equal(resolveBalanceDueDate({ ...stay, platform: 'Lodgify' }), '2026-07-02');
  assert.equal(resolveBalanceDueDate({ ...stay, platform: 'lodgify' }), '2026-07-02');
  assert.equal(resolveBalanceDueDate(stay), '2026-07-02', 'no platform at all → unchanged behaviour');
});

test('an unusable payout delay falls back to 10, never to 0 (rule 7)', () => {
  const stay = { startDate: '2026-07-02', endDate: '2026-07-09', platform: 'Airbnb' };
  for (const bad of [null, undefined, '', 'abcd', NaN, -3, 900]) {
    assert.equal(
      resolveBalanceDueDate({ ...stay, platformPayoutDueDays: bad }),
      '2026-07-19',
      `payoutDueDays=${String(bad)} must fall back to the default`,
    );
  }
});

test('a platform stay with no departure date, or nothing to collect, has no deadline', () => {
  assert.equal(resolveBalanceDueDate({ startDate: '2026-07-02', endDate: null, platform: 'Airbnb' }), null);
  assert.equal(resolveBalanceDueDate({ endDate: '2026-07-09', platform: 'Airbnb', hasBalance: false }), null);
});
