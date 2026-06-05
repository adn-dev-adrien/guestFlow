/**
 * End-to-end regression tests for the weekly bed-linen tracking feature
 * (specs/weekly-bed-linen-tracking.md — §3.3, §3.5, §3.5.bis, §3.5.ter).
 *
 * Each test wires:
 *   in-memory DB → laundryModel.buildModel(db) → planningController.buildController({ laundryModel, settingsModel })
 *
 * and asserts the FULL payload that the planning endpoint emits for a realistic scenario.
 *
 * Why these tests exist: the unit tests in `laundry-model` and `planning-laundry-controller`
 * cover each layer in isolation. A subtle wiring bug (e.g. a key dropped between layers, a
 * payload field renamed, a forgotten ROUND, the bed-linen SQL stopping the join silently when
 * no row has the flag) can pass every unit test but break the real endpoint. These integration
 * tests catch that class of regression.
 *
 * Cases pinned here are deliberately chosen so that ANY future refactor that changes the
 * end-to-end behaviour breaks at least one assertion + emits a clear diff against the expected
 * payload.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const laundryModel = require('../models/laundryModel');
const { buildController } = require('../controllers/planningController');

const DDL = `
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL DEFAULT 'reservation',
    propertyId INTEGER,
    startDate TEXT NOT NULL,
    endDate TEXT NOT NULL,
    singleBeds INTEGER, doubleBeds INTEGER, babyBeds INTEGER,
    adults INTEGER DEFAULT 0, teens INTEGER DEFAULT 0,
    children INTEGER DEFAULT 0, babies INTEGER DEFAULT 0
  );
  CREATE TABLE options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT, autoOptionType TEXT,
    countsAsBedLinen INTEGER NOT NULL DEFAULT 0,
    countsAsBathroomLinen INTEGER NOT NULL DEFAULT 0,
    linenIncludesSingle INTEGER NOT NULL DEFAULT 1,
    linenIncludesDouble INTEGER NOT NULL DEFAULT 1,
    linenIncludesBaby INTEGER NOT NULL DEFAULT 1,
    towelLargePerPerson INTEGER NOT NULL DEFAULT 1,
    towelMediumPerPerson INTEGER NOT NULL DEFAULT 0,
    towelSmallPerPerson INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE reservation_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservationId INTEGER NOT NULL, optionId INTEGER NOT NULL,
    quantity REAL DEFAULT 1, offered INTEGER DEFAULT 0
  );
  CREATE TABLE property_option_defaults (
    propertyId INTEGER NOT NULL, optionId INTEGER NOT NULL,
    offered INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (propertyId, optionId)
  );
`;

function makeStack({ laundryWeekday = 2, skippedDates = [] } = {}) {
  const db = new Database(':memory:');
  db.exec(DDL);
  const model = laundryModel.buildModel(db);
  const settingsModel = { read: () => ({ laundryWeekday }) };
  // No `laundry_trip_skips` table in this fixture — inject an in-memory stub. Defaults to
  // an empty list so every legacy assertion stays byte-identical to the pre-skip baseline.
  const laundryTripSkipsModel = { listAll: () => [...skippedDates] };
  const controller = buildController({ laundryModel: model, settingsModel, laundryTripSkipsModel });
  return { db, model, controller };
}

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function seedSeeds(db, overrides = {}) {
  // Inserts the two typed seeds in the exact shape ensureDefaultBedLinenOption /
  // ensureDefaultBathroomLinenOption would produce on a fresh install. Allows per-test
  // override (e.g. switching towelMediumPerPerson = 1).
  const bedDefaults = { linenIncludesSingle: 1, linenIncludesDouble: 1, linenIncludesBaby: 1 };
  const bathDefaults = { towelLargePerPerson: 1, towelMediumPerPerson: 0, towelSmallPerPerson: 1 };
  const bed = { ...bedDefaults, ...(overrides.bed || {}) };
  const bath = { ...bathDefaults, ...(overrides.bath || {}) };
  const bedId = db.prepare(`
    INSERT INTO options (title, autoOptionType, countsAsBedLinen, linenIncludesSingle, linenIncludesDouble, linenIncludesBaby)
    VALUES ('Linge de lit', 'bed_linen', 1, ?, ?, ?)
  `).run(bed.linenIncludesSingle, bed.linenIncludesDouble, bed.linenIncludesBaby).lastInsertRowid;
  const bathId = db.prepare(`
    INSERT INTO options (title, autoOptionType, countsAsBathroomLinen, towelLargePerPerson, towelMediumPerPerson, towelSmallPerPerson)
    VALUES ('Linge de toilette', 'bathroom_linen', 1, ?, ?, ?)
  `).run(bath.towelLargePerPerson, bath.towelMediumPerPerson, bath.towelSmallPerPerson).lastInsertRowid;
  return { bedId: Number(bedId), bathId: Number(bathId) };
}

function makeReservation(db, props) {
  const cols = ['kind', 'startDate', 'endDate', 'singleBeds', 'doubleBeds', 'babyBeds', 'adults', 'teens', 'children', 'babies'];
  const values = cols.map((c) => (props[c] !== undefined ? props[c] : (c === 'kind' ? 'reservation' : 0)));
  const result = db.prepare(
    `INSERT INTO reservations (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  ).run(...values);
  return Number(result.lastInsertRowid);
}

function linkOption(db, reservationId, optionId, quantity = 1) {
  db.prepare(
    'INSERT INTO reservation_options (reservationId, optionId, quantity) VALUES (?, ?, ?)'
  ).run(reservationId, optionId, quantity);
}

// --- THE Adrien-prod scenario (2026-06-02 → 2026-06-09 Tuesday window) ---

test('END-TO-END: Adrien\'s prod scenario produces the exact expected dropOff for Tuesday 2026-06-09', () => {
  // This is the exact data Adrien reported on 2026-06-02. Any future refactor that changes the
  // engine's behaviour for this window must surface here with a clear payload diff. Don't change
  // the expected values without also updating the spec.
  const { db, controller } = makeStack({ laundryWeekday: 2 });
  const { bedId, bathId } = seedSeeds(db);

  // Gite — reservation 1 (ending Thursday 2026-06-04): 4 doubles, 4 simples, 1 bébé / 12 persons.
  const r1 = makeReservation(db, {
    startDate: '2026-06-02', endDate: '2026-06-04',
    singleBeds: 4, doubleBeds: 4, babyBeds: 1,
    adults: 8, children: 4, babies: 1,
  });
  linkOption(db, r1, bedId, 1);
  linkOption(db, r1, bathId, 1.0);

  // Tente — reservation (ending Saturday 2026-06-06): 1 double, 2 simples / 3 persons.
  // Quantity 0.6667 = "2 of 3 want towels" (sub-occupation factor).
  const r2 = makeReservation(db, {
    startDate: '2026-06-02', endDate: '2026-06-06',
    singleBeds: 2, doubleBeds: 1, babyBeds: 0,
    adults: 1, children: 2,
  });
  linkOption(db, r2, bedId, 1);
  linkOption(db, r2, bathId, 0.6667);

  // Gite — reservation 2 (ending Sunday 2026-06-07): 3 doubles, 3 simples / 8 persons.
  // Quantity 0.625 = "5 of 8 want towels".
  const r3 = makeReservation(db, {
    startDate: '2026-06-04', endDate: '2026-06-07',
    singleBeds: 3, doubleBeds: 3, babyBeds: 0,
    adults: 5, children: 3,
  });
  linkOption(db, r3, bedId, 1);
  linkOption(db, r3, bathId, 0.625);

  // Hit the controller for the window that contains the 2026-06-09 laundry day.
  const res = makeRes();
  controller.laundrySummary({ query: { from: '2026-06-09', to: '2026-06-09' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.laundryDays.length, 1);
  assert.deepEqual(res.body.laundryDays[0], {
    date: '2026-06-09',
    // Beds: gite1(4d/4s/1b) + tente(1d/2s) + gite2(3d/3s) = 8 doubles, 9 simples, 1 bébé.
    // Towels: 12×1 + 3×0.6667 + 8×0.625 = 12 + 2 + 5 = 19 ; medium=0 (default), small mirrors large.
    dropOff: {
      singleBeds: 9, doubleBeds: 8, babyBeds: 1,
      largeTowels: 19, mediumTowels: 0, smallTowels: 19,
    },
    // No prior week of data → pickUp is all zero.
    pickUp: {
      singleBeds: 0, doubleBeds: 0, babyBeds: 0,
      largeTowels: 0, mediumTowels: 0, smallTowels: 0,
    },
  });
});

// --- Per-type configuration end-to-end ---

test('END-TO-END: linenIncludesBaby = 0 on the option hides baby beds in the payload', () => {
  // Pin the §3.5.ter wiring all the way through: a config change on the option must reach the
  // endpoint payload. If anyone refactors the SQL or changes how the option flags are read,
  // this test breaks.
  const { db, controller } = makeStack();
  seedSeeds(db, { bed: { linenIncludesBaby: 0 } });
  const r = makeReservation(db, {
    startDate: '2026-06-02', endDate: '2026-06-04',
    singleBeds: 2, doubleBeds: 1, babyBeds: 5,
  });
  linkOption(db, r, db.prepare("SELECT id FROM options WHERE autoOptionType='bed_linen'").get().id);

  const res = makeRes();
  controller.laundrySummary({ query: { from: '2026-06-09', to: '2026-06-09' } }, res);
  assert.deepEqual(res.body.laundryDays[0].dropOff, {
    singleBeds: 2, doubleBeds: 1, babyBeds: 0, // 5 baby beds NOT counted
    largeTowels: 0, mediumTowels: 0, smallTowels: 0,
  });
});

test('END-TO-END: towelMediumPerPerson = 2 ADDS a medium counter all the way to the payload', () => {
  // The medium-towel feature is brand-new in this PR; pin that the full pipeline routes it.
  const { db, controller } = makeStack();
  const { bathId } = seedSeeds(db, { bath: { towelMediumPerPerson: 2 } });
  const r = makeReservation(db, {
    startDate: '2026-06-02', endDate: '2026-06-04',
    adults: 4, // 4 persons; medium=2/person ⇒ 8 medium towels.
  });
  linkOption(db, r, bathId, 1);

  const res = makeRes();
  controller.laundrySummary({ query: { from: '2026-06-09', to: '2026-06-09' } }, res);
  assert.deepEqual(res.body.laundryDays[0].dropOff, {
    singleBeds: 0, doubleBeds: 0, babyBeds: 0,
    largeTowels: 4, mediumTowels: 8, smallTowels: 4,
  });
});

// --- Pick-up vs drop-off contract ---

test('END-TO-END: pickUp(L) equals dropOff(L - 7 days) — sliding window across two laundry days', () => {
  // Pin the pick-up = "what I dropped off last week" semantic via two consecutive Tuesdays.
  const { db, controller } = makeStack();
  const { bedId } = seedSeeds(db);
  // Reservation ending 2026-06-04 (in the L=06-09 window).
  const r = makeReservation(db, {
    startDate: '2026-06-02', endDate: '2026-06-04',
    singleBeds: 3, doubleBeds: 2,
  });
  linkOption(db, r, bedId);

  const res = makeRes();
  controller.laundrySummary({ query: { from: '2026-06-09', to: '2026-06-16' } }, res);
  assert.equal(res.body.laundryDays.length, 2);
  // L = 2026-06-09: drop-off = 3+2.
  assert.equal(res.body.laundryDays[0].date, '2026-06-09');
  assert.equal(res.body.laundryDays[0].dropOff.singleBeds, 3);
  assert.equal(res.body.laundryDays[0].dropOff.doubleBeds, 2);
  // L = 2026-06-16: drop-off = 0 (nothing in 06-09→06-16), pick-up = previous drop-off.
  assert.equal(res.body.laundryDays[1].date, '2026-06-16');
  assert.equal(res.body.laundryDays[1].dropOff.singleBeds, 0);
  assert.equal(res.body.laundryDays[1].pickUp.singleBeds, 3);
  assert.equal(res.body.laundryDays[1].pickUp.doubleBeds, 2);
});

// --- Status filter ---

test('END-TO-END: kind=devis reservations are excluded from both bed and bathroom counters', () => {
  // Critical correctness gate: any code change that opens the filter to devis would silently
  // overstate the laundry needs.
  const { db, controller } = makeStack();
  const { bedId, bathId } = seedSeeds(db);
  const r = makeReservation(db, {
    kind: 'devis',
    startDate: '2026-06-02', endDate: '2026-06-04',
    singleBeds: 5, doubleBeds: 5, adults: 8,
  });
  linkOption(db, r, bedId);
  linkOption(db, r, bathId, 1);

  const res = makeRes();
  controller.laundrySummary({ query: { from: '2026-06-09', to: '2026-06-09' } }, res);
  assert.deepEqual(res.body.laundryDays[0].dropOff, {
    singleBeds: 0, doubleBeds: 0, babyBeds: 0,
    largeTowels: 0, mediumTowels: 0, smallTowels: 0,
  });
});

// --- Window boundary ---

test('END-TO-END: checkout on the START of the window goes to the PREVIOUS batch (left-exclusive)', () => {
  // Half-open window contract (rule 8): endDate exactly on L-7 days = previous batch, not this one.
  const { db, controller } = makeStack();
  const { bedId } = seedSeeds(db);
  // Tuesday 2026-06-02 is the previous laundry day for L=2026-06-09. Checkout on 2026-06-02 →
  // belongs to PREVIOUS batch (the one before 2026-06-09).
  const r = makeReservation(db, {
    startDate: '2026-05-30', endDate: '2026-06-02',
    singleBeds: 7,
  });
  linkOption(db, r, bedId);

  const res = makeRes();
  controller.laundrySummary({ query: { from: '2026-06-09', to: '2026-06-09' } }, res);
  // Drop-off on 06-09 = sums (06-02, 06-09]. 06-02 is excluded.
  assert.equal(res.body.laundryDays[0].dropOff.singleBeds, 0);
});

// --- §3.7 — property-default fallback drives the controller payload ---

test('END-TO-END: property default ⇒ a reservation WITHOUT the linen option STILL contributes', () => {
  // Adrien's exact ask 2026-06-03: activate the linen default on a property → every reservation
  // of that property counts toward the laundry, regardless of what's in reservation_options.
  // Pinned at the controller level so future SQL refactors that drop the UNION source 2 surface
  // here as a payload diff.
  const { db, controller } = makeStack();
  const { bedId } = seedSeeds(db);
  // Reservation NOT linked to the option. Without §3.7 this would contribute zero.
  makeReservation(db, {
    startDate: '2026-06-02', endDate: '2026-06-04',
    singleBeds: 4, doubleBeds: 4, babyBeds: 1,
    adults: 8, children: 4,
  });
  // Set the property default. The makeReservation above didn't set propertyId — patch the row
  // directly so the JOIN finds it.
  db.prepare("UPDATE reservations SET propertyId = 10 WHERE startDate = '2026-06-02'").run();
  db.prepare(
    "INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (?, ?, 1)"
  ).run(10, bedId);

  const res = makeRes();
  controller.laundrySummary({ query: { from: '2026-06-09', to: '2026-06-09' } }, res);
  assert.deepEqual(res.body.laundryDays[0].dropOff, {
    singleBeds: 4, doubleBeds: 4, babyBeds: 1,
    largeTowels: 0, mediumTowels: 0, smallTowels: 0,
  });
});

test('END-TO-END: explicit reservation_options row STILL wins over the property default', () => {
  // Sanity contract — operator intent is never silently overwritten by the property default.
  // Reservation has the option explicitly with linenIncludesBaby=0 (the operator created a
  // different option with baby unchecked); property default points at an option that includes
  // baby. The explicit row's flags drive the result — baby beds must not be counted.
  const { db, controller } = makeStack();
  const bedDefault = db.prepare(`
    INSERT INTO options (title, autoOptionType, countsAsBedLinen, linenIncludesBaby)
    VALUES ('Linge de lit default', 'bed_linen', 1, 1)
  `).run().lastInsertRowid;
  const bedExplicit = db.prepare(`
    INSERT INTO options (title, countsAsBedLinen, linenIncludesBaby)
    VALUES ('Linge de lit (no baby)', 1, 0)
  `).run().lastInsertRowid;
  const r = makeReservation(db, {
    startDate: '2026-06-02', endDate: '2026-06-04',
    singleBeds: 2, doubleBeds: 1, babyBeds: 3,
  });
  db.prepare("UPDATE reservations SET propertyId = 10 WHERE id = ?").run(r);
  db.prepare(
    "INSERT INTO reservation_options (reservationId, optionId, quantity) VALUES (?, ?, 1)"
  ).run(r, bedExplicit);
  db.prepare(
    "INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (?, ?, 1)"
  ).run(10, bedDefault);

  const res = makeRes();
  controller.laundrySummary({ query: { from: '2026-06-09', to: '2026-06-09' } }, res);
  assert.deepEqual(res.body.laundryDays[0].dropOff, {
    singleBeds: 2, doubleBeds: 1, babyBeds: 0, // baby suppressed by the explicit row
    largeTowels: 0, mediumTowels: 0, smallTowels: 0,
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// specs/skip-laundry-trip.md §3.1 rule 6 — full-stack regression for the user-reported bug
// "la carte blanchisserie suivante ne change pas" (2026-06-05). Two reservations, one ends
// in the pre-skip week, the other in the skip week. After marking the in-between trip as
// skipped, the next non-skipped card must absorb BOTH reservations into À apporter.
// ─────────────────────────────────────────────────────────────────────────────────────────

test('END-TO-END: skipping a laundry day defers BOTH drop-off and pick-up to the next non-skipped card', () => {
  const { db, controller } = makeStack({
    laundryWeekday: 2,
    skippedDates: ['2026-06-02'], // Tuesday 2026-06-02 marked as not-made.
  });
  const { bedId, bathId } = seedSeeds(db);

  // Reservation A — ends Friday 2026-05-29. Without the skip its batch would belong to the
  // 2026-06-02 trip. With the skip, it's deferred to 2026-06-09.
  const rA = makeReservation(db, {
    startDate: '2026-05-26', endDate: '2026-05-29',
    singleBeds: 2, doubleBeds: 1, babyBeds: 0,
    adults: 2, children: 1,
  });
  linkOption(db, rA, bedId, 1);
  linkOption(db, rA, bathId, 1.0);

  // Reservation B — ends Saturday 2026-06-06. Belongs to the 2026-06-09 trip natively.
  const rB = makeReservation(db, {
    startDate: '2026-06-02', endDate: '2026-06-06',
    singleBeds: 0, doubleBeds: 1, babyBeds: 1,
    adults: 2, babies: 1,
  });
  linkOption(db, rB, bedId, 1);
  linkOption(db, rB, bathId, 1.0);

  const res = makeRes();
  controller.laundrySummary({ query: { from: '2026-06-02', to: '2026-06-09' } }, res);
  const byDate = Object.fromEntries(res.body.laundryDays.map((d) => [d.date, d]));

  // The skipped card emits zeros — the client masks it with the "Voyage non réalisé" caption.
  assert.deepEqual(byDate['2026-06-02'].dropOff, {
    singleBeds: 0, doubleBeds: 0, babyBeds: 0, largeTowels: 0, mediumTowels: 0, smallTowels: 0,
  });
  assert.deepEqual(byDate['2026-06-02'].pickUp, {
    singleBeds: 0, doubleBeds: 0, babyBeds: 0, largeTowels: 0, mediumTowels: 0, smallTowels: 0,
  });

  // The next non-skipped card (2026-06-09) ABSORBS rA + rB into À apporter — this is the
  // exact behaviour the user reported as missing.
  assert.deepEqual(byDate['2026-06-09'].dropOff, {
    singleBeds: 2 + 0,
    doubleBeds: 1 + 1,
    babyBeds:   0 + 1,
    // Towels: rA = 3 persons (2 adults + 1 child) × 1 = 3 large + 3 small.
    //         rB = 2 persons (2 adults; baby excluded) × 1 = 2 large + 2 small.
    largeTowels: 3 + 2,
    mediumTowels: 0,
    smallTowels: 3 + 2,
  });
});
