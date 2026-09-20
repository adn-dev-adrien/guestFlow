const test = require('node:test');
const assert = require('node:assert/strict');

const { computeWindow, __test } = require('../utils/gateWindow');
const { wallClockToDate } = __test;

// specs/gate-access-sowel-connector.md §3.1 rules 7-9. Every assertion below is written in UTC instants on
// purpose: that is what the server compares, and it is the only way a wall-clock bug shows up.

const paris = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short',
});

const stay = (over = {}) => ({
  startDate: '2026-09-12',
  checkInTime: '16:00',
  endDate: '2026-09-14',
  checkOutTime: '10:00',
  ...over,
});

// --- the plain window ---
test('summer stay: opens at the check-in wall clock, closes one hour after check-out', () => {
  const { start, end } = computeWindow(stay());
  assert.equal(start.toISOString(), '2026-09-12T14:00:00.000Z', '16:00 Paris in CEST is 14:00Z');
  assert.equal(end.toISOString(), '2026-09-14T09:00:00.000Z', '10:00 + 1 h = 11:00 Paris = 09:00Z');
  assert.equal(paris.format(start), '12/09/2026 16:00');
  assert.equal(paris.format(end), '14/09/2026 11:00');
});

test('winter stay: the same wall clock, one hour further from UTC', () => {
  const { start, end } = computeWindow(stay({
    startDate: '2026-01-10', endDate: '2026-01-12',
  }));
  assert.equal(start.toISOString(), '2026-01-10T15:00:00.000Z');
  assert.equal(end.toISOString(), '2026-01-12T10:00:00.000Z');
  assert.equal(paris.format(start), '10/01/2026 16:00');
  assert.equal(paris.format(end), '12/01/2026 11:00');
});

test('the check-out itself is exposed, so the page can say what time the stay ends', () => {
  const { checkOut, end } = computeWindow(stay());
  assert.equal(paris.format(checkOut), '14/09/2026 10:00');
  assert.equal(end.getTime() - checkOut.getTime(), 60 * 60 * 1000, 'exactly one hour, never a day');
});

test('missing or unusable dates yield no window at all', () => {
  assert.equal(computeWindow(null), null);
  assert.equal(computeWindow(stay({ startDate: '' })), null);
  assert.equal(computeWindow(stay({ endDate: 'not-a-date' })), null);
  assert.equal(computeWindow(stay({ startDate: '12/09/2026' })), null, 'FR format is not accepted');
});

test('an empty time falls back to the schema default, it does not void the window', () => {
  const { start, end } = computeWindow(stay({ checkInTime: '', checkOutTime: null }));
  assert.equal(paris.format(start), '12/09/2026 15:00', 'default check-in');
  assert.equal(paris.format(end), '14/09/2026 11:00', 'default check-out 10:00 + 1 h');
});

// --- the two nights of the year that break naive code ---
test('spring forward: a 02:30 wall clock that does not exist resolves to 03:30', () => {
  const at = wallClockToDate('2026-03-29', '02:30');
  assert.equal(at.toISOString(), '2026-03-29T01:30:00.000Z');
  assert.equal(paris.format(at), '29/03/2026 03:30');
});

test('fall back: a 02:30 wall clock that happens twice resolves to the second one (winter time)', () => {
  // Pinned deliberately — see the note in gateWindow.js. It only ever affects a stay whose
  // check-in or check-out sits between 02:00 and 03:00 on one night a year.
  const at = wallClockToDate('2026-10-25', '02:30');
  assert.equal(at.toISOString(), '2026-10-25T01:30:00.000Z');
  assert.equal(paris.format(at), '25/10/2026 02:30');
});

test('the +1 h grace is one hour of real time, even across the fall-back boundary', () => {
  const { checkOut, end } = computeWindow(stay({
    startDate: '2026-10-24', endDate: '2026-10-25', checkOutTime: '02:30',
  }));
  assert.equal(end.getTime() - checkOut.getTime(), 60 * 60 * 1000);
  assert.equal(end.toISOString(), '2026-10-25T02:30:00.000Z');
  assert.equal(paris.format(end), '25/10/2026 03:30');
});

test('a stay straddling the spring change still opens at the local check-in hour', () => {
  const { start, end } = computeWindow(stay({
    startDate: '2026-03-28', endDate: '2026-03-30',
  }));
  assert.equal(paris.format(start), '28/03/2026 16:00', 'winter time on the way in');
  assert.equal(paris.format(end), '30/03/2026 11:00', 'summer time on the way out');
  assert.equal(start.toISOString(), '2026-03-28T15:00:00.000Z');
  assert.equal(end.toISOString(), '2026-03-30T09:00:00.000Z');
});

test('midnight is a valid wall clock, and it is the right day', () => {
  const at = wallClockToDate('2026-07-01', '00:00');
  assert.equal(paris.format(at), '01/07/2026 00:00');
  assert.equal(at.toISOString(), '2026-06-30T22:00:00.000Z');
});

test('no usable dates yields no window — nothing is pushed for it', () => {
  assert.equal(computeWindow(null), null);
  assert.equal(computeWindow(stay({ endDate: '' })), null);
  assert.equal(computeWindow(stay({ startDate: '12/09/2026' })), null);
});
