const test = require('node:test');
const assert = require('node:assert/strict');

const { createTripLedger, emptyBlock } = require('../laundryTripLedger');
const { createSchedule } = require('../laundrySchedule');
const { constantSchedule } = require('./laundry-schedule-fixtures');

// specs/linen-laundry-days.md §3.2 rules 8-12 — the trip ledger over a schedule of several weekdays and
// a laundry turnaround. It also carries the appended rules of specs/weekly-bed-linen-tracking.md rule 37,
// specs/skip-laundry-trip.md rule 15 and specs/laundry-extra-trip.md rule 21 (a skip or an extra trip
// follows the schedule of ITS date; with several weekdays the lookbacks walk day by day).
//
// Calendar (June 2026): Tuesdays 02, 09, 16, 23, 30 — Thursdays 04, 11, 18, 25. 06-10 is a Wednesday.

const TUE = 2;
const THU = 4;

const zeros = (over = {}) => ({ ...emptyBlock(), ...over });
const counts = ({ fromTrips, ...quantities }) => quantities;

// `drops` maps a trip date → the block its drop-off holds (whatever the window's start): the ledger is
// what is under test, not the SQL. Every window asked is recorded in `calls`.
function makeLedger({ schedule, drops = {}, skipped = [], extras = [], incompleteFn } = {}) {
  const calls = [];
  const buildBlock = (start, end) => { calls.push({ start, end }); return zeros(drops[end] || {}); };
  const incompleteCalls = [];
  const incompleteFor = incompleteFn || ((start, end) => { incompleteCalls.push({ start, end }); return []; });
  const ledger = createTripLedger({
    schedule, skippedDates: new Set(skipped), extraTrips: extras, buildBlock, incompleteFor,
  });
  return { ledger, calls, incompleteCalls };
}

const tueThu = (turnaroundDays = 1) => constantSchedule([TUE, THU], turnaroundDays);

// --- Rule 2: every laundry day is one visit ----------------------------------------------------

test('specs/linen-laundry-days.md §3.1 rule 2: every laundry day brings the dirty linen AND collects what is ready — no drop-only or pick-up-only day', () => {
  const { ledger } = makeLedger({ schedule: tueThu(1), drops: { '2026-06-09': { singleBeds: 2 }, '2026-06-11': { doubleBeds: 3 } } });
  const thu = ledger.entryFor('2026-06-11');
  assert.deepEqual(thu.dropOff, { ...zeros({ doubleBeds: 3 }), incomplete: [] });
  assert.deepEqual(counts(thu.pickUp), zeros({ singleBeds: 2 }));
  assert.deepEqual(ledger.entryFor('2026-06-16').pickUp.fromTrips, ['2026-06-11']);
});

// --- Rule 8: the trip sequence of several weekdays ---------------------------------------------

test('specs/linen-laundry-days.md §3.2 rule 8: with Tuesday + Thursday a trip window runs back to the previous laundry day, 2 or 5 days', () => {
  const { ledger, calls } = makeLedger({ schedule: tueThu() });
  assert.equal(ledger.prevTrip('2026-06-11'), '2026-06-09');   // Thursday → Tuesday
  assert.equal(ledger.prevTrip('2026-06-16'), '2026-06-11');   // Tuesday → Thursday
  ledger.entryFor('2026-06-11');
  assert.deepEqual(calls[0], { start: '2026-06-09', end: '2026-06-11' });
});

test('specs/linen-laundry-days.md §3.2 rule 9: Thursday carries the departures of Wednesday and Thursday, Tuesday those of Friday to Tuesday', () => {
  const { ledger, calls, incompleteCalls } = makeLedger({ schedule: tueThu() });
  ledger.entryFor('2026-06-11');
  ledger.entryFor('2026-06-16');
  assert.deepEqual(calls.filter((c) => c.end === '2026-06-11')[0], { start: '2026-06-09', end: '2026-06-11' });   // (Tue, Thu] = Wed + Thu
  assert.deepEqual(calls.filter((c) => c.end === '2026-06-16')[0], { start: '2026-06-11', end: '2026-06-16' });   // (Thu, Tue] = Fri … Tue
  assert.deepEqual(incompleteCalls, [{ start: '2026-06-09', end: '2026-06-11' }, { start: '2026-06-11', end: '2026-06-16' }]);
});

test('specs/linen-laundry-days.md §3.2 rule 8: only a date of the schedule is a trip — a Wednesday has no card', () => {
  const { ledger } = makeLedger({ schedule: tueThu() });
  assert.equal(ledger.entryFor('2026-06-10'), null);
  assert.equal(ledger.entryFor('2026-06-09').kind, 'regular');
  assert.equal(ledger.entryFor('2026-06-11').kind, 'regular');
});

test('specs/linen-laundry-days.md §3.2 rule 8: the walk reaches back 28 days and no further', () => {
  const tuesdays = constantSchedule([TUE]);
  // Weekly trips, the four Tuesdays before 06-16 skipped: the 28-day lookback ends on 05-19 (skipped too).
  const { ledger } = makeLedger({ schedule: tuesdays, skipped: ['2026-06-09', '2026-06-02', '2026-05-26', '2026-05-19'] });
  assert.equal(ledger.prevTrip('2026-06-16'), '2026-06-09');   // none within 28 days → the historical T − 7
  const reachable = makeLedger({ schedule: tuesdays, skipped: ['2026-06-09', '2026-06-02', '2026-05-26'] });
  assert.equal(reachable.ledger.prevTrip('2026-06-16'), '2026-05-19');   // exactly 28 days back is inside the lookback
});

test('specs/linen-laundry-days.md §3.2 rule 8: with Tuesday + Thursday the fallback is T − 7 as well when every trip of the lookback is skipped', () => {
  const skipped = [];
  for (let d = new Date('2026-05-12T00:00:00Z'); d < new Date('2026-06-11T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
    if ([TUE, THU].includes(d.getUTCDay())) skipped.push(d.toISOString().slice(0, 10));
  }
  const { ledger } = makeLedger({ schedule: tueThu(), skipped });
  assert.equal(ledger.prevTrip('2026-06-11'), '2026-06-04');
});

// --- Rule 10: pick-up = the batches that are ready ----------------------------------------------

test('specs/linen-laundry-days.md §3.2 rule 10: turnaround 1 — Thursday collects Tuesday\'s batch, Tuesday collects Thursday\'s', () => {
  const { ledger } = makeLedger({ schedule: tueThu(1), drops: {
    '2026-06-04': { singleBeds: 1 }, '2026-06-09': { singleBeds: 2 }, '2026-06-11': { singleBeds: 3 }, '2026-06-16': { singleBeds: 4 },
  } });
  const thu = ledger.entryFor('2026-06-11');
  assert.deepEqual(counts(thu.pickUp), zeros({ singleBeds: 2 }));
  assert.deepEqual(thu.pickUp.fromTrips, ['2026-06-09']);
  assert.deepEqual(thu.stillAtLaundry, []);
  const tue = ledger.entryFor('2026-06-16');
  assert.deepEqual(counts(tue.pickUp), zeros({ singleBeds: 3 }));
  assert.deepEqual(tue.pickUp.fromTrips, ['2026-06-11']);
});

test('specs/linen-laundry-days.md §3.2 rule 10: turnaround 3 — Tuesday\'s batch is not ready on Thursday and waits for the next Tuesday', () => {
  const { ledger } = makeLedger({ schedule: tueThu(3), drops: {
    '2026-06-02': { singleBeds: 1 }, '2026-06-04': { doubleBeds: 1 }, '2026-06-09': { singleBeds: 2 }, '2026-06-11': { singleBeds: 3 }, '2026-06-16': { singleBeds: 4 },
  } });
  // Thursday 06-04's batch (ready Sun 06-07) went back on Tuesday 06-09. On Thursday 06-11 the Tuesday batch
  // (2 singles, ready Fri 06-12) is not collectable: with turnaround 3 a Thursday never collects anything.
  const thu = ledger.entryFor('2026-06-11');
  assert.deepEqual(counts(ledger.entryFor('2026-06-09').pickUp), zeros({ singleBeds: 1, doubleBeds: 1 }));
  assert.deepEqual(ledger.entryFor('2026-06-09').pickUp.fromTrips, ['2026-06-02', '2026-06-04']);
  assert.deepEqual(counts(thu.pickUp), zeros());
  assert.deepEqual(thu.pickUp.fromTrips, []);
  assert.deepEqual(thu.stillAtLaundry, [{ counts: zeros({ singleBeds: 2 }), readyOn: '2026-06-12' }]);
  // Tuesday 06-16 collects both Tuesday 06-09 and Thursday 06-11 (ready Sun 06-14), oldest first.
  const tue = ledger.entryFor('2026-06-16');
  assert.deepEqual(counts(tue.pickUp), zeros({ singleBeds: 5 }));
  assert.deepEqual(tue.pickUp.fromTrips, ['2026-06-09', '2026-06-11']);
  assert.deepEqual(tue.stillAtLaundry, []);
});

test('specs/linen-laundry-days.md §3.2 rule 10: a Thursday with nothing to collect still shows what it brings and what stays', () => {
  const { ledger } = makeLedger({ schedule: tueThu(3), drops: { '2026-06-09': { singleBeds: 2 }, '2026-06-11': { singleBeds: 1 } } });
  const thu = ledger.entryFor('2026-06-11');
  assert.deepEqual(counts(thu.pickUp), zeros());
  assert.deepEqual(thu.pickUp.fromTrips, []);
  assert.deepEqual(thu.dropOff, { ...zeros({ singleBeds: 1 }), incomplete: [] });
  assert.deepEqual(thu.stillAtLaundry, [{ counts: zeros({ singleBeds: 2 }), readyOn: '2026-06-12' }]);
});

test('specs/linen-laundry-days.md §3.2 rule 11: stillAtLaundry never counts the trip\'s own drop, and readyOn is the earliest of what stays', () => {
  const { ledger } = makeLedger({ schedule: constantSchedule([TUE], 10), drops: {
    '2026-06-02': { singleBeds: 1 }, '2026-06-09': { singleBeds: 2 }, '2026-06-16': { singleBeds: 4 },
  } });
  // Turnaround 10 on a weekly rhythm: a batch waits two weeks.
  const tue16 = ledger.entryFor('2026-06-16');
  assert.deepEqual(tue16.pickUp.fromTrips, ['2026-06-02']);
  assert.deepEqual(counts(tue16.pickUp), zeros({ singleBeds: 1 }));
  assert.deepEqual(tue16.stillAtLaundry, [{ counts: zeros({ singleBeds: 2 }), readyOn: '2026-06-19' }]);   // not the 4 dropped today
});

test('specs/linen-laundry-days.md §3.2 rule 11: batches ready on different days make one line each, soonest first — never added up under one date', () => {
  const { ledger } = makeLedger({ schedule: tueThu(3), drops: { '2026-06-09': { singleBeds: 2 }, '2026-06-11': { doubleBeds: 1 }, '2026-06-16': { largeTowels: 9 } } });
  // Tuesday 06-16 collects both earlier batches (ready 06-12 and 06-14): nothing stays.
  assert.deepEqual(ledger.entryFor('2026-06-16').stillAtLaundry, []);
  // Thursday 06-11: only Tuesday's batch (ready 06-12) is at the laundry.
  const { ledger: slow } = makeLedger({ schedule: constantSchedule([TUE, THU], 5), drops: { '2026-06-04': { singleBeds: 1 }, '2026-06-09': { doubleBeds: 2 } } });
  // Turnaround 5: Thursday's 06-04 batch is ready Tue 06-09 (collected), Tuesday's 06-09 batch is ready Sun 06-14.
  const thu = slow.entryFor('2026-06-11');
  assert.deepEqual(thu.stillAtLaundry, [{ counts: zeros({ doubleBeds: 2 }), readyOn: '2026-06-14' }]);
  const { ledger: two } = makeLedger({ schedule: constantSchedule([TUE, THU], 4), drops: { '2026-06-09': { doubleBeds: 2 }, '2026-06-11': { singleBeds: 3 } } });
  const next = two.entryFor('2026-06-12') || two.entryFor('2026-06-16');
  assert.deepEqual(next.stillAtLaundry.map((l) => l.readyOn), [...next.stillAtLaundry.map((l) => l.readyOn)].sort());
});

test('specs/linen-laundry-days.md §3.2 rule 11: an empty drop leaves no batch behind', () => {
  const { ledger } = makeLedger({ schedule: tueThu(3), drops: { '2026-06-11': { singleBeds: 1 } } });
  assert.deepEqual(ledger.entryFor('2026-06-16').stillAtLaundry, []);
  assert.deepEqual(ledger.entryFor('2026-06-11').stillAtLaundry, []);
});

test('specs/linen-laundry-days.md §3.1 rule 6: a batch dropped under turnaround 1 is ready after 1 day even once the turnaround is raised', () => {
  const schedule = createSchedule([
    { effectiveFrom: '0001-01-01', weekdays: [TUE, THU], turnaroundDays: 1 },
    { effectiveFrom: '2026-06-10', weekdays: [TUE, THU], turnaroundDays: 3 },
  ]);
  const { ledger } = makeLedger({ schedule, drops: { '2026-06-09': { singleBeds: 2 }, '2026-06-11': { doubleBeds: 1 } } });
  // Thursday 06-11 is under turnaround 3 but collects Tuesday's batch, dropped under turnaround 1.
  const thu = ledger.entryFor('2026-06-11');
  assert.deepEqual(counts(thu.pickUp), zeros({ singleBeds: 2 }));
  // Tuesday 06-16 collects Thursday's batch (dropped under 3: ready 06-14).
  assert.deepEqual(counts(ledger.entryFor('2026-06-16').pickUp), zeros({ doubleBeds: 1 }));
});

// --- Rule 12: skips and extra trips follow the schedule of their date ----------------------------

test('specs/linen-laundry-days.md §3.2 rule 12: a skipped Tuesday with Tuesday + Thursday — Thursday brings the linen since the previous Thursday and collects every ready batch', () => {
  const { ledger, calls } = makeLedger({ schedule: tueThu(3), skipped: ['2026-06-09'], drops: {
    '2026-06-04': { singleBeds: 1 }, '2026-06-11': { singleBeds: 5 },
  } });
  const tue = ledger.entryFor('2026-06-09');
  assert.deepEqual(counts(tue.pickUp), zeros());
  assert.deepEqual(tue.dropOff, { ...zeros(), incomplete: [] });
  assert.deepEqual(tue.stillAtLaundry, []);
  const thu = ledger.entryFor('2026-06-11');
  assert.deepEqual(calls.filter((c) => c.end === '2026-06-11')[0], { start: '2026-06-04', end: '2026-06-11' });
  assert.deepEqual(counts(thu.pickUp), zeros({ singleBeds: 1 }));   // Thursday 06-04's batch, ready 06-07
  assert.deepEqual(thu.pickUp.fromTrips, ['2026-06-04']);
});

test('specs/linen-laundry-days.md §3.2 rule 12: an extra trip stored on a regular day of the schedule in force is inert, whatever the weekday', () => {
  const extras = [{ date: '2026-06-11', pickUpAll: false, pickUp: { singleBeds: 0 } }];
  const withThursday = makeLedger({ schedule: tueThu(), extras });
  assert.equal(withThursday.ledger.isActiveExtra('2026-06-11'), false);
  assert.deepEqual(withThursday.ledger.extraDates, []);
  assert.equal(withThursday.ledger.entryFor('2026-06-11').kind, 'regular');
  assert.equal('pickUpAll' in withThursday.ledger.entryFor('2026-06-11'), false);
  // Take Thursday out of the schedule and the stored extra trip comes back to life.
  const tuesdayOnly = makeLedger({ schedule: constantSchedule([TUE]), extras });
  assert.equal(tuesdayOnly.ledger.isActiveExtra('2026-06-11'), true);
  assert.deepEqual(tuesdayOnly.ledger.extraDates, ['2026-06-11']);
  assert.equal(tuesdayOnly.ledger.entryFor('2026-06-11').kind, 'extra');
});

test('specs/linen-laundry-days.md §3.2 rule 12: a change of schedule applies from its date — an extra trip before it stays active, the same weekday after it is inert', () => {
  const schedule = createSchedule([
    { effectiveFrom: '0001-01-01', weekdays: [TUE], turnaroundDays: 1 },
    { effectiveFrom: '2026-06-10', weekdays: [TUE, THU], turnaroundDays: 1 },
  ]);
  const extras = [{ date: '2026-06-04', pickUpAll: true, pickUp: {} }, { date: '2026-06-11', pickUpAll: true, pickUp: {} }];
  const { ledger } = makeLedger({ schedule, extras });
  assert.equal(ledger.entryFor('2026-06-04').kind, 'extra');     // Thursday before the change: free date
  assert.equal(ledger.entryFor('2026-06-11').kind, 'regular');   // Thursday after the change: a regular trip
  assert.deepEqual(ledger.extraDates, ['2026-06-04']);
});

test('specs/linen-laundry-days.md §3.2 rule 12: a skip on a date that is no longer a regular day stays inert', () => {
  const { ledger } = makeLedger({ schedule: constantSchedule([TUE]), skipped: ['2026-06-11'], drops: { '2026-06-09': { singleBeds: 1 } } });
  assert.equal(ledger.entryFor('2026-06-11'), null);
  assert.equal(ledger.prevTrip('2026-06-16'), '2026-06-09');
});

test('specs/linen-laundry-days.md §3.2 rule 10: a partial extra trip collects min(ready, declared) per type, oldest batch first, and leaves the rest', () => {
  // Tuesday-only, turnaround 1. Wednesday 06-10 is an extra trip that collects nothing (it only drops, so its
  // batch B is ready 06-11); Friday 06-12 is the partial one: both A (Tuesday 06-09) and B are ready.
  const extras = [
    { date: '2026-06-10', pickUpAll: false, pickUp: {} },
    { date: '2026-06-12', pickUpAll: false, pickUp: { singleBeds: 3, doubleBeds: 9 } },
  ];
  const { ledger } = makeLedger({ schedule: constantSchedule([TUE]), extras, drops: {
    '2026-06-09': { singleBeds: 2, largeTowels: 5 }, '2026-06-10': { singleBeds: 1, doubleBeds: 1 }, '2026-06-12': { babyBeds: 1 },
  } });
  const extra = ledger.entryFor('2026-06-12');
  assert.equal(extra.kind, 'extra');
  assert.equal(extra.pickUpAll, false);
  // 3 singles requested, oldest first: 2 from A + 1 from B; the 9 doubles are capped at the 1 there.
  assert.deepEqual(counts(extra.pickUp), zeros({ singleBeds: 3, doubleBeds: 1 }));
  assert.deepEqual(extra.pickUp.fromTrips, ['2026-06-09', '2026-06-10']);
  assert.deepEqual(extra.leftAtLaundry, zeros({ largeTowels: 5 }));
  assert.deepEqual(extra.stillAtLaundry, [], 'a partial extra trip says what it leaves through leftAtLaundry, not a « prêt le » line');
  // Tuesday 06-16 collects what is left of A and the extra trip's own drop.
  const tue = ledger.entryFor('2026-06-16');
  assert.deepEqual(counts(tue.pickUp), zeros({ largeTowels: 5, babyBeds: 1 }));
  assert.deepEqual(tue.pickUp.fromTrips, ['2026-06-09', '2026-06-12']);
});

test('specs/linen-laundry-days.md §3.2 rule 10: an extra trip that takes everything collects every ready batch but leaves the ones still at the laundry', () => {
  // Tuesday + Thursday, turnaround 2: Thursday 06-11's batch is ready Saturday 06-13.
  const extras = [{ date: '2026-06-13', pickUpAll: true, pickUp: {} }, { date: '2026-06-14', pickUpAll: true, pickUp: {} }];
  const { ledger } = makeLedger({ schedule: tueThu(2), extras, drops: { '2026-06-11': { singleBeds: 2 }, '2026-06-13': { doubleBeds: 1 } } });
  const saturday = ledger.entryFor('2026-06-13');
  assert.deepEqual(counts(saturday.pickUp), zeros({ singleBeds: 2 }));
  assert.deepEqual(saturday.leftAtLaundry, zeros());
  // Sunday: nothing is ready (Saturday's batch comes back Monday 06-15), and the card says when.
  const sunday = ledger.entryFor('2026-06-14');
  assert.deepEqual(counts(sunday.pickUp), zeros());
  assert.deepEqual(sunday.leftAtLaundry, zeros({ doubleBeds: 1 }));
  assert.deepEqual(sunday.stillAtLaundry, [{ counts: zeros({ doubleBeds: 1 }), readyOn: '2026-06-15' }]);
});

test('specs/linen-laundry-days.md §3.2 rule 10: the extra-trip preview offers what is READY on that date', () => {
  const { ledger } = makeLedger({ schedule: tueThu(2), drops: { '2026-06-11': { singleBeds: 2 }, '2026-06-14': { doubleBeds: 1 } } });
  // Sunday 06-14: Thursday's batch is ready since Saturday.
  assert.deepEqual(ledger.previewFor('2026-06-14'), { dropOff: zeros({ doubleBeds: 1 }), atLaundry: zeros({ singleBeds: 2 }) });
  // Friday 06-12: it is not ready yet.
  assert.deepEqual(ledger.previewFor('2026-06-12').atLaundry, zeros());
});

test('specs/linen-laundry-days.md §3.2 rule 10: every day a laundry day with turnaround 1 — each drop comes back the next day', () => {
  const { ledger } = makeLedger({ schedule: constantSchedule([0, 1, 2, 3, 4, 5, 6], 1), drops: {
    '2026-06-09': { singleBeds: 1 }, '2026-06-10': { singleBeds: 2 }, '2026-06-11': { singleBeds: 3 },
  } });
  assert.deepEqual(counts(ledger.entryFor('2026-06-10').pickUp), zeros({ singleBeds: 1 }));
  assert.deepEqual(counts(ledger.entryFor('2026-06-11').pickUp), zeros({ singleBeds: 2 }));
  assert.equal(ledger.prevTrip('2026-06-11'), '2026-06-10');
});

test('specs/linen-laundry-days.md §3.1 rule 5: a version change mid-month — the past keeps its Tuesday-only rhythm', () => {
  const schedule = createSchedule([
    { effectiveFrom: '0001-01-01', weekdays: [TUE], turnaroundDays: 1 },
    { effectiveFrom: '2026-06-10', weekdays: [TUE, THU], turnaroundDays: 1 },
  ]);
  const { ledger, calls } = makeLedger({ schedule });
  assert.equal(ledger.entryFor('2026-06-04'), null);   // a Thursday of the past: no card
  assert.equal(ledger.prevTrip('2026-06-09'), '2026-06-02');   // Tuesday 06-09 still brings a full week
  assert.equal(ledger.prevTrip('2026-06-16'), '2026-06-11');   // …and from the change on, Thursdays count
  ledger.entryFor('2026-06-09');
  assert.deepEqual(calls[0], { start: '2026-06-02', end: '2026-06-09' });
});

test('specs/linen-laundry-days.md §3.2 rule 10: a turnaround of 14 on one weekday — a batch is collected two weeks later', () => {
  const { ledger } = makeLedger({ schedule: constantSchedule([TUE], 14), drops: { '2026-06-02': { singleBeds: 1 }, '2026-06-09': { singleBeds: 2 } } });
  const tue16 = ledger.entryFor('2026-06-16');
  assert.deepEqual(counts(tue16.pickUp), zeros({ singleBeds: 1 }));   // 06-02 + 14 = 06-16
  assert.deepEqual(tue16.stillAtLaundry, [{ counts: zeros({ singleBeds: 2 }), readyOn: '2026-06-23' }]);
  assert.deepEqual(counts(ledger.entryFor('2026-06-23').pickUp), zeros({ singleBeds: 2 }));
});

test('specs/linen-laundry-days.md §3.2 rule 11: with a long turnaround a batch dropped before a skipped trip is still found', () => {
  const { ledger } = makeLedger({ schedule: constantSchedule([TUE], 10), skipped: ['2026-06-16'], drops: { '2026-06-02': { singleBeds: 1 }, '2026-06-09': { singleBeds: 2 } } });
  // 06-16 is skipped, so 06-23 is the first trip where 06-09's batch (ready 06-19) can be collected.
  const tue23 = ledger.entryFor('2026-06-23');
  assert.deepEqual(counts(tue23.pickUp), zeros({ singleBeds: 3 }));
  assert.deepEqual(tue23.pickUp.fromTrips, ['2026-06-02', '2026-06-09']);
});
