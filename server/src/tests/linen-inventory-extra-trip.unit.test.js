const test = require('node:test');
const assert = require('node:assert/strict');

const { simulateInventory, ALL_TYPES } = require('../utils/linenInventory');

// specs/laundry-extra-trip.md §3.3 + §7 — engine-level coverage for extra laundry trips.
//
// An extra trip on a free date D: before the check-ins, the whole at-laundry POOL comes back
// (or the declared per-type quantities, capped at the pool); then the whole dirty pile is dropped.
// The next regular trip takes back everything left at the laundry.

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
const day = (result, iso) => result.days.find((d) => d.date === iso);
const TUESDAY = 2;

// Calendar: 2026-06-02 / 06-09 / 06-16 / 06-23 are Tuesdays (laundry days); 06-11 is a Thursday.
// Fixture: reservation A 06-03→06-05 (2 singles + 1 double) → dropped at the 06-09 trip, normally
// back on 06-16. Reservation B 06-08→06-10 (1 single) → dirty after 06-09, normally dropped 06-16.
const RES_A = { id: 1, kind: 'reservation', propertyId: 1, startDate: '2026-06-03', endDate: '2026-06-05', singleBeds: 2, doubleBeds: 1, babyBeds: 0, adults: 2, teens: 0, children: 0 };
const RES_B = { id: 2, kind: 'reservation', propertyId: 1, startDate: '2026-06-08', endDate: '2026-06-10', singleBeds: 1, doubleBeds: 0, babyBeds: 0, adults: 1, teens: 0, children: 0 };
const OPT = [makeBedLinenOption(100)];
const RO = [{ reservationId: 1, optionId: 100, quantity: 1 }, { reservationId: 2, optionId: 100, quantity: 1 }];
const STOCK = makeStock({ single: 10, double: 10, baby: 10 });

function run({ extraTrips = new Map(), skippedDates = new Set(), from = '2026-06-01', to = '2026-06-30', reservations = [RES_A, RES_B] } = {}) {
  return simulateInventory({
    stock: STOCK, reservations, options: OPT, reservationOptions: RO, propertyDefaults: [],
    laundryWeekday: TUESDAY, from, to, skippedDates, extraTripsByDate: extraTrips,
  });
}

test('baseline without extra trips: A at the laundry from 06-09 to 06-16, B dirty until 06-16', () => {
  const r = run();
  assert.deepEqual([day(r, '2026-06-11').atLaundry.single, day(r, '2026-06-11').atLaundry.double], [2, 1]);
  assert.equal(day(r, '2026-06-11').dirty.single, 1);
  assert.equal(day(r, '2026-06-16').atLaundry.single, 1);   // B dropped on 06-16, A back
  assert.equal(day(r, '2026-06-16').clean.single, 9);
  assert.equal(day(r, '2026-06-11').isTripDay, false);
  assert.equal(day(r, '2026-06-09').isTripDay, true);
  assertConservation(r, STOCK, 'baseline');
});

test('extra trip on 06-11 (pickUpAll): the whole pool comes back that day and the dirty pile goes (rules 11-12)', () => {
  const r = run({ extraTrips: new Map([['2026-06-11', { pickUpAll: true, pickUp: {} }]]) });
  const d = day(r, '2026-06-11');
  assert.equal(d.isTripDay, true);
  // A (2 singles + 1 double) is back clean; B (1 single) went to the laundry; nothing dirty.
  assert.equal(d.atLaundry.single, 1);
  assert.equal(d.atLaundry.double, 0);
  assert.equal(d.dirty.single, 0);
  assert.equal(d.clean.single, 9);
  assert.equal(d.clean.double, 10);
  // Next regular trip 06-16 takes B back (< 7 days at the laundry — decision 2026-08-19).
  assert.equal(day(r, '2026-06-16').atLaundry.single, 0);
  assert.equal(day(r, '2026-06-16').clean.single, 10);
  assertConservation(r, STOCK, 'pickUpAll');
});

test('extra trip partial pick-up: capped per type, the remainder stays and returns on the next regular trip', () => {
  // Declares 1 single (of 2 at the laundry) and 5 doubles (only 1 there → capped).
  const r = run({ extraTrips: new Map([['2026-06-11', { pickUpAll: false, pickUp: { single: 1, double: 5 } }]]) });
  const d = day(r, '2026-06-11');
  // Pool before: A = 2 singles + 1 double. Picked: 1 single + 1 double. Then B's single dropped.
  assert.equal(d.atLaundry.single, 2);   // 1 remainder + 1 from B
  assert.equal(d.atLaundry.double, 0);
  assert.equal(d.clean.single, 8);
  assert.equal(d.clean.double, 10);
  // 06-16 takes everything left (remainder + B).
  assert.equal(day(r, '2026-06-16').atLaundry.single, 0);
  assert.equal(day(r, '2026-06-16').clean.single, 10);
  assertConservation(r, STOCK, 'partial');
});

test('pick-up happens BEFORE the check-ins of the extra day (rule 11 / inventory rule 6)', () => {
  // Reservation C arrives on 06-11 and needs 9 singles: only 7 clean before the pick-up (10 − 2 at
  // laundry − 1 dirty) → the 2 singles coming back that morning make it fit.
  const RES_C = { id: 3, kind: 'reservation', propertyId: 1, startDate: '2026-06-11', endDate: '2026-06-13', singleBeds: 9, doubleBeds: 0, babyBeds: 0, adults: 2, teens: 0, children: 0 };
  const r = simulateInventory({
    stock: STOCK, reservations: [RES_A, RES_B, RES_C], options: OPT,
    reservationOptions: [...RO, { reservationId: 3, optionId: 100, quantity: 1 }], propertyDefaults: [],
    laundryWeekday: TUESDAY, from: '2026-06-01', to: '2026-06-30',
    extraTripsByDate: new Map([['2026-06-11', { pickUpAll: true, pickUp: {} }]]),
  });
  const d = day(r, '2026-06-11');
  assert.equal(d.shortagesToday.length, 0);
  assert.equal(d.clean.single, 0);   // 10 − 9 in circulation − 1 (B at the laundry)
  assertConservation(r, STOCK, 'before check-ins');
});

test('an extra trip stored on the laundry weekday is inert (rule 2)', () => {
  const baseline = run();
  const r = run({ extraTrips: new Map([['2026-06-09', { pickUpAll: false, pickUp: { single: 0 } }]]) });
  assert.deepEqual(r.days, baseline.days);
});

test('no extra trip: engine output identical to the pre-feature baseline (default parameter)', () => {
  const withDefault = simulateInventory({
    stock: STOCK, reservations: [RES_A, RES_B], options: OPT, reservationOptions: RO, propertyDefaults: [],
    laundryWeekday: TUESDAY, from: '2026-06-01', to: '2026-06-30',
  });
  assert.deepEqual(run().days, withDefault.days);
});

test('initial state replays a past extra trip (pickUpAll) between the last regular trip and today (rule 13)', () => {
  // today = 06-12 (Fri). Last regular trip = 06-09 (seed = A at the laundry). Extra trip 06-11 took
  // the pool back and dropped B (endDate 06-10). Nothing dirty since.
  const r = run({ from: '2026-06-12', extraTrips: new Map([['2026-06-11', { pickUpAll: true, pickUp: {} }]]) });
  const d0 = r.days[0];
  assert.equal(d0.date, '2026-06-12');
  assert.equal(d0.atLaundry.single, 1);   // B
  assert.equal(d0.atLaundry.double, 0);   // A came back on 06-11
  assert.equal(d0.dirty.single, 0);
  assert.equal(d0.clean.single, 9);
  assert.equal(d0.clean.double, 10);
  // And the remaining pool returns on 06-16.
  assert.equal(day(r, '2026-06-16').atLaundry.single, 0);
  assertConservation(r, STOCK, 'init replay all');
});

test('initial state replays a past PARTIAL extra trip: the remainder is still at the laundry today', () => {
  const r = run({ from: '2026-06-12', extraTrips: new Map([['2026-06-11', { pickUpAll: false, pickUp: { single: 1 } }]]) });
  const d0 = r.days[0];
  // Pool after 06-11: A remainder (1 single + 1 double) + B (1 single) = 2 singles, 1 double.
  assert.equal(d0.atLaundry.single, 2);
  assert.equal(d0.atLaundry.double, 1);
  assert.equal(d0.clean.single, 8);
  assert.equal(d0.clean.double, 9);
  assert.equal(day(r, '2026-06-16').atLaundry.single, 0);
  assert.equal(day(r, '2026-06-16').clean.double, 10);
  assertConservation(r, STOCK, 'init replay partial');
});

test('an extra trip ON today is executed by the loop, not the init (rule 13)', () => {
  const r = run({ from: '2026-06-11', extraTrips: new Map([['2026-06-11', { pickUpAll: true, pickUp: {} }]]) });
  const d0 = r.days[0];
  assert.equal(d0.date, '2026-06-11');
  assert.equal(d0.isTripDay, true);
  assert.equal(d0.atLaundry.single, 1);   // B dropped today, A back
  assert.equal(d0.atLaundry.double, 0);
  assert.equal(d0.dirty.single, 0);
  assertConservation(r, STOCK, 'extra on today');
});

test('init seed guard quirk (documented): when the last regular trip is more than a week back, the pool starts at 0 and a partial remainder is not tracked', () => {
  // today = 06-16 (a Tuesday) but SKIPPED → last regular trip = 06-09, exactly 7 days back: the
  // historical `> today − 7` guard does not fire, so the seed is 0 and the extra trip 06-11 finds
  // an empty pool — its partial remainder (which really sits at the laundry) is not tracked. Same
  // class of approximation as the guard itself; pinned so a future fix is deliberate.
  const r = run({
    from: '2026-06-16', skippedDates: new Set(['2026-06-16']),
    extraTrips: new Map([['2026-06-11', { pickUpAll: false, pickUp: { single: 1 } }]]),
  });
  const d0 = r.days[0];
  assert.equal(d0.atLaundry.single, 1);   // only B, dropped on 06-11
  assert.equal(d0.atLaundry.double, 0);
  assertConservation(r, STOCK, 'guard quirk');
});
