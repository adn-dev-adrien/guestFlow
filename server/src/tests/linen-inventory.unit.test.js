const test = require('node:test');
const assert = require('node:assert/strict');

const { simulateInventory, findHorizon, ALL_TYPES } = require('../utils/linenInventory');

// Helpers — keep test fixtures small and deterministic.
function makeStock(over = {}) {
  return {
    single: 0, double: 0, baby: 0, large: 0, medium: 0, small: 0,
    ...over,
  };
}
function makeBedLinenOption(id, over = {}) {
  return {
    id, countsAsBedLinen: 1, countsAsBathroomLinen: 0,
    linenIncludesSingle: 1, linenIncludesDouble: 1, linenIncludesBaby: 1,
    towelLargePerPerson: 0, towelMediumPerPerson: 0, towelSmallPerPerson: 0,
    ...over,
  };
}
function makeBathroomOption(id, over = {}) {
  return {
    id, countsAsBedLinen: 0, countsAsBathroomLinen: 1,
    linenIncludesSingle: 0, linenIncludesDouble: 0, linenIncludesBaby: 0,
    towelLargePerPerson: 1, towelMediumPerPerson: 0, towelSmallPerPerson: 1,
    ...over,
  };
}

const TUESDAY = 2;
const NOWHERE_OPTION = []; // helper to denote "no reservation_options for this reservation"

// --- Conservation invariant (asserted on every day of every test) ---

function assertConservation(result, stock, ctx = '') {
  for (const day of result.days) {
    for (const t of ALL_TYPES) {
      const sum = Number(day.clean[t]) + Number(day.inCirculation[t]) + Number(day.dirty[t]) + Number(day.atLaundry[t]);
      assert.equal(sum, Number(stock[t] || 0), `${ctx} conservation broken on ${day.date} for ${t}`);
    }
  }
}

// --- Empty fixtures ---

test('empty horizon: from > to returns no days', () => {
  const r = simulateInventory({
    stock: makeStock({ single: 10 }),
    reservations: [], options: [], reservationOptions: [], propertyDefaults: [],
    laundryWeekday: TUESDAY, from: '2026-06-10', to: '2026-06-01',
  });
  assert.deepEqual(r.days, []);
});

test('no reservations: clean = stock on every day, no shortages', () => {
  const r = simulateInventory({
    stock: makeStock({ single: 10, double: 5, large: 20 }),
    reservations: [], options: [], reservationOptions: [], propertyDefaults: [],
    laundryWeekday: TUESDAY, from: '2026-06-01', to: '2026-06-08',
  });
  assert.equal(r.days.length, 8);
  for (const d of r.days) {
    assert.equal(d.clean.single, 10);
    assert.equal(d.clean.double, 5);
    assert.equal(d.clean.large, 20);
    assert.equal(d.shortagesToday.length, 0);
  }
  assertConservation(r, { single: 10, double: 5, large: 20, baby: 0, medium: 0, small: 0 });
});

// --- Single reservation with explicit option ---

test('one reservation with explicit bed-linen option: clean drops on check-in, returns after laundry cycle', () => {
  const stock = makeStock({ single: 10, double: 10, baby: 10 });
  const opt = makeBedLinenOption(100);
  const reservations = [{
    id: 1, kind: 'reservation', propertyId: 1,
    startDate: '2026-06-03', endDate: '2026-06-05',
    singleBeds: 2, doubleBeds: 1, babyBeds: 0,
    adults: 2, teens: 0, children: 0,
  }];
  const reservationOptions = [{ reservationId: 1, optionId: 100, quantity: 1 }];

  const r = simulateInventory({
    stock, reservations, options: [opt], reservationOptions, propertyDefaults: [],
    laundryWeekday: TUESDAY, from: '2026-06-01', to: '2026-06-20',
  });

  // 06-01 (Mon): nothing yet.
  const d0601 = r.days.find((d) => d.date === '2026-06-01');
  assert.deepEqual(d0601.clean, { single: 10, double: 10, baby: 10, large: 0, medium: 0, small: 0, bathMat: 0 });

  // 06-03 (Wed): check-in → in-circulation gets 2 single + 1 double, clean drops accordingly.
  const d0603 = r.days.find((d) => d.date === '2026-06-03');
  assert.equal(d0603.inCirculation.single, 2);
  assert.equal(d0603.inCirculation.double, 1);
  assert.equal(d0603.clean.single, 8);
  assert.equal(d0603.clean.double, 9);

  // 06-05 (Fri) — same day of checkout, the reservation is still "in" on that day's snapshot
  // (the transition out happens at end-of-day → start of 06-06).
  // 06-06 (Sat) — dirty has the linen now.
  const d0606 = r.days.find((d) => d.date === '2026-06-06');
  assert.equal(d0606.dirty.single, 2);
  assert.equal(d0606.dirty.double, 1);
  assert.equal(d0606.inCirculation.single, 0);

  // 06-09 (Tue, laundry day) — drop: dirty → atLaundry. Same day, no pickup yet (it's the first laundry day in the horizon).
  const d0609 = r.days.find((d) => d.date === '2026-06-09');
  assert.equal(d0609.atLaundry.single, 2);
  assert.equal(d0609.atLaundry.double, 1);
  assert.equal(d0609.dirty.single, 0);

  // 06-16 (Tue, next laundry day) — pickup brings the linen back to clean (it was dropped 7 days ago).
  const d0616 = r.days.find((d) => d.date === '2026-06-16');
  assert.equal(d0616.atLaundry.single, 0);
  assert.equal(d0616.clean.single, 10);
  assert.equal(d0616.clean.double, 10);

  assertConservation(r, stock);
});

// --- Property-default fallback ---

test('property default fires when no explicit option row: counts the reservation as if option was ticked', () => {
  const stock = makeStock({ single: 10, double: 10 });
  const opt = makeBedLinenOption(100);
  const reservations = [{
    id: 1, kind: 'reservation', propertyId: 42,
    startDate: '2026-06-03', endDate: '2026-06-05',
    singleBeds: 1, doubleBeds: 1, babyBeds: 0,
    adults: 2,
  }];
  // No reservation_options row → only the property default applies.
  const propertyDefaults = [{ propertyId: 42, optionId: 100 }];

  const r = simulateInventory({
    stock, reservations, options: [opt], reservationOptions: [], propertyDefaults,
    laundryWeekday: TUESDAY, from: '2026-06-01', to: '2026-06-20',
  });

  const d0603 = r.days.find((d) => d.date === '2026-06-03');
  assert.equal(d0603.inCirculation.single, 1);
  assert.equal(d0603.inCirculation.double, 1);
  assertConservation(r, stock);
});

test('explicit option WINS over property default (includes flags from explicit option used)', () => {
  const stock = makeStock({ single: 10, double: 10, baby: 5 });
  const optDefault = makeBedLinenOption(100, { linenIncludesBaby: 1 });
  const optExplicit = makeBedLinenOption(101, { linenIncludesBaby: 0 });
  const reservations = [{
    id: 1, kind: 'reservation', propertyId: 42,
    startDate: '2026-06-03', endDate: '2026-06-05',
    singleBeds: 1, doubleBeds: 1, babyBeds: 2,
  }];
  const reservationOptions = [{ reservationId: 1, optionId: 101, quantity: 1 }];
  const propertyDefaults = [{ propertyId: 42, optionId: 100 }];

  const r = simulateInventory({
    stock, reservations, options: [optDefault, optExplicit], reservationOptions, propertyDefaults,
    laundryWeekday: TUESDAY, from: '2026-06-01', to: '2026-06-20',
  });
  const d0603 = r.days.find((d) => d.date === '2026-06-03');
  assert.equal(d0603.inCirculation.baby, 0, 'explicit option had linenIncludesBaby=0 → 0 baby counted');
  assertConservation(r, stock);
});

// --- Bathroom-linen ---

test('bathroom contract: persons × Σqty × towel<Size>PerPerson', () => {
  const stock = makeStock({ large: 10, small: 10 });
  const opt = makeBathroomOption(200, { towelLargePerPerson: 1, towelSmallPerPerson: 2 });
  const reservations = [{
    id: 1, kind: 'reservation', propertyId: 1,
    startDate: '2026-06-03', endDate: '2026-06-05',
    adults: 2, teens: 0, children: 1, babies: 5, // babies excluded
  }];
  const reservationOptions = [{ reservationId: 1, optionId: 200, quantity: 1.0 }];

  const r = simulateInventory({
    stock, reservations, options: [opt], reservationOptions, propertyDefaults: [],
    laundryWeekday: TUESDAY, from: '2026-06-01', to: '2026-06-20',
  });
  const d0603 = r.days.find((d) => d.date === '2026-06-03');
  // 3 persons × 1.0 × 1 large = 3 ; 3 × 1.0 × 2 small = 6.
  assert.equal(d0603.inCirculation.large, 3);
  assert.equal(d0603.inCirculation.small, 6);
});

test('bathroom Σqty sub-occupation factor honoured (0.6667 on 3 persons → 2 towels)', () => {
  const stock = makeStock({ large: 10 });
  const opt = makeBathroomOption(200);
  const reservations = [{
    id: 1, kind: 'reservation', propertyId: 1,
    startDate: '2026-06-03', endDate: '2026-06-05',
    adults: 1, teens: 0, children: 2,
  }];
  const reservationOptions = [{ reservationId: 1, optionId: 200, quantity: 0.6667 }];

  const r = simulateInventory({
    stock, reservations, options: [opt], reservationOptions, propertyDefaults: [],
    laundryWeekday: TUESDAY, from: '2026-06-01', to: '2026-06-20',
  });
  const d0603 = r.days.find((d) => d.date === '2026-06-03');
  assert.equal(d0603.inCirculation.large, 2); // round(3 × 0.6667 × 1) = 2
});

// --- Stock = 0 means "type not tracked" ---

test('stock = 0 for a type: simulation runs without that type triggering any shortage', () => {
  const stock = makeStock({ single: 10 }); // double / baby / towels all 0
  const opt = makeBedLinenOption(100);
  const reservations = [{
    id: 1, kind: 'reservation', propertyId: 1,
    startDate: '2026-06-03', endDate: '2026-06-05',
    singleBeds: 1, doubleBeds: 5, babyBeds: 3, // a lot of double + baby beds
  }];
  const reservationOptions = [{ reservationId: 1, optionId: 100, quantity: 1 }];

  const r = simulateInventory({
    stock, reservations, options: [opt], reservationOptions, propertyDefaults: [],
    laundryWeekday: TUESDAY, from: '2026-06-01', to: '2026-06-10',
  });
  // double goes to -5 internally, but stock=0 → no shortage flagged on double.
  for (const day of r.days) {
    const dblShort = day.shortagesToday.find((s) => s.type === 'double');
    assert.equal(dblShort, undefined);
  }
  // shortagesByType.double has no firstDate.
  assert.equal(r.shortagesByType.double.firstDate, null);
});

// --- Devis exclusion ---

test('kind=devis reservation excluded from the simulation', () => {
  const stock = makeStock({ single: 10 });
  const opt = makeBedLinenOption(100);
  const reservations = [{
    id: 1, kind: 'devis', propertyId: 1,
    startDate: '2026-06-03', endDate: '2026-06-05',
    singleBeds: 5,
  }];
  const reservationOptions = [{ reservationId: 1, optionId: 100, quantity: 1 }];

  const r = simulateInventory({
    stock, reservations, options: [opt], reservationOptions, propertyDefaults: [],
    laundryWeekday: TUESDAY, from: '2026-06-01', to: '2026-06-10',
  });
  for (const d of r.days) {
    assert.equal(d.inCirculation.single, 0);
    assert.equal(d.clean.single, 10);
  }
});

// --- Shortage detection ---

test('shortage detected when demand exceeds stock; missing equals overflow', () => {
  const stock = makeStock({ single: 3 });
  const opt = makeBedLinenOption(100);
  const reservations = [
    { id: 1, kind: 'reservation', propertyId: 1, startDate: '2026-06-03', endDate: '2026-06-05', singleBeds: 2 },
    { id: 2, kind: 'reservation', propertyId: 1, startDate: '2026-06-04', endDate: '2026-06-06', singleBeds: 2 },
  ];
  const reservationOptions = [
    { reservationId: 1, optionId: 100, quantity: 1 },
    { reservationId: 2, optionId: 100, quantity: 1 },
  ];

  const r = simulateInventory({
    stock, reservations, options: [opt], reservationOptions, propertyDefaults: [],
    laundryWeekday: TUESDAY, from: '2026-06-01', to: '2026-06-20',
  });
  // After R2 checks in on 06-04: 2 + 2 = 4 needed, stock = 3 → 1 missing.
  const d0604 = r.days.find((d) => d.date === '2026-06-04');
  const shortage = d0604.shortagesToday.find((s) => s.type === 'single');
  assert.ok(shortage, 'shortage flagged on 06-04 for single');
  assert.equal(shortage.missing, 1);
  // Aggregate shortagesByType.single
  assert.equal(r.shortagesByType.single.firstDate, '2026-06-04');
  assert.equal(r.shortagesByType.single.maxMissing, 1);
  assert.deepEqual(r.shortagesByType.single.impactedReservationIds, [2]);
  assertConservation(r, stock);
});

test('shortage with 3 impacted reservations on different days', () => {
  const stock = makeStock({ double: 2 });
  const opt = makeBedLinenOption(100);
  const reservations = [
    { id: 1, kind: 'reservation', propertyId: 1, startDate: '2026-06-03', endDate: '2026-06-05', doubleBeds: 1 },
    { id: 2, kind: 'reservation', propertyId: 1, startDate: '2026-06-03', endDate: '2026-06-05', doubleBeds: 1 },
    { id: 3, kind: 'reservation', propertyId: 1, startDate: '2026-06-04', endDate: '2026-06-06', doubleBeds: 1 },
    { id: 4, kind: 'reservation', propertyId: 1, startDate: '2026-06-04', endDate: '2026-06-06', doubleBeds: 1 },
  ];
  const reservationOptions = reservations.map((r) => ({ reservationId: r.id, optionId: 100, quantity: 1 }));

  const r = simulateInventory({
    stock, reservations, options: [opt], reservationOptions, propertyDefaults: [],
    laundryWeekday: TUESDAY, from: '2026-06-01', to: '2026-06-20',
  });
  // First shortage on 06-04 (when 3 + 4 check in pushing demand to 4 vs stock 2). 2 missing.
  assert.equal(r.shortagesByType.double.firstDate, '2026-06-04');
  assert.equal(r.shortagesByType.double.maxMissing, 2);
  // Reservations impacted = those arriving on the shortage days with demand for `double`.
  // → 3 and 4 (arrived on 06-04). 1 and 2 are NOT marked impacted because they arrived BEFORE
  // the shortage triggered.
  assert.deepEqual(r.shortagesByType.double.impactedReservationIds, [3, 4]);
});

// --- Laundry-day pick-up happens BEFORE check-in (rule 6) ---

test('arrival on a laundry day is served by the same-day pickup', () => {
  // Setup: a reservation drops linen 7 days earlier so it returns to clean on the same Tuesday
  // when the next arrival checks in. The pickup must run BEFORE the check-in so the new
  // arrival can consume the freshly returned linen.
  const stock = makeStock({ single: 2 });
  const opt = makeBedLinenOption(100);
  const reservations = [
    // R1 ends on 2026-06-02 (Tuesday) → drops 2 single at laundry → returns 2026-06-09.
    { id: 1, kind: 'reservation', propertyId: 1, startDate: '2026-05-30', endDate: '2026-06-02', singleBeds: 2 },
    // R2 starts 2026-06-09 (Tuesday) — needs 2 single → must come from the same-day pickup.
    { id: 2, kind: 'reservation', propertyId: 1, startDate: '2026-06-09', endDate: '2026-06-11', singleBeds: 2 },
  ];
  const reservationOptions = reservations.map((r) => ({ reservationId: r.id, optionId: 100, quantity: 1 }));

  const r = simulateInventory({
    stock, reservations, options: [opt], reservationOptions, propertyDefaults: [],
    laundryWeekday: TUESDAY, from: '2026-06-03', to: '2026-06-15',
  });
  const d0609 = r.days.find((d) => d.date === '2026-06-09');
  // Pickup → clean += 2; check-in → clean -= 2, inCirculation += 2.
  // End-of-day: clean = 0, inCirculation = 2, no shortage.
  assert.equal(d0609.clean.single, 0);
  assert.equal(d0609.inCirculation.single, 2);
  assert.equal(d0609.shortagesToday.length, 0);
  assertConservation(r, stock);
});

// --- findHorizon helper ---

test('findHorizon returns the max endDate across reservation rows, devis excluded', () => {
  const horizon = findHorizon([
    { kind: 'reservation', endDate: '2026-06-10' },
    { kind: 'devis', endDate: '2026-12-31' },
    { kind: 'reservation', endDate: '2026-08-15' },
  ]);
  assert.equal(horizon, '2026-08-15');
});

test('findHorizon returns null on empty / all-devis input', () => {
  assert.equal(findHorizon([]), null);
  assert.equal(findHorizon([{ kind: 'devis', endDate: '2026-06-01' }]), null);
});

// --- Regression: an arrival ON `from` must be counted ONCE (not double-counted) ---
// Bug (fixed): the initial inCirculation used `startDate <= from`, which already counted today's
// arrivals; the day-`from` check-in then added them again → 2× consumption → phantom shortage.
test('arrival on the first simulated day is counted once (no double-count, no phantom shortage)', () => {
  const stock = makeStock({ double: 10 });
  const opt = makeBedLinenOption(100, { linenIncludesSingle: 0, linenIncludesBaby: 0 });
  const r = simulateInventory({
    stock,
    reservations: [
      { id: 1, kind: 'reservation', propertyId: 1, startDate: '2026-06-12', endDate: '2026-06-14',
        singleBeds: 0, doubleBeds: 4, babyBeds: 0, adults: 2, teens: 0, children: 0 },
    ],
    options: [opt],
    reservationOptions: [{ reservationId: 1, optionId: 100, quantity: 1 }],
    propertyDefaults: [],
    laundryWeekday: TUESDAY, from: '2026-06-12', to: '2026-06-12',
  });
  // 4 doubles consumed (once), not 8 → clean = 6, never negative.
  assert.equal(r.days[0].inCirculation.double, 4, 'arrival counted exactly once');
  assert.equal(r.days[0].clean.double, 6);
  assert.equal(r.days[0].shortagesToday.length, 0);
  assert.equal(r.shortagesByType.double.firstDate, null, 'no phantom shortage');
  assertConservation(r, stock);
});

test('a guest who arrived BEFORE `from` is still in circulation on `from`', () => {
  const stock = makeStock({ double: 10 });
  const opt = makeBedLinenOption(100, { linenIncludesSingle: 0, linenIncludesBaby: 0 });
  const r = simulateInventory({
    stock,
    reservations: [
      { id: 1, kind: 'reservation', propertyId: 1, startDate: '2026-06-10', endDate: '2026-06-15',
        singleBeds: 0, doubleBeds: 3, babyBeds: 0, adults: 2, teens: 0, children: 0 },
    ],
    options: [opt],
    reservationOptions: [{ reservationId: 1, optionId: 100, quantity: 1 }],
    propertyDefaults: [],
    laundryWeekday: TUESDAY, from: '2026-06-12', to: '2026-06-12',
  });
  assert.equal(r.days[0].inCirculation.double, 3, 'prior arrival still in circulation');
  assert.equal(r.days[0].clean.double, 7);
  assertConservation(r, stock);
});
