// specs/guest-email-sequence.md §3.1-§3.2 — the send date of every email of the sequence, edge cases
// included (one-night stay, booking the day before, exactly 7 or 2 days before, shortened stay).

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAIL, planStayMails, isLastMinute, seasonSendDates, giftDeadline, seasonKeyOf, stayDedupKey, seasonDedupKey,
} = require('../utils/guestEmailSequence');

const CLIENT = { id: 1, email: 'camille@example.fr' };
const START = '2026-01-01';

function plan(reservation) {
  const byKey = {};
  for (const entry of planStayMails({ reservation: { id: 42, clientId: 1, platform: 'direct', ...reservation }, client: CLIENT, startDate: START })) {
    byKey[entry.stableKey] = entry;
  }
  return byKey;
}

// rules 2-5 — the due date of each stay mail: the booking day, J-7, J-2, and departure + 1.
test('a stay booked months ahead: confirmation on the booking day, J-7, J-2 and J+1 on their dates', () => {
  const p = plan({ createdAt: '2027-03-02 10:12:00', startDate: '2027-07-10', endDate: '2027-07-17' });
  assert.equal(p[MAIL.CONFIRMATION].sendDate, '2027-03-02');
  assert.equal(p[MAIL.J7].sendDate, '2027-07-03');
  assert.equal(p[MAIL.J2].sendDate, '2027-07-08');
  assert.equal(p[MAIL.J1].sendDate, '2027-07-18');
  for (const entry of Object.values(p)) assert.equal(entry.blocked, null, entry.stableKey);
});

// rules 3-4 — booked less than 7 (resp. 2) days before arrival: the reminder folds into the confirmation.
test('one-night stay booked the day before: J-7 and J-2 fold into the confirmation', () => {
  const reservation = { createdAt: '2026-10-01 18:00:00', startDate: '2026-10-02', endDate: '2026-10-03' };
  const p = plan(reservation);
  assert.equal(p[MAIL.CONFIRMATION].blocked, null);
  assert.equal(p[MAIL.J7].blocked, 'bookedWithinWeek');
  assert.equal(p[MAIL.J2].blocked, 'bookedWithinTwoDays');
  assert.equal(p[MAIL.J1].sendDate, '2026-10-04');
  assert.equal(isLastMinute(reservation), true, 'the confirmation carries the arrival essentials');
});

test('booked exactly 7 days before arrival: no J-7 (same day as the confirmation), the J-2 still leaves', () => {
  const p = plan({ createdAt: '2026-10-03 09:00:00', startDate: '2026-10-10', endDate: '2026-10-12' });
  assert.equal(p[MAIL.J7].sendDate, '2026-10-03');
  assert.equal(p[MAIL.J7].blocked, 'bookedWithinWeek');
  assert.equal(p[MAIL.J2].blocked, null);
});

test('booked exactly 2 days before arrival: no J-2, the confirmation carries the arrival block', () => {
  const reservation = { createdAt: '2026-10-08 09:00:00', startDate: '2026-10-10', endDate: '2026-10-12' };
  assert.equal(plan(reservation)[MAIL.J2].blocked, 'bookedWithinTwoDays');
  assert.equal(isLastMinute(reservation), true);
});

test('booked 3 days before arrival: the J-2 leaves and the confirmation stays short', () => {
  const reservation = { createdAt: '2026-10-07 09:00:00', startDate: '2026-10-10', endDate: '2026-10-12' };
  assert.equal(plan(reservation)[MAIL.J2].blocked, null);
  assert.equal(isLastMinute(reservation), false);
});

// rule 5 — the J+1 is read at send time, so an edited departure date moves it.
test('a shortened stay moves the J+1 with the new departure date', () => {
  const before = plan({ createdAt: '2027-03-02', startDate: '2027-07-10', endDate: '2027-07-17' });
  const after = plan({ createdAt: '2027-03-02', startDate: '2027-07-10', endDate: '2027-07-14' });
  assert.equal(before[MAIL.J1].sendDate, '2027-07-18');
  assert.equal(after[MAIL.J1].sendDate, '2027-07-15');
  assert.equal(after[MAIL.J1].dedupKey, before[MAIL.J1].dedupKey, 'same key: a J+1 already sent is never re-sent');
});

// rule 11 — the shape of the two dedup keys the ledger holds.
test('dedup keys: one per (mail, reservation), one per (mail, client, season)', () => {
  assert.equal(stayDedupKey(MAIL.J7, 42), 'arrival_reminder_7d:r42');
  assert.equal(seasonDedupKey(MAIL.NOVEMBER, 7, seasonKeyOf(MAIL.NOVEMBER, '2027-11-15')), 'season_gift_vouchers:c7:2027-11');
  assert.equal(seasonKeyOf(MAIL.JANUARY, '2028-01-06'), '2028-01');
});

test('season dates: 15 November and 6 January inside the window, nothing else', () => {
  assert.deepEqual(seasonSendDates('2026-09-01', '2027-02-01'), [
    { stableKey: MAIL.NOVEMBER, sendDate: '2026-11-15' },
    { stableKey: MAIL.JANUARY, sendDate: '2027-01-06' },
  ]);
  assert.deepEqual(seasonSendDates('2026-11-16', '2027-01-05'), []);
});

test('gift deadlines: 15 December for November, the last day of February for January (leap years)', () => {
  assert.equal(giftDeadline(MAIL.NOVEMBER, '2027-11-15'), '2027-12-15');
  assert.equal(giftDeadline(MAIL.JANUARY, '2028-01-06'), '2028-02-29');
  assert.equal(giftDeadline(MAIL.JANUARY, '2027-01-06'), '2027-02-28');
});
