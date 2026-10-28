const test = require('node:test');
const assert = require('node:assert/strict');

const { simulateInventory, ALL_TYPES } = require('../linenInventory');
const { createSchedule } = require('../laundrySchedule');
const { constantSchedule } = require('./laundry-schedule-fixtures');

// specs/linen-laundry-days.md §3.3 rules 15, 16 and 18 — the stock engine with several laundry days and a
// laundry turnaround. It also carries the appended rule 18 of specs/linen-inventory-shortage-tracking.md
// (the "week" of the initial state is the warm-up replay, whatever the rhythm).
//
// Calendar (June 2026): Tuesdays 02, 09, 16, 23, 30 — Thursdays 04, 11, 18, 25. 06-10 is a Wednesday.

const TUE = 2;
const THU = 4;

const BED_OPTION = {
  id: 100, countsAsBedLinen: 1, countsAsBathroomLinen: 0,
  linenIncludesSingle: 1, linenIncludesDouble: 1, linenIncludesBaby: 1,
  towelLargePerPerson: 0, towelMediumPerPerson: 0, towelSmallPerPerson: 0,
};

let nextId = 1;
const stay = (startDate, endDate, singleBeds, over = {}) => ({
  id: nextId++, kind: 'reservation', propertyId: 1, startDate, endDate, singleBeds, doubleBeds: 0, babyBeds: 0, adults: 2, teens: 0, children: 0, ...over,
});

function run({ schedule, stays, stock = 10, from = '2026-06-01', to = '2026-06-30', ...rest }) {
  return simulateInventory({
    stock: { single: stock, double: 0, baby: 0, large: 0, medium: 0, small: 0, bathMat: 0 },
    reservations: stays,
    options: [BED_OPTION],
    reservationOptions: stays.map((r) => ({ reservationId: r.id, optionId: 100, quantity: 1 })),
    propertyDefaults: [],
    schedule, from, to, ...rest,
  });
}

const day = (result, iso) => result.days.find((d) => d.date === iso);

function assertConservation(result, stock, ctx) {
  for (const d of result.days) {
    for (const t of ALL_TYPES) {
      const sum = d.clean[t] + d.inCirculation[t] + d.dirty[t] + d.atLaundry[t];
      assert.equal(sum, Number(stock[t] || 0), `${ctx}: conservation broken on ${d.date} for ${t}`);
      const batched = d.batches.reduce((s, b) => s + b.counts[t], 0);
      assert.equal(batched, d.atLaundry[t], `${ctx}: atLaundry is not the sum of its batches on ${d.date} for ${t}`);
    }
  }
}

// A busy month: back-to-back stays on Tue/Thu rhythm boundaries.
const month = () => [
  stay('2026-05-28', '2026-06-02', 2), stay('2026-06-01', '2026-06-04', 3), stay('2026-06-03', '2026-06-09', 2),
  stay('2026-06-04', '2026-06-06', 1), stay('2026-06-08', '2026-06-11', 4), stay('2026-06-10', '2026-06-16', 2),
  stay('2026-06-12', '2026-06-18', 3), stay('2026-06-17', '2026-06-23', 1), stay('2026-06-20', '2026-06-30', 2),
];

// --- Rule 15: atLaundry is a list of batches, ready after the turnaround ------------------------

test('specs/linen-laundry-days.md §3.3 rule 15: conservation holds every day of every rhythm and turnaround, every type', () => {
  const stock = { single: 12, double: 0, baby: 0, large: 0, medium: 0, small: 0, bathMat: 0 };
  const rhythms = [[TUE], [TUE, THU], [1, 3, 5], [0, 1, 2, 3, 4, 5, 6]];
  for (const weekdays of rhythms) {
    for (const turnaround of [1, 2, 3, 7, 14]) {
      const schedule = constantSchedule(weekdays, turnaround);
      const result = run({ schedule, stays: month(), stock: 12 });
      assertConservation(result, stock, `${weekdays} × ${turnaround}`);
    }
  }
});

test('specs/linen-laundry-days.md §3.3 rule 15: conservation also holds with a skip, a partial extra trip and manual lines', () => {
  const stock = { single: 12, double: 0, baby: 0, large: 0, medium: 0, small: 0, bathMat: 0 };
  const result = run({
    schedule: constantSchedule([TUE, THU], 3), stays: month(), stock: 12,
    skippedDates: new Set(['2026-06-09']),
    extraTripsByDate: new Map([['2026-06-13', { pickUpAll: false, pickUp: { single: 2 } }], ['2026-06-20', { pickUpAll: true, pickUp: {} }]]),
    manualAdditionsByDate: new Map([['2026-06-11', { single: 2 }], ['2026-06-16', { single: -1 }], ['2026-06-12', { single: 1 }]]),
  });
  assertConservation(result, stock, 'mixed');
});

test('specs/linen-laundry-days.md §3.3 rule 15: linen at the laundry before its readyFrom is not available — turnaround 3 makes the shortage a plain arithmetic of days', () => {
  // 3 singles in stock. A stay of 3 ends Tuesday 06-09; a new stay of 3 arrives Friday 06-12.
  const stays = [stay('2026-06-05', '2026-06-09', 3), stay('2026-06-12', '2026-06-14', 3)];
  // Turnaround 1: dropped Tue 06-09, back Thu 06-11 → clean for Friday.
  const quick = run({ schedule: constantSchedule([TUE, THU], 1), stays, stock: 3 });
  assert.equal(day(quick, '2026-06-11').clean.single, 3);
  assert.equal(day(quick, '2026-06-12').shortagesToday.length, 0);
  assert.equal(quick.shortagesByType.single.firstDate, null);
  // Turnaround 3: ready Friday 06-12 but nobody collects before Tuesday 06-16 → the arrival is short.
  const slow = run({ schedule: constantSchedule([TUE, THU], 3), stays, stock: 3 });
  assert.equal(day(slow, '2026-06-11').atLaundry.single, 3);
  assert.equal(day(slow, '2026-06-11').clean.single, 0);
  assert.deepEqual(day(slow, '2026-06-12').shortagesToday, [{ type: 'single', missing: 3 }]);
  assert.equal(slow.shortagesByType.single.firstDate, '2026-06-12');
  assert.equal(slow.shortagesByType.single.maxMissing, 3);
});

test('specs/linen-laundry-days.md §3.3 rule 15: a trip day collects the ready batches, then the check-ins, then drops the whole pile as a new batch with its readyFrom', () => {
  const stays = [stay('2026-06-05', '2026-06-09', 2), stay('2026-06-09', '2026-06-12', 1)];
  const result = run({ schedule: constantSchedule([TUE, THU], 2), stays, stock: 5 });
  const tue = day(result, '2026-06-09');
  assert.equal(tue.isTripDay, true);
  assert.deepEqual(tue.dropped.single, 2);
  assert.deepEqual(tue.pickedUp.single, 0);
  assert.deepEqual(tue.batches, [{ dropDate: '2026-06-09', readyFrom: '2026-06-11', counts: { single: 2, double: 0, baby: 0, large: 0, medium: 0, small: 0, bathMat: 0 } }]);
  assert.equal(tue.inCirculation.single, 1);   // the new stay checked in the same morning
  const thu = day(result, '2026-06-11');
  assert.equal(thu.pickedUp.single, 2);   // ready exactly on Thursday (turnaround 2)
  assert.deepEqual(thu.batches, []);
  assert.equal(thu.clean.single, 4);
});

test('specs/linen-laundry-days.md §3.3 rule 15: a day that is not a trip day moves nothing', () => {
  const result = run({ schedule: constantSchedule([TUE, THU], 1), stays: month(), stock: 12 });
  const wed = day(result, '2026-06-10');
  assert.equal(wed.isTripDay, false);
  assert.equal(wed.dropped.single, 0);
  assert.equal(wed.pickedUp.single, 0);
});

test('specs/linen-laundry-days.md §3.1 rule 6: a batch dropped under turnaround 1 is ready after 1 day even once the turnaround is raised', () => {
  const schedule = createSchedule([
    { effectiveFrom: '0001-01-01', weekdays: [TUE, THU], turnaroundDays: 1 },
    { effectiveFrom: '2026-06-10', weekdays: [TUE, THU], turnaroundDays: 3 },
  ]);
  const result = run({ schedule, stays: [stay('2026-06-05', '2026-06-09', 2), stay('2026-06-08', '2026-06-11', 1)], stock: 6 });
  assert.equal(day(result, '2026-06-09').batches[0].readyFrom, '2026-06-10');   // dropped under 1
  assert.equal(day(result, '2026-06-11').pickedUp.single, 2);                    // …so collected Thursday
  assert.equal(day(result, '2026-06-11').batches[0].readyFrom, '2026-06-14');    // dropped under 3
});

test('specs/linen-laundry-days.md §3.1 rule 5: the past keeps its rhythm — a Thursday before the change is no trip, after it is', () => {
  const schedule = createSchedule([
    { effectiveFrom: '0001-01-01', weekdays: [TUE], turnaroundDays: 1 },
    { effectiveFrom: '2026-06-10', weekdays: [TUE, THU], turnaroundDays: 1 },
  ]);
  const result = run({ schedule, stays: month(), stock: 12 });
  assert.equal(day(result, '2026-06-04').isTripDay, false);
  assert.equal(day(result, '2026-06-11').isTripDay, true);
});

test('specs/linen-laundry-days.md §3.2 rule 12: a skipped Tuesday with Tuesday + Thursday — the linen stays dirty until Thursday', () => {
  const stays = [stay('2026-06-05', '2026-06-09', 2)];
  const result = run({ schedule: constantSchedule([TUE, THU], 1), stays, stock: 5, skippedDates: new Set(['2026-06-09']) });
  assert.equal(day(result, '2026-06-09').dirty.single, 2);
  assert.equal(day(result, '2026-06-09').isTripDay, false);
  assert.equal(day(result, '2026-06-11').atLaundry.single, 2);   // dropped Thursday
  assert.equal(day(result, '2026-06-11').dirty.single, 0);
  assert.equal(day(result, '2026-06-16').clean.single, 5);
});

test('specs/linen-laundry-days.md §3.2 rule 12: an extra trip stored on a regular day is inert, and it wakes up when the schedule changes', () => {
  const stays = [stay('2026-06-05', '2026-06-09', 2)];
  const extras = new Map([['2026-06-11', { pickUpAll: false, pickUp: { single: 0 } }]]);
  const withThursday = run({ schedule: constantSchedule([TUE, THU], 1), stays, stock: 5, extraTripsByDate: extras });
  assert.deepEqual(withThursday.days, run({ schedule: constantSchedule([TUE, THU], 1), stays, stock: 5 }).days);
  const tuesdayOnly = run({ schedule: constantSchedule([TUE], 1), stays, stock: 5, extraTripsByDate: extras });
  assert.equal(day(tuesdayOnly, '2026-06-11').isTripDay, true);
  assert.equal(day(tuesdayOnly, '2026-06-11').pickedUp.single, 0);   // partial pick-up of nothing
});

test('specs/linen-laundry-days.md §3.3 rule 15: a manual line on a date that is not a laundry day still reaches the next trip', () => {
  // The operator left a line on Wednesday, then Thursday left the schedule: the line must not vanish.
  const result = run({
    schedule: constantSchedule([TUE], 1), stays: [stay('2026-06-05', '2026-06-09', 1)], stock: 5,
    manualAdditionsByDate: new Map([['2026-06-11', { single: 2 }]]),
  });
  assert.equal(day(result, '2026-06-11').dirty.single, 2);
  assert.equal(day(result, '2026-06-16').dropped.single, 2);
});

// --- Rule 16: the initial state is a replay -----------------------------------------------------

test('specs/linen-laundry-days.md §3.3 rule 16: the state on `from` is what the day-by-day replay gives — starting later changes nothing from there on', () => {
  const schedule = constantSchedule([TUE, THU], 3);
  const opts = { schedule, stays: month(), stock: 12, to: '2026-06-30', skippedDates: new Set(['2026-06-09']) };
  const early = run({ ...opts, from: '2026-05-20' });
  for (const from of ['2026-06-03', '2026-06-10', '2026-06-12', '2026-06-16', '2026-06-18']) {
    const late = run({ ...opts, from });
    assert.deepEqual(late.days, early.days.filter((d) => d.date >= from), `from ${from}`);
  }
});

test('specs/linen-laundry-days.md §3.3 rule 16: batches still at the laundry on `from` are all there, whatever their age', () => {
  // Turnaround 10 on Tuesdays: on Wednesday 06-17, the batches of 06-09 and 06-16 are both at the laundry.
  const stays = [stay('2026-06-01', '2026-06-09', 2), stay('2026-06-10', '2026-06-16', 3)];
  const result = run({ schedule: constantSchedule([TUE], 10), stays, stock: 10, from: '2026-06-17', to: '2026-06-30' });
  const d0 = result.days[0];
  assert.equal(d0.atLaundry.single, 5);
  assert.deepEqual(d0.batches.map((b) => [b.dropDate, b.readyFrom]), [['2026-06-09', '2026-06-19'], ['2026-06-16', '2026-06-26']]);
  assert.equal(day(result, '2026-06-23').pickedUp.single, 2);
});

test('specs/linen-laundry-days.md §3.3 rule 16: a trip day that is `from` collects like any other day — no special case', () => {
  const stays = [stay('2026-06-01', '2026-06-04', 2), stay('2026-06-05', '2026-06-09', 3)];
  const result = run({ schedule: constantSchedule([TUE, THU], 1), stays, stock: 8, from: '2026-06-09' });
  const d0 = result.days[0];
  assert.equal(d0.date, '2026-06-09');
  assert.equal(d0.pickedUp.single, 2);     // Thursday 06-04's batch, ready since 06-05, is collected on `from` itself
  assert.equal(d0.dropped.single, 3);
});

test('specs/linen-laundry-days.md §3.3 rule 16: days before `from` are neither emitted nor counted as shortages', () => {
  // Stock 1, a stay of 3 ends a week before `from`: that shortage is history.
  const stays = [stay('2026-05-25', '2026-05-30', 3)];
  const result = run({ schedule: constantSchedule([TUE], 1), stays, stock: 1, from: '2026-06-10', to: '2026-06-20' });
  assert.equal(result.days[0].date, '2026-06-10');
  assert.equal(result.shortagesByType.single.firstDate, null);
  assert.equal(result.shortagesByType.single.maxMissing, 0);
});

test('specs/linen-laundry-days.md §3.3 rule 16: the warm-up reaches 42 days back — a stay in progress at the start of it is installed, a skipped trip 4 weeks back still defers its linen', () => {
  // A long stay started before the warm-up: its linen is in circulation at `from`.
  const longStay = stay('2026-03-01', '2026-06-20', 4);
  const result = run({ schedule: constantSchedule([TUE], 1), stays: [longStay], stock: 6, from: '2026-06-10', to: '2026-06-25' });
  assert.equal(day(result, '2026-06-10').inCirculation.single, 4);
  assert.equal(day(result, '2026-06-10').clean.single, 2);
  assert.equal(day(result, '2026-06-21').dirty.single, 4);
  // Four skipped Tuesdays: the dirty pile of a stay ended 5 weeks earlier is still dirty on `from`.
  const skipped = new Set(['2026-05-19', '2026-05-26', '2026-06-02', '2026-06-09']);
  const dirty = run({ schedule: constantSchedule([TUE], 1), stays: [stay('2026-05-10', '2026-05-18', 2)], stock: 6, from: '2026-06-10', to: '2026-06-25', skippedDates: skipped });
  assert.equal(day(dirty, '2026-06-10').dirty.single, 2);
  assert.equal(day(dirty, '2026-06-16').dirty.single, 0);
});

// --- Rule 18: a shortage says when it ends ------------------------------------------------------

test('specs/linen-laundry-days.md §3.3 rule 18: recoversOn is the first day after the first shortage with a clean sheet for everyone again', () => {
  const stays = [stay('2026-06-05', '2026-06-09', 3), stay('2026-06-12', '2026-06-14', 3)];
  const slow = run({ schedule: constantSchedule([TUE, THU], 3), stays, stock: 3 });
  assert.equal(slow.shortagesByType.single.firstDate, '2026-06-12');
  assert.equal(slow.shortagesByType.single.recoversOn, '2026-06-16');   // the Tuesday that finally collects the batch
});

test('specs/linen-laundry-days.md §3.3 rule 18: recoversOn is null when the shortage lasts to the end of the horizon, and for a type that is not short', () => {
  const stays = [stay('2026-06-05', '2026-06-09', 3), stay('2026-06-12', '2026-06-14', 3)];
  const result = run({ schedule: constantSchedule([TUE, THU], 3), stays, stock: 3, to: '2026-06-14' });
  assert.equal(result.shortagesByType.single.firstDate, '2026-06-12');
  assert.equal(result.shortagesByType.single.recoversOn, null);
  assert.equal(result.shortagesByType.double.firstDate, null);
  assert.equal(result.shortagesByType.double.recoversOn, null);
});

test('specs/linen-laundry-days.md §3.3 rule 18: recoversOn stays the first recovery when the shortage comes back later', () => {
  const stays = [stay('2026-06-05', '2026-06-09', 3), stay('2026-06-12', '2026-06-14', 3), stay('2026-06-22', '2026-06-25', 5)];
  const result = run({ schedule: constantSchedule([TUE, THU], 3), stays, stock: 3 });
  assert.equal(result.shortagesByType.single.firstDate, '2026-06-12');
  assert.equal(result.shortagesByType.single.recoversOn, '2026-06-16');
  assert.ok(result.shortagesByType.single.maxMissing >= 2);
});

test('specs/linen-laundry-days.md §3.3 rule 18: a type with no stock is untracked — no shortage, no recovery', () => {
  const stays = [stay('2026-06-05', '2026-06-09', 3)];
  const result = run({ schedule: constantSchedule([TUE], 1), stays, stock: 0 });
  assert.equal(result.shortagesByType.single.firstDate, null);
  assert.equal(result.shortagesByType.single.recoversOn, null);
});
