const test = require('node:test');
const assert = require('node:assert/strict');

const { simulateInventory, ALL_TYPES } = require('../utils/linenInventory');

// specs/skip-laundry-trip.md §3.2 + §7.1 — engine-level coverage for the skip feature.
//
// A skip on date D means: don't pick up, don't drop off on D. The dirty stays dirty, the
// at-laundry stays at the laundry. At the next non-skipped trip D', the engine picks up
// every batch whose deposit date is ≤ D'−7 (the change from strict `=` to `<=` in the
// pickup lookup is the load-bearing edit that makes the deferred batch reachable).

// Helpers cloned from linen-inventory.unit.test.js — kept small + deterministic.
function makeStock(over = {}) {
  return { single: 0, double: 0, baby: 0, large: 0, medium: 0, small: 0, ...over };
}
function makeBedLinenOption(id, over = {}) {
  return {
    id, countsAsBedLinen: 1, countsAsBathroomLinen: 0,
    linenIncludesSingle: 1, linenIncludesDouble: 1, linenIncludesBaby: 1,
    towelLargePerPerson: 0, towelMediumPerPerson: 0, towelSmallPerPerson: 0,
    ...over,
  };
}
function assertConservation(result, stock, ctx = '') {
  for (const day of result.days) {
    for (const t of ALL_TYPES) {
      const sum = Number(day.clean[t]) + Number(day.inCirculation[t]) + Number(day.dirty[t]) + Number(day.atLaundry[t]);
      assert.equal(sum, Number(stock[t] || 0),
        `${ctx} conservation broken on ${day.date} for ${t} (clean+inCirc+dirty+atLaundry = ${sum}, stock = ${stock[t]})`);
    }
  }
}
const TUESDAY = 2;

// Shared fixture: 1 reservation 03→05 June (Wed–Fri checkout), 2 singles + 1 double, fixed
// stock of 10 each. Laundry trips fall on 09, 16, 23 June (Tuesdays). The dropoff of that
// reservation's bed linen lands at the trip on 09 June; the pickup would normally happen on
// 16 June. Used by every test below — only the `skippedDates` varies.
const RES = [{
  id: 1, kind: 'reservation', propertyId: 1,
  startDate: '2026-06-03', endDate: '2026-06-05',
  singleBeds: 2, doubleBeds: 1, babyBeds: 0,
  adults: 2, teens: 0, children: 0,
}];
const OPT = [makeBedLinenOption(100)];
const RO = [{ reservationId: 1, optionId: 100, quantity: 1 }];
const STOCK = makeStock({ single: 10, double: 10, baby: 10 });

function run(skippedDates, to = '2026-06-30') {
  return simulateInventory({
    stock: STOCK, reservations: RES, options: OPT, reservationOptions: RO, propertyDefaults: [],
    laundryWeekday: TUESDAY, from: '2026-06-01', to,
    skippedDates: skippedDates instanceof Set ? skippedDates : new Set(skippedDates || []),
  });
}

// --- Test 1: drop-off deferred when a trip is skipped ---

test('skip on 06-09 (laundry day) defers the drop-off — dirty stays dirty until 06-16', () => {
  const r = run(['2026-06-09']);
  // On 06-09, normally dropoff would clear dirty → atLaundry. With skip, dirty stays.
  const d0609 = r.days.find((d) => d.date === '2026-06-09');
  assert.equal(d0609.atLaundry.single, 0, 'no atLaundry on a skipped day');
  assert.equal(d0609.dirty.single, 2, 'dirty preserved on a skipped day');
  assert.equal(d0609.dirty.double, 1);

  // Between 06-10 and 06-15: dirty keeps the linen, atLaundry stays empty.
  const d0612 = r.days.find((d) => d.date === '2026-06-12');
  assert.equal(d0612.dirty.single, 2);
  assert.equal(d0612.atLaundry.single, 0);

  // On 06-16, NEXT non-skipped trip: dirty finally moves → atLaundry.
  const d0616 = r.days.find((d) => d.date === '2026-06-16');
  assert.equal(d0616.atLaundry.single, 2, 'atLaundry receives deferred drop on next non-skipped trip');
  assert.equal(d0616.dirty.single, 0);
  assertConservation(r, STOCK, '[skip-defer-drop]');
});

// --- Test 2: pick-up deferred when a trip is skipped ---

test('skip on 06-16 (laundry day) defers the pick-up — atLaundry stays at laundry until 06-23', () => {
  const r = run(['2026-06-16']);
  // 06-09 = drop, 06-16 = SKIPPED (normally pickup). atLaundry must persist.
  const d0616 = r.days.find((d) => d.date === '2026-06-16');
  assert.equal(d0616.atLaundry.single, 2, 'atLaundry preserved on a skipped day');
  assert.equal(d0616.atLaundry.double, 1);
  assert.equal(d0616.clean.single, 8, 'no pickup on skipped day → clean stays at post-drop level');

  // 06-23 = next non-skipped trip → pickup of the batch from 06-09 (= 14 days earlier, ≤ 16).
  const d0623 = r.days.find((d) => d.date === '2026-06-23');
  assert.equal(d0623.atLaundry.single, 0, 'deferred batch finally picked up');
  assert.equal(d0623.clean.single, 10);
  assert.equal(d0623.clean.double, 10);
  assertConservation(r, STOCK, '[skip-defer-pickup]');
});

// --- Test 3: conservation invariant holds across skips (regression net) ---

test('conservation invariant holds on EVERY day, across single + multi-skip horizons', () => {
  for (const skips of [
    [],
    ['2026-06-09'],
    ['2026-06-16'],
    ['2026-06-09', '2026-06-16'],
    ['2026-06-09', '2026-06-16', '2026-06-23'],
  ]) {
    const r = run(skips);
    assertConservation(r, STOCK, `[conservation skips=${skips.join(',')}]`);
  }
});

// --- Test 4: two consecutive skipped trips → 3 weeks of accumulation on the third ---

test('two consecutive skipped trips (06-09 + 06-16) → on 06-23 the dirty has finally drained', () => {
  const r = run(['2026-06-09', '2026-06-16']);
  // 06-09 dropoff skipped → dirty (2,1,0) stays.
  // 06-16 dropoff also skipped → still (2,1,0) because the SAME reservation produced it once;
  // a second reservation in the meantime would have added more. We only have one here.
  const d0616 = r.days.find((d) => d.date === '2026-06-16');
  assert.equal(d0616.dirty.single, 2);
  assert.equal(d0616.atLaundry.single, 0, 'never made it to the laundry');

  // 06-23 = next non-skipped trip → dirty finally lands at the laundry.
  const d0623 = r.days.find((d) => d.date === '2026-06-23');
  assert.equal(d0623.atLaundry.single, 2);
  assert.equal(d0623.dirty.single, 0);
  assertConservation(r, STOCK, '[2-consecutive-skips]');
});

// --- Test 5: skip on a non-laundry-weekday is silently inert ---

test('skip on 06-10 (Wed, NOT a laundry day) is silently inert — engine output identical to no-skip', () => {
  const baseline = run([]);
  const withInertSkip = run(['2026-06-10']);
  assert.deepEqual(
    withInertSkip.days.map((d) => ({ date: d.date, clean: d.clean })),
    baseline.days.map((d) => ({ date: d.date, clean: d.clean })),
    'a skip on a non-laundry-weekday must not change the simulation'
  );
  assertConservation(withInertSkip, STOCK, '[non-laundry-day-skip]');
});

// --- Test 6: empty skip set → output strictly identical to pre-feature ---

test('empty skip set: simulation output is byte-identical to the no-`skippedDates` call (pre-feature)', () => {
  // Two parallel calls: one with `skippedDates` argument omitted, one with `new Set()`.
  const withoutArg = simulateInventory({
    stock: STOCK, reservations: RES, options: OPT, reservationOptions: RO, propertyDefaults: [],
    laundryWeekday: TUESDAY, from: '2026-06-01', to: '2026-06-30',
  });
  const withEmptySet = run([]);
  assert.deepEqual(withEmptySet.days, withoutArg.days,
    'default `skippedDates = new Set()` must keep the no-arg call shape verbatim');
});

// --- Test 7: a PAST skip influences the initial state when `from` is after the skipped day ---

test('past skip — when `from` is after the skipped Tuesday, the initial state reflects the deferred dirty', () => {
  // Simulate from 06-15 (after the 06-09 trip date), with 06-09 marked skipped. The reservation
  // 06-03 → 06-05 should have produced dirty linen that was supposed to be dropped 06-09 but
  // wasn't. So at 06-15, dirty must still carry that linen — and on 06-16 (next Tuesday, not
  // skipped) the drop finally happens.
  const r = simulateInventory({
    stock: STOCK, reservations: RES, options: OPT, reservationOptions: RO, propertyDefaults: [],
    laundryWeekday: TUESDAY, from: '2026-06-15', to: '2026-06-30',
    skippedDates: new Set(['2026-06-09']),
  });

  // 06-15 (Mon) — initial state: dirty must carry the reservation's contract, because the
  // 06-09 drop was skipped. atLaundry must be 0 (no successful trip happened recently enough
  // to have anything still there).
  const d0615 = r.days.find((d) => d.date === '2026-06-15');
  assert.equal(d0615.dirty.single, 2, 'past skip surfaces as deferred dirty in the initial state');
  assert.equal(d0615.dirty.double, 1);
  assert.equal(d0615.atLaundry.single, 0);

  // 06-16 (Tue, not skipped) — the deferred dirty finally lands at the laundry.
  const d0616 = r.days.find((d) => d.date === '2026-06-16');
  assert.equal(d0616.atLaundry.single, 2);
  assert.equal(d0616.dirty.single, 0);

  assertConservation(r, STOCK, '[past-skip-from-after]');
});
