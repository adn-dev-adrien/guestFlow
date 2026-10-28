const test = require('node:test');
const assert = require('node:assert/strict');

const { addDays, weekdayOf, previousMatchingDay, __test } = require('../laundryWindow');

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

// --- specs/linen-laundry-days.md §3.2 rule 8 — the day-by-day walk that replaced the 7-day jumps ---

const nonSkipped = (weekdays, skipped = []) => (iso) => weekdays.includes(weekdayOf(iso)) && !skipped.includes(iso);

test('previousMatchingDay: the latest matching day strictly before iso, a regular day included or not', () => {
  const tuesdays = nonSkipped([2]);
  assert.equal(previousMatchingDay('2026-06-09', tuesdays), '2026-06-02');   // a Tuesday walks back a week
  assert.equal(previousMatchingDay('2026-06-11', tuesdays), '2026-06-09');   // Thursday → Tuesday
  assert.equal(previousMatchingDay('2026-06-10', tuesdays), '2026-06-09');
  assert.equal(previousMatchingDay('2026-06-02', tuesdays), '2026-05-26');   // across a month boundary
  assert.equal(previousMatchingDay('2026-01-06', tuesdays), '2025-12-30');
});

test('previousMatchingDay: DST-safe across the spring forward', () => {
  assert.equal(previousMatchingDay('2026-04-04', nonSkipped([6])), '2026-03-28');
});

test('previousMatchingDay: walks back through skipped trips', () => {
  assert.equal(previousMatchingDay('2026-06-09', nonSkipped([2], ['2026-06-02'])), '2026-05-26');
  assert.equal(previousMatchingDay('2026-06-16', nonSkipped([2], ['2026-06-02', '2026-06-09'])), '2026-05-26');
});

test('previousMatchingDay: null when the whole lookback is skipped, a longer lookback reaches further', () => {
  const skipped = ['2026-06-09', '2026-06-02', '2026-05-26', '2026-05-19'];
  assert.equal(previousMatchingDay('2026-06-16', nonSkipped([2], skipped)), null);
  assert.equal(previousMatchingDay('2026-06-16', nonSkipped([2], skipped), 35), '2026-05-12');
});

test('previousMatchingDay: several weekdays — Tuesday and Thursday alternate (2 and 5 days apart)', () => {
  const tueThu = nonSkipped([2, 4]);
  assert.equal(previousMatchingDay('2026-06-09', tueThu), '2026-06-04');   // Tue → previous Thu
  assert.equal(previousMatchingDay('2026-06-11', tueThu), '2026-06-09');   // Thu → Tue
  assert.equal(previousMatchingDay('2026-06-09', nonSkipped([2, 4], ['2026-06-04'])), '2026-06-02');
});

test('previousMatchingDay: the lookback bound is inclusive', () => {
  assert.equal(previousMatchingDay('2026-06-30', nonSkipped([2]), 28), '2026-06-23');
  assert.equal(previousMatchingDay('2026-06-30', (iso) => iso === '2026-06-02', 28), '2026-06-02');
  assert.equal(previousMatchingDay('2026-06-30', (iso) => iso === '2026-06-01', 28), null);
});
