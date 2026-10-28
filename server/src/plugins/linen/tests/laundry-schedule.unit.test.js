const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createSchedule, validateSchedule, describeCycle, firstLaundryDayFrom, sameSchedule,
} = require('../laundrySchedule');
const { constantSchedule } = require('./laundry-schedule-fixtures');

// specs/linen-laundry-days.md §3.1 — the laundry schedule as a pure value.
// June 2026: Tuesdays are 02, 09, 16, 23, 30; Thursdays 04, 11, 18, 25.

const ERR = {
  empty: { code: 'LAUNDRY_WEEKDAYS_EMPTY', message: 'Au moins un jour.', field: 'weekdays' },
  weekday: { code: 'LAUNDRY_WEEKDAY_INVALID', message: 'Jour invalide.', field: 'weekdays' },
  turnaround: { code: 'LAUNDRY_TURNAROUND_INVALID', message: 'Entre 1 et 14 jours.', field: 'turnaroundDays' },
};

// --- Rule 1: what a schedule is -----------------------------------------------------------------

test('specs/linen-laundry-days.md §3.1 rule 1: a schedule is one to seven distinct weekdays and a turnaround from 1 to 14 days', () => {
  assert.ok(validateSchedule({ weekdays: [0], turnaroundDays: 1 }).value);
  assert.ok(validateSchedule({ weekdays: [0, 1, 2, 3, 4, 5, 6], turnaroundDays: 14 }).value);
  assert.ok(validateSchedule({ weekdays: [0, 1, 2, 3, 4, 5, 6, 0], turnaroundDays: 14 }).error, 'eight days cannot be distinct');
  const { cycle } = describeCycle({ weekdays: [2], turnaroundDays: 14 });
  assert.equal(cycle.length, 1, 'one cycle line per weekday');
});

// --- Rule 3: validation, nothing rounded -------------------------------------------------------

test('specs/linen-laundry-days.md §3.1 rule 3: a valid schedule is accepted and its weekdays sorted', () => {
  assert.deepEqual(validateSchedule({ weekdays: [4, 2], turnaroundDays: 2 }), { value: { weekdays: [2, 4], turnaroundDays: 2 } });
  assert.deepEqual(validateSchedule({ weekdays: [0, 1, 2, 3, 4, 5, 6], turnaroundDays: 14 }).value.weekdays, [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(validateSchedule({ weekdays: [2], turnaroundDays: 1 }).value, { weekdays: [2], turnaroundDays: 1 });
});

test('specs/linen-laundry-days.md §3.1 rule 3: an empty or missing set of weekdays is refused', () => {
  assert.deepEqual(validateSchedule({ weekdays: [], turnaroundDays: 1 }), { error: ERR.empty });
  assert.deepEqual(validateSchedule({ turnaroundDays: 1 }), { error: ERR.empty });
  assert.deepEqual(validateSchedule({ weekdays: '2', turnaroundDays: 1 }), { error: ERR.empty });
  assert.deepEqual(validateSchedule(null), { error: ERR.empty });
});

test('specs/linen-laundry-days.md §3.1 rule 3: a weekday outside 0..6, a duplicate or a non-integer is refused', () => {
  for (const weekdays of [[-1], [7], [2, 2], [2.5], ['mardi'], [null], [''], [2, 9], [true]]) {
    assert.deepEqual(validateSchedule({ weekdays, turnaroundDays: 1 }), { error: ERR.weekday }, JSON.stringify(weekdays));
  }
});

test('specs/linen-laundry-days.md §3.1 rule 3: a turnaround that is not an integer in 1..14 is refused, never rounded', () => {
  for (const turnaroundDays of [0, 15, -1, 2.5, 'abc', '', null, undefined, NaN, Infinity, true, [2]]) {
    assert.deepEqual(validateSchedule({ weekdays: [2], turnaroundDays }), { error: ERR.turnaround }, String(turnaroundDays));
  }
});

test('specs/linen-laundry-days.md §3.1 rule 3: the weekdays are checked before the turnaround', () => {
  assert.equal(validateSchedule({ weekdays: [], turnaroundDays: 0 }).error.code, 'LAUNDRY_WEEKDAYS_EMPTY');
});

test('specs/linen-laundry-days.md §3.1 rule 3: numeric strings of integers are accepted as those integers', () => {
  assert.deepEqual(validateSchedule({ weekdays: ['2', '4'], turnaroundDays: '3' }).value, { weekdays: [2, 4], turnaroundDays: 3 });
});

test('specs/linen-laundry-days.md §3.1 rule 3: sameSchedule compares the sets and the turnaround', () => {
  assert.equal(sameSchedule({ weekdays: [2, 4], turnaroundDays: 2 }, { weekdays: [2, 4], turnaroundDays: 2 }), true);
  assert.equal(sameSchedule({ weekdays: [2, 4], turnaroundDays: 2 }, { weekdays: [2], turnaroundDays: 2 }), false);
  assert.equal(sameSchedule({ weekdays: [2, 4], turnaroundDays: 2 }, { weekdays: [2, 4], turnaroundDays: 3 }), false);
});

// --- Rule 5: dated versions --------------------------------------------------------------------

const versions = [
  { effectiveFrom: '0001-01-01', weekdays: [2], turnaroundDays: 1 },
  { effectiveFrom: '2026-06-10', weekdays: [2, 4], turnaroundDays: 3 },
  { effectiveFrom: '2026-06-24', weekdays: [5], turnaroundDays: 2 },
];

test('specs/linen-laundry-days.md §3.1 rule 5: a date follows the version with the greatest effectiveFrom <= date', () => {
  const schedule = createSchedule(versions);
  assert.equal(schedule.versionOn('2026-06-09').weekdays.join(), '2');
  assert.equal(schedule.versionOn('2026-06-10').weekdays.join(), '2,4');   // effective on its own date
  assert.equal(schedule.versionOn('2026-06-23').weekdays.join(), '2,4');
  assert.equal(schedule.versionOn('2026-06-24').weekdays.join(), '5');
  assert.equal(schedule.versionOn('0001-01-01').weekdays.join(), '2');
  assert.equal(schedule.versionOn('2099-01-01').weekdays.join(), '5');
});

test('specs/linen-laundry-days.md §3.1 rule 5: the past keeps its rhythm — a Thursday before the change is not a laundry day', () => {
  const schedule = createSchedule(versions);
  assert.equal(schedule.isRegularDay('2026-06-04'), false);   // Thursday, still one weekday
  assert.equal(schedule.isRegularDay('2026-06-11'), true);    // Thursday, after the change
  assert.equal(schedule.isRegularDay('2026-06-09'), true);
  assert.equal(schedule.isRegularDay('2026-06-25'), false);   // Thursday, after the second change (Friday only)
  assert.equal(schedule.isRegularDay('2026-06-26'), true);
});

test('specs/linen-laundry-days.md §3.1 rule 5: versions given out of order are sorted', () => {
  const schedule = createSchedule([...versions].reverse());
  assert.equal(schedule.versionOn('2026-06-15').weekdays.join(), '2,4');
});

test('specs/linen-laundry-days.md §3.1 rule 5: regularDaysInRange lists the laundry days of each version, bounds inclusive', () => {
  const schedule = createSchedule(versions);
  assert.deepEqual(schedule.regularDaysInRange('2026-06-02', '2026-06-12'), ['2026-06-02', '2026-06-09', '2026-06-11']);
  assert.deepEqual(schedule.regularDaysInRange('2026-06-23', '2026-06-26'), ['2026-06-23', '2026-06-26']);
  assert.deepEqual(schedule.regularDaysInRange('2026-06-12', '2026-06-11'), []);
  assert.deepEqual(schedule.regularDaysInRange('2026-06-02', '2026-06-02'), ['2026-06-02']);
});

// --- Rule 6: readiness fixed at drop-off -------------------------------------------------------

test('specs/linen-laundry-days.md §3.1 rule 6: readyFrom is the drop date plus the turnaround of the version in force on that date', () => {
  const schedule = createSchedule(versions);
  assert.equal(schedule.readyFrom('2026-06-09'), '2026-06-10');   // turnaround 1
  assert.equal(schedule.readyFrom('2026-06-11'), '2026-06-14');   // turnaround 3
  assert.equal(schedule.readyFrom('2026-06-26'), '2026-06-28');   // turnaround 2
});

test('specs/linen-laundry-days.md §3.1 rule 6: a batch dropped under the old turnaround keeps its readiness once the turnaround is raised', () => {
  const schedule = createSchedule([
    { effectiveFrom: '0001-01-01', weekdays: [2], turnaroundDays: 1 },
    { effectiveFrom: '2026-06-03', weekdays: [2], turnaroundDays: 3 },
  ]);
  assert.equal(schedule.readyFrom('2026-06-02'), '2026-06-03');   // dropped before the change: still 1 day
  assert.equal(schedule.readyFrom('2026-06-09'), '2026-06-12');
});

test('specs/linen-laundry-days.md §3.1 rule 6: readyFrom crosses month and year ends', () => {
  const schedule = constantSchedule(2, 14);
  assert.equal(schedule.readyFrom('2026-12-29'), '2027-01-12');
});

// --- Rule 7: the cycle described by the server -------------------------------------------------

const cycleOf = (weekdays, turnaroundDays) => describeCycle({ weekdays, turnaroundDays });
const line = (dropWeekday, pickUpWeekday, waitDays) => ({ dropWeekday, pickUpWeekday, waitDays });

test('specs/linen-laundry-days.md §3.1 rule 7: Tuesday + Thursday, turnaround 1 — Tue→Thu in 2 days, Thu→Tue in 5', () => {
  assert.deepEqual(cycleOf([2, 4], 1), { cycle: [line(2, 4, 2), line(4, 2, 5)], longestWaitDays: 5 });
});

test('specs/linen-laundry-days.md §3.1 rule 7: Tuesday + Thursday, turnaround 2 — the same cycle, Thursday is exactly ready', () => {
  assert.deepEqual(cycleOf([2, 4], 2), { cycle: [line(2, 4, 2), line(4, 2, 5)], longestWaitDays: 5 });
});

test('specs/linen-laundry-days.md §3.1 rule 7: Tuesday + Thursday, turnaround 3 — both batches wait for the next Tuesday', () => {
  assert.deepEqual(cycleOf([2, 4], 3), { cycle: [line(2, 2, 7), line(4, 2, 5)], longestWaitDays: 7 });
});

test('specs/linen-laundry-days.md §3.1 rule 7: one weekday — the turnaround rounded up to whole weeks', () => {
  assert.deepEqual(cycleOf([2], 1), { cycle: [line(2, 2, 7)], longestWaitDays: 7 });
  assert.deepEqual(cycleOf([2], 7), { cycle: [line(2, 2, 7)], longestWaitDays: 7 });
  assert.deepEqual(cycleOf([2], 8), { cycle: [line(2, 2, 14)], longestWaitDays: 14 });
  assert.deepEqual(cycleOf([2], 10), { cycle: [line(2, 2, 14)], longestWaitDays: 14 });
  assert.deepEqual(cycleOf([2], 14), { cycle: [line(2, 2, 14)], longestWaitDays: 14 });
});

test('specs/linen-laundry-days.md §3.1 rule 7: all seven days, turnaround 1 — each drop comes back the next day', () => {
  const { cycle, longestWaitDays } = cycleOf([0, 1, 2, 3, 4, 5, 6], 1);
  assert.equal(cycle.length, 7);
  assert.ok(cycle.every((c) => c.waitDays === 1 && c.pickUpWeekday === (c.dropWeekday + 1) % 7));
  assert.equal(longestWaitDays, 1);
});

test('specs/linen-laundry-days.md §3.1 rule 7: the cycle wraps over the weekend (Friday → Monday) and lists days in weekday order', () => {
  assert.deepEqual(cycleOf([5, 1], 1), { cycle: [line(1, 5, 4), line(5, 1, 3)], longestWaitDays: 4 });
  assert.deepEqual(cycleOf([6, 0], 1).cycle, [line(0, 6, 6), line(6, 0, 1)]);
});

test('specs/linen-laundry-days.md §3.1 rule 7: firstLaundryDayFrom is the first laundry day on or after a date', () => {
  assert.equal(firstLaundryDayFrom('2026-06-02', [2, 4]), '2026-06-02');
  assert.equal(firstLaundryDayFrom('2026-06-03', [2, 4]), '2026-06-04');
  assert.equal(firstLaundryDayFrom('2026-06-05', [2, 4]), '2026-06-09');
  assert.equal(firstLaundryDayFrom('2026-06-05', [6]), '2026-06-06');
});
