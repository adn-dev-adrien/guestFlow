// specs/hourly-resource-quantity-and-sas-scheduling.md rule 35 (adversarial review of the 2026-10-27
// fixes) — rule 34 counted every outside use touching a session instead of the most used at once: with a
// resource ×2, bookings 17:00–18:30 and 19:30–21:00 refused a session 18:00–20:00 although one unit is
// always free. The peak of simultaneous uses is compared, the turnover still kept after each use.
const test = require('node:test');
const assert = require('node:assert/strict');

const { firstSessionConflict, peakConcurrency } = require('../utils/resourceSessionConflicts');

const BATH = 2;
const DAY = '2027-07-10';
const check = (sessions, occupied, { quantity = 2, turnover = 0 } = {}) => firstSessionConflict(
  [{ resourceId: BATH, sessions: sessions.map(([start, end]) => ({ date: DAY, start, end })) }],
  () => quantity,
  { occupiedOn: () => occupied.map(([start, end]) => ({ start, end })), turnoverOf: () => turnover },
);

test('two outside bookings one after the other take one unit of two', () => {
  assert.equal(check([['18:00', '20:00']], [['17:00', '18:30'], ['19:30', '21:00']]), null);
});

test('the same two bookings with a turnover that makes them overlap the session still leave one unit', () => {
  assert.equal(check([['18:00', '20:00']], [['17:00', '18:30'], ['19:30', '21:00']], { turnover: 30 }), null);
});

test('two outside bookings at the same time fill both units', () => {
  const conflict = check([['18:00', '20:00']], [['17:00', '18:30'], ['18:00', '19:00']]);
  assert.deepEqual(conflict, { resourceId: BATH, date: DAY, start: '18:00', end: '20:00', elsewhere: true });
});

test('a turnover still counts: a reset not finished when the session starts takes the unit', () => {
  const conflict = check([['18:00', '19:00']], [['16:00', '17:45']], { quantity: 1, turnover: 30 });
  assert.equal(conflict && conflict.elsewhere, true);
  assert.equal(check([['18:00', '19:00']], [['16:00', '17:30']], { quantity: 1, turnover: 30 }), null);
});

test('own sessions count with the outside ones at the same instant only', () => {
  // 17:45–18:00: two own sessions and the booking — three uses of two units.
  assert.equal(check([['17:00', '18:00'], ['17:30', '19:00']], [['17:45', '18:30']]).elsewhere, true);
  // The booking starts when the first own session ends: never more than two at once.
  assert.equal(check([['17:00', '18:00'], ['17:30', '19:00']], [['18:00', '20:00']]), null);
});

test('peakConcurrency: touching intervals never stack', () => {
  assert.equal(peakConcurrency([{ start: 0, end: 10 }, { start: 10, end: 20 }]), 1);
  assert.equal(peakConcurrency([{ start: 0, end: 10 }, { start: 5, end: 20 }, { start: 8, end: 9 }]), 3);
  assert.equal(peakConcurrency([]), 0);
});
