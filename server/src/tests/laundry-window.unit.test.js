const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addDays, weekdayOf, findLaundryDaysInRange, prevLaundryDay, __test,
} = require('../utils/laundryWindow');

// Pure ISO date math — no DB. Pinned cases for specs/weekly-bed-linen-tracking.md §3.3.

test('parseIso rejects malformed input', () => {
  assert.throws(() => __test.parseIso('not-a-date'));
  assert.throws(() => __test.parseIso('2026/06/02'));
  assert.throws(() => __test.parseIso(null));
  assert.throws(() => __test.parseIso(''));
});

test('addDays handles positive + negative deltas across month boundaries', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-02-01', -1), '2026-01-31');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
});

test('addDays is DST-safe across the CET → CEST switch (last Sunday of March)', () => {
  // 2026-03-29 is a Sunday in France; clocks jump forward 02:00 → 03:00. A local-midnight
  // Date instance would produce a 23h day here. UTC-anchored math keeps +24h.
  assert.equal(addDays('2026-03-28', 1), '2026-03-29');
  assert.equal(addDays('2026-03-29', 1), '2026-03-30');
  // Same for the autumn CEST → CET switch (last Sunday of October).
  assert.equal(addDays('2026-10-24', 1), '2026-10-25');
  assert.equal(addDays('2026-10-25', 1), '2026-10-26');
});

test('weekdayOf returns Date.getUTCDay() semantics (0=Sunday)', () => {
  // 2026-06-02 is a Tuesday → 2.
  assert.equal(weekdayOf('2026-06-02'), 2);
  // 2026-06-07 is a Sunday → 0.
  assert.equal(weekdayOf('2026-06-07'), 0);
  // 2026-06-06 is a Saturday → 6.
  assert.equal(weekdayOf('2026-06-06'), 6);
});

test('assertWeekday rejects out-of-range values', () => {
  assert.throws(() => __test.assertWeekday(-1));
  assert.throws(() => __test.assertWeekday(7));
  assert.throws(() => __test.assertWeekday('mardi'));
  assert.throws(() => __test.assertWeekday(2.5));
  assert.equal(__test.assertWeekday(0), 0);
  assert.equal(__test.assertWeekday(6), 6);
});

test('findLaundryDaysInRange: enumerates Tuesdays in a 14-day window', () => {
  // Mon 2026-06-01 → Sun 2026-06-14. Tuesdays: 06-02 + 06-09.
  assert.deepEqual(
    findLaundryDaysInRange('2026-06-01', '2026-06-14', 2),
    ['2026-06-02', '2026-06-09']
  );
});

test('findLaundryDaysInRange: range starts on a laundry day → first day included', () => {
  // Tue 2026-06-02 → Mon 2026-06-08. Only 06-02 fits.
  assert.deepEqual(
    findLaundryDaysInRange('2026-06-02', '2026-06-08', 2),
    ['2026-06-02']
  );
});

test('findLaundryDaysInRange: range ends on a laundry day → last day included (inclusive)', () => {
  // Wed 2026-06-03 → Tue 2026-06-09. Only 06-09 fits.
  assert.deepEqual(
    findLaundryDaysInRange('2026-06-03', '2026-06-09', 2),
    ['2026-06-09']
  );
});

test('findLaundryDaysInRange: range with no laundry day returns empty', () => {
  // Wed → Mon (6 days, no Tuesday inside).
  assert.deepEqual(
    findLaundryDaysInRange('2026-06-03', '2026-06-08', 2),
    []
  );
});

test('findLaundryDaysInRange: from > to returns empty', () => {
  assert.deepEqual(findLaundryDaysInRange('2026-06-09', '2026-06-02', 2), []);
});

test('findLaundryDaysInRange: rejects out-of-range weekday', () => {
  assert.throws(() => findLaundryDaysInRange('2026-06-01', '2026-06-14', 7));
});

test('findLaundryDaysInRange: same day for from + to', () => {
  // Tuesday 06-02 → 06-02 matches.
  assert.deepEqual(findLaundryDaysInRange('2026-06-02', '2026-06-02', 2), ['2026-06-02']);
  // Wednesday 06-03 → 06-03 doesn't.
  assert.deepEqual(findLaundryDaysInRange('2026-06-03', '2026-06-03', 2), []);
});

test('prevLaundryDay: 7 days earlier, across month boundary', () => {
  assert.equal(prevLaundryDay('2026-06-02'), '2026-05-26');
  assert.equal(prevLaundryDay('2026-01-06'), '2025-12-30');
});

test('prevLaundryDay: DST-safe across the spring forward', () => {
  // 2026-04-04 minus 7 days → 2026-03-28 (crosses the 2026-03-29 DST switch in France).
  assert.equal(prevLaundryDay('2026-04-04'), '2026-03-28');
});
