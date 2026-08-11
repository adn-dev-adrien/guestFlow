const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const laundryModel = require('../models/laundryModel');

// In-memory DB tests for the bed-linen aggregation (specs/weekly-bed-linen-tracking.md §3.1–3.3).

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL DEFAULT 'reservation',
      propertyId INTEGER,
      startDate TEXT NOT NULL,
      endDate TEXT NOT NULL,
      singleBeds INTEGER,
      doubleBeds INTEGER,
      babyBeds INTEGER,
      adults INTEGER DEFAULT 0,
      teens INTEGER DEFAULT 0,
      children INTEGER DEFAULT 0,
      babies INTEGER DEFAULT 0
    );
    CREATE TABLE options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      countsAsBedLinen INTEGER NOT NULL DEFAULT 0,
      countsAsBathroomLinen INTEGER NOT NULL DEFAULT 0,
      displayToClient INTEGER NOT NULL DEFAULT 1,
      linenIncludesSingle INTEGER NOT NULL DEFAULT 1,
      linenIncludesDouble INTEGER NOT NULL DEFAULT 1,
      linenIncludesBaby INTEGER NOT NULL DEFAULT 1,
      towelLargePerPerson INTEGER NOT NULL DEFAULT 1,
      towelMediumPerPerson INTEGER NOT NULL DEFAULT 0,
      towelSmallPerPerson INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE reservation_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reservationId INTEGER NOT NULL,
      optionId INTEGER NOT NULL,
      quantity REAL DEFAULT 1,
      offered INTEGER DEFAULT 0
    );
    -- §3.7 — per-property option defaults (drives the laundry counter as a fallback source).
    CREATE TABLE property_option_defaults (
      propertyId INTEGER NOT NULL,
      optionId   INTEGER NOT NULL,
      offered    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (propertyId, optionId)
    );
  `);
  return db;
}

function makePropertyOptionDefault(db, propertyId, optionId, offered = 0) {
  db.prepare(
    'INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (?, ?, ?)'
  ).run(propertyId, optionId, offered);
}

function makeOption(db, {
  title = 'Linge de lit',
  countsAsBedLinen = 1,
  countsAsBathroomLinen = 0,
  displayToClient = 1,
  linenIncludesSingle = 1,
  linenIncludesDouble = 1,
  linenIncludesBaby = 1,
  towelLargePerPerson = 1,
  towelMediumPerPerson = 0,
  towelSmallPerPerson = 1,
} = {}) {
  const result = db.prepare(`
    INSERT INTO options (
      title, countsAsBedLinen, countsAsBathroomLinen, displayToClient,
      linenIncludesSingle, linenIncludesDouble, linenIncludesBaby,
      towelLargePerPerson, towelMediumPerPerson, towelSmallPerPerson
    ) VALUES (?, ?, ?, ?,  ?, ?, ?,  ?, ?, ?)
  `).run(
    title, countsAsBedLinen, countsAsBathroomLinen, displayToClient,
    linenIncludesSingle, linenIncludesDouble, linenIncludesBaby,
    towelLargePerPerson, towelMediumPerPerson, towelSmallPerPerson,
  );
  return Number(result.lastInsertRowid);
}

function makeReservation(db, {
  kind = 'reservation', propertyId = null, startDate, endDate,
  singleBeds = 0, doubleBeds = 0, babyBeds = 0,
  adults = 0, teens = 0, children = 0, babies = 0,
} = {}) {
  const result = db.prepare(
    'INSERT INTO reservations (kind, propertyId, startDate, endDate, singleBeds, doubleBeds, babyBeds, adults, teens, children, babies) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(kind, propertyId, startDate, endDate, singleBeds, doubleBeds, babyBeds, adults, teens, children, babies);
  return Number(result.lastInsertRowid);
}

function linkOption(db, reservationId, optionId, { quantity = 1, offered = 0 } = {}) {
  db.prepare(
    'INSERT INTO reservation_options (reservationId, optionId, quantity, offered) VALUES (?, ?, ?, ?)'
  ).run(reservationId, optionId, quantity, offered);
}

// --- Rule 1: linen-flagged option required ---

test('dropOffForWindow: reservation WITH the linen option contributes its bed counts', () => {
  const db = makeDb();
  const opt = makeOption(db);
  const r = makeReservation(db, { startDate: '2026-05-30', endDate: '2026-06-02', singleBeds: 2, doubleBeds: 1, babyBeds: 1 });
  linkOption(db, r, opt);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(
    model.dropOffForWindow('2026-05-26', '2026-06-02'),
    { singleBeds: 2, doubleBeds: 1, babyBeds: 1 }
  );
});

test('dropOffForWindow: reservation WITHOUT a linen-flagged option contributes nothing', () => {
  const db = makeDb();
  const optNonLinen = makeOption(db, { countsAsBedLinen: 0 });
  const r = makeReservation(db, { startDate: '2026-05-30', endDate: '2026-06-02', singleBeds: 2, doubleBeds: 1 });
  linkOption(db, r, optNonLinen);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffForWindow('2026-05-26', '2026-06-02'), { singleBeds: 0, doubleBeds: 0, babyBeds: 0 });
});

test('dropOffForWindow: reservation with NO options at all contributes nothing', () => {
  const db = makeDb();
  makeReservation(db, { startDate: '2026-05-30', endDate: '2026-06-02', singleBeds: 5, doubleBeds: 5 });
  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffForWindow('2026-05-26', '2026-06-02'), { singleBeds: 0, doubleBeds: 0, babyBeds: 0 });
});

// --- Rule 2: offered flag ignored ---

test('dropOffForWindow: offered=true on the linen option still contributes', () => {
  const db = makeDb();
  const opt = makeOption(db);
  const r = makeReservation(db, { startDate: '2026-05-30', endDate: '2026-06-02', singleBeds: 2, doubleBeds: 1 });
  linkOption(db, r, opt, { offered: 1 });

  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffForWindow('2026-05-26', '2026-06-02'), { singleBeds: 2, doubleBeds: 1, babyBeds: 0 });
});

// --- Rule 3: quantity ignored ---

test('dropOffForWindow: quantity on the linen option does NOT multiply bed counts', () => {
  const db = makeDb();
  const opt = makeOption(db);
  const r = makeReservation(db, { startDate: '2026-05-30', endDate: '2026-06-02', singleBeds: 2, doubleBeds: 1 });
  linkOption(db, r, opt, { quantity: 5 });

  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffForWindow('2026-05-26', '2026-06-02'), { singleBeds: 2, doubleBeds: 1, babyBeds: 0 });
});

// --- Rule 4: multiple linen options on one reservation count once ---

test('dropOffForWindow: reservation with TWO linen-flagged options counts the beds ONCE', () => {
  const db = makeDb();
  const optA = makeOption(db, { title: 'Linge de lit Standard' });
  const optB = makeOption(db, { title: 'Linge de lit Premium' });
  const r = makeReservation(db, { startDate: '2026-05-30', endDate: '2026-06-02', singleBeds: 2, doubleBeds: 1, babyBeds: 1 });
  linkOption(db, r, optA);
  linkOption(db, r, optB);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffForWindow('2026-05-26', '2026-06-02'), { singleBeds: 2, doubleBeds: 1, babyBeds: 1 });
});

// --- Rule 5: kind = 'devis' excluded ---

test('dropOffForWindow: kind=devis excluded even with linen option', () => {
  const db = makeDb();
  const opt = makeOption(db);
  const r = makeReservation(db, { kind: 'devis', startDate: '2026-05-30', endDate: '2026-06-02', singleBeds: 2, doubleBeds: 1 });
  linkOption(db, r, opt);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffForWindow('2026-05-26', '2026-06-02'), { singleBeds: 0, doubleBeds: 0, babyBeds: 0 });
});

// --- Rule 8: half-open window ---

test('dropOffForWindow: endDate exactly on the START bound is EXCLUDED (left-exclusive)', () => {
  const db = makeDb();
  const opt = makeOption(db);
  // Check-out on 2026-05-26 — the previous laundry day — joins the PREVIOUS batch.
  const r = makeReservation(db, { startDate: '2026-05-22', endDate: '2026-05-26', singleBeds: 2 });
  linkOption(db, r, opt);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffForWindow('2026-05-26', '2026-06-02'), { singleBeds: 0, doubleBeds: 0, babyBeds: 0 });
});

test('dropOffForWindow: endDate exactly on the END bound is INCLUDED (right-inclusive)', () => {
  const db = makeDb();
  const opt = makeOption(db);
  // Check-out on the laundry day itself → counts in the same day's drop-off.
  const r = makeReservation(db, { startDate: '2026-06-01', endDate: '2026-06-02', singleBeds: 1, doubleBeds: 2 });
  linkOption(db, r, opt);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffForWindow('2026-05-26', '2026-06-02'), { singleBeds: 1, doubleBeds: 2, babyBeds: 0 });
});

// --- Edge cases ---

test('dropOffForWindow: reservation with all bed counts = 0 (or NULL) contributes zeros, does not crash', () => {
  const db = makeDb();
  const opt = makeOption(db);
  const r1 = makeReservation(db, { startDate: '2026-05-30', endDate: '2026-06-02' }); // all zero
  // NULL singleBeds via raw insert
  const r2 = Number(db.prepare(
    "INSERT INTO reservations (kind, startDate, endDate, singleBeds, doubleBeds, babyBeds) VALUES ('reservation', '2026-05-31', '2026-06-01', NULL, NULL, NULL)"
  ).run().lastInsertRowid);
  linkOption(db, r1, opt);
  linkOption(db, r2, opt);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffForWindow('2026-05-26', '2026-06-02'), { singleBeds: 0, doubleBeds: 0, babyBeds: 0 });
});

test('dropOffForWindow: empty DB returns zeros', () => {
  const db = makeDb();
  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffForWindow('2026-05-26', '2026-06-02'), { singleBeds: 0, doubleBeds: 0, babyBeds: 0 });
});

test('dropOffForWindow: aggregates across multiple qualifying reservations', () => {
  const db = makeDb();
  const opt = makeOption(db);
  // Three reservations, all checking out in the window.
  const r1 = makeReservation(db, { startDate: '2026-05-28', endDate: '2026-05-30', singleBeds: 2, doubleBeds: 1 });
  const r2 = makeReservation(db, { startDate: '2026-05-30', endDate: '2026-06-01', singleBeds: 1, babyBeds: 1 });
  const r3 = makeReservation(db, { startDate: '2026-06-01', endDate: '2026-06-02', doubleBeds: 2 });
  linkOption(db, r1, opt);
  linkOption(db, r2, opt);
  linkOption(db, r3, opt);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffForWindow('2026-05-26', '2026-06-02'), { singleBeds: 3, doubleBeds: 3, babyBeds: 1 });
});

// --- Bathroom-linen aggregation (specs §3.5) ---
// Same window/devis/EXISTS semantics as the bed-linen path, but the sum is on
// (adults + teens + children), gated by EXISTS(option with countsAsBathroomLinen = 1).
// Per Adrien's rule (1 large + 1 small per person), largeTowels === smallTowels by
// construction — the model still exposes both keys because the laundry batch is sorted by
// towel type.

test('dropOffBathroomForWindow: contributes (adults + teens + children) when the option is flagged', () => {
  const db = makeDb();
  const opt = makeOption(db, { countsAsBedLinen: 0, countsAsBathroomLinen: 1 });
  const r = makeReservation(db, {
    startDate: '2026-05-30', endDate: '2026-06-02',
    adults: 2, teens: 1, children: 1, babies: 1,
  });
  linkOption(db, r, opt);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(
    model.dropOffBathroomForWindow('2026-05-26', '2026-06-02'),
    // 2 + 1 + 1 = 4 persons → 4 large + 4 small. Baby ignored (no adult-sized towel).
    { largeTowels: 4, mediumTowels: 0, smallTowels: 4 }
  );
});

test('dropOffBathroomForWindow: babies do NOT contribute', () => {
  const db = makeDb();
  const opt = makeOption(db, { countsAsBedLinen: 0, countsAsBathroomLinen: 1 });
  const r = makeReservation(db, {
    startDate: '2026-05-30', endDate: '2026-06-02',
    adults: 0, teens: 0, children: 0, babies: 3,
  });
  linkOption(db, r, opt);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffBathroomForWindow('2026-05-26', '2026-06-02'), { largeTowels: 0, mediumTowels: 0, smallTowels: 0 });
});

test('dropOffBathroomForWindow: reservation WITHOUT a bathroom-flagged option contributes nothing', () => {
  // The bed-linen flag alone is NOT enough — the two flags are independent signals.
  const db = makeDb();
  const opt = makeOption(db, { countsAsBedLinen: 1, countsAsBathroomLinen: 0 });
  const r = makeReservation(db, {
    startDate: '2026-05-30', endDate: '2026-06-02',
    adults: 2, teens: 1, children: 1,
  });
  linkOption(db, r, opt);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffBathroomForWindow('2026-05-26', '2026-06-02'), { largeTowels: 0, mediumTowels: 0, smallTowels: 0 });
});

test('dropOffBathroomForWindow: devis-stage reservations excluded', () => {
  const db = makeDb();
  const opt = makeOption(db, { countsAsBedLinen: 0, countsAsBathroomLinen: 1 });
  const r = makeReservation(db, {
    kind: 'devis', startDate: '2026-05-30', endDate: '2026-06-02',
    adults: 5,
  });
  linkOption(db, r, opt);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffBathroomForWindow('2026-05-26', '2026-06-02'), { largeTowels: 0, mediumTowels: 0, smallTowels: 0 });
});

test('dropOffBathroomForWindow: half-open window matches the bed-linen rule', () => {
  const db = makeDb();
  const opt = makeOption(db, { countsAsBedLinen: 0, countsAsBathroomLinen: 1 });
  // endDate exactly on the start bound → excluded.
  const rOut = makeReservation(db, { startDate: '2026-05-22', endDate: '2026-05-26', adults: 3 });
  linkOption(db, rOut, opt);
  // endDate exactly on the end bound → included.
  const rIn = makeReservation(db, { startDate: '2026-06-01', endDate: '2026-06-02', adults: 2 });
  linkOption(db, rIn, opt);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffBathroomForWindow('2026-05-26', '2026-06-02'), { largeTowels: 2, mediumTowels: 0, smallTowels: 2 });
});

test('dropOffBathroomForWindow: aggregates across multiple qualifying reservations', () => {
  const db = makeDb();
  const opt = makeOption(db, { countsAsBedLinen: 0, countsAsBathroomLinen: 1 });
  const r1 = makeReservation(db, { startDate: '2026-05-28', endDate: '2026-05-30', adults: 2 });
  const r2 = makeReservation(db, { startDate: '2026-05-30', endDate: '2026-06-01', adults: 1, teens: 1 });
  const r3 = makeReservation(db, { startDate: '2026-06-01', endDate: '2026-06-02', children: 3 });
  linkOption(db, r1, opt);
  linkOption(db, r2, opt);
  linkOption(db, r3, opt);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffBathroomForWindow('2026-05-26', '2026-06-02'), { largeTowels: 7, mediumTowels: 0, smallTowels: 7 });
});

test('dropOffBathroomForWindow: quantity SCALES the person count (Adrien\'s prod scenario)', () => {
  // The towel option is `priceType = per_person` and Adrien uses the reservation_options.quantity
  // field as a sub-occupation factor — qty 0.6667 on a 3-person stay = "2 of the 3 want towels".
  // Each reservation's contribution must be persons × qtySum then ROUND'ed.
  //   Gite 1 (12 pers × 1.0) + Tente (3 pers × 0.6667) + Gite 2 (8 pers × 0.625) = 12 + 2 + 5 = 19.
  // Pinned from the actual prod data 2026-06-02.
  const db = makeDb();
  const opt = makeOption(db, { countsAsBedLinen: 0, countsAsBathroomLinen: 1 });

  const gite1 = makeReservation(db, { startDate: '2026-06-02', endDate: '2026-06-04', adults: 8, children: 4, babies: 1 });
  linkOption(db, gite1, opt, { quantity: 1.0 });
  const tente = makeReservation(db, { startDate: '2026-06-02', endDate: '2026-06-06', adults: 1, children: 2 });
  linkOption(db, tente, opt, { quantity: 0.6667 });
  const gite2 = makeReservation(db, { startDate: '2026-06-04', endDate: '2026-06-07', adults: 5, children: 3 });
  linkOption(db, gite2, opt, { quantity: 0.625 });

  const model = laundryModel.buildModel(db);
  assert.deepEqual(
    model.dropOffBathroomForWindow('2026-06-02', '2026-06-09'),
    { largeTowels: 19, mediumTowels: 0, smallTowels: 19 }
  );
});

test('dropOffBathroomForWindow: multiple bathroom-flagged options on one reservation → quantities ADD', () => {
  // Edge case (out of steady-state — rule 16 says only one seeded option carries the flag).
  // Pinned so the SQL subquery's SUM behaviour is documented. With quantities adding, two
  // "fully active" bathroom options on a 3-person stay give person × 2 = 6 towels.
  const db = makeDb();
  const optA = makeOption(db, { title: 'Linge de toilette A', countsAsBedLinen: 0, countsAsBathroomLinen: 1 });
  const optB = makeOption(db, { title: 'Linge de toilette B', countsAsBedLinen: 0, countsAsBathroomLinen: 1 });
  const r = makeReservation(db, { startDate: '2026-05-30', endDate: '2026-06-02', adults: 2, teens: 1 });
  linkOption(db, r, optA, { quantity: 1.0 });
  linkOption(db, r, optB, { quantity: 1.0 });

  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffBathroomForWindow('2026-05-26', '2026-06-02'), { largeTowels: 6, mediumTowels: 0, smallTowels: 6 });
});

test('dropOffBathroomForWindow: ROUND on each reservation\'s contribution, not on the global sum', () => {
  // Per-reservation rounding gives integer towel counts per booking ("how many towels for
  // THIS reservation"). Two reservations: 5 pers × 0.5 = 2.5 → ROUND = 3 (banker\'s, but
  // SQLite ROUND rounds half away from zero → 3). Sum of rounded = 6.
  const db = makeDb();
  const opt = makeOption(db, { countsAsBedLinen: 0, countsAsBathroomLinen: 1 });
  const r1 = makeReservation(db, { startDate: '2026-05-30', endDate: '2026-06-01', adults: 5 });
  const r2 = makeReservation(db, { startDate: '2026-05-30', endDate: '2026-06-02', adults: 5 });
  linkOption(db, r1, opt, { quantity: 0.5 });
  linkOption(db, r2, opt, { quantity: 0.5 });

  const model = laundryModel.buildModel(db);
  // 2.5 + 2.5 rounded per-reservation → 3 + 3 = 6 (verifies SQLite ROUND'd each, then summed).
  assert.deepEqual(model.dropOffBathroomForWindow('2026-05-26', '2026-06-02'), { largeTowels: 6, mediumTowels: 0, smallTowels: 6 });
});

test('dropOffBathroomForWindow: empty DB returns zeros', () => {
  const db = makeDb();
  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffBathroomForWindow('2026-05-26', '2026-06-02'), { largeTowels: 0, mediumTowels: 0, smallTowels: 0 });
});

// --- §3.5.ter — per-type configuration on the linen options ---

test('dropOffForWindow: option with linenIncludesBaby=0 hides baby beds (other types unchanged)', () => {
  const db = makeDb();
  // Operator unchecked "Drap bébé" on the bed-linen option — baby beds must NOT be counted.
  const opt = makeOption(db, { linenIncludesBaby: 0 });
  const r = makeReservation(db, { startDate: '2026-05-30', endDate: '2026-06-02', singleBeds: 2, doubleBeds: 1, babyBeds: 4 });
  linkOption(db, r, opt);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffForWindow('2026-05-26', '2026-06-02'), { singleBeds: 2, doubleBeds: 1, babyBeds: 0 });
});

test('dropOffForWindow: option with linenIncludesSingle=0 + linenIncludesDouble=0 hides those sums', () => {
  const db = makeDb();
  const opt = makeOption(db, { linenIncludesSingle: 0, linenIncludesDouble: 0 });
  const r = makeReservation(db, { startDate: '2026-05-30', endDate: '2026-06-02', singleBeds: 5, doubleBeds: 5, babyBeds: 1 });
  linkOption(db, r, opt);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffForWindow('2026-05-26', '2026-06-02'), { singleBeds: 0, doubleBeds: 0, babyBeds: 1 });
});

test('dropOffBathroomForWindow: towelMediumPerPerson > 0 ADDS a medium counter (per-person multiplier)', () => {
  // Operator sets large=1, medium=1, small=2 per person. On a 4-person stay with qty 1.0:
  //   large = 4×1×1 = 4, medium = 4×1×1 = 4, small = 4×1×2 = 8.
  const db = makeDb();
  const opt = makeOption(db, {
    countsAsBedLinen: 0, countsAsBathroomLinen: 1,
    towelLargePerPerson: 1, towelMediumPerPerson: 1, towelSmallPerPerson: 2,
  });
  const r = makeReservation(db, { startDate: '2026-05-30', endDate: '2026-06-02', adults: 2, teens: 1, children: 1 });
  linkOption(db, r, opt, { quantity: 1.0 });

  const model = laundryModel.buildModel(db);
  assert.deepEqual(
    model.dropOffBathroomForWindow('2026-05-26', '2026-06-02'),
    { largeTowels: 4, mediumTowels: 4, smallTowels: 8 }
  );
});

test('dropOffBathroomForWindow: towel*PerPerson = 0 silences that size (client filters at render)', () => {
  // Adrien's default after this follow-up: medium = 0. The medium key still appears in the
  // payload (set to 0); the client side hides the line.
  const db = makeDb();
  const opt = makeOption(db, {
    countsAsBedLinen: 0, countsAsBathroomLinen: 1,
    towelLargePerPerson: 1, towelMediumPerPerson: 0, towelSmallPerPerson: 1,
  });
  const r = makeReservation(db, { startDate: '2026-05-30', endDate: '2026-06-02', adults: 5 });
  linkOption(db, r, opt, { quantity: 1.0 });

  const model = laundryModel.buildModel(db);
  assert.deepEqual(
    model.dropOffBathroomForWindow('2026-05-26', '2026-06-02'),
    { largeTowels: 5, mediumTowels: 0, smallTowels: 5 }
  );
});

// --- §3.7 — property-default fallback (2026-06-03) ---
// When a property has a linen option declared as default, EVERY reservation of that property
// counts towards the laundry — past and future — even when the option is not in
// `reservation_options`. The explicit row (when present) still wins as a strict override.

test('dropOffForWindow: property default of a VISIBLE option does NOT count an unticked reservation', () => {
  // specs/laundry-counts-explicit-option-only.md §3.1 rule 3. Bed linen only became mandatory on
  // the lodge in June 2026, so a property default cannot be read as a retroactive contract on a
  // stay where the operator did not tick the option. The ticked row is the only signal.
  const db = makeDb();
  const opt = makeOption(db); // displayToClient = 1 → visible
  makeReservation(db, {
    propertyId: 10, startDate: '2026-05-30', endDate: '2026-06-02',
    singleBeds: 2, doubleBeds: 1, babyBeds: 1,
  });
  // No linkOption(...) call — the reservation has no explicit linen row.
  makePropertyOptionDefault(db, 10, opt);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(
    model.dropOffForWindow('2026-05-26', '2026-06-02'),
    { singleBeds: 0, doubleBeds: 0, babyBeds: 0 }
  );
});

test('dropOffForWindow: property default of an INTERNAL option still counts (its only possible source)', () => {
  // specs/laundry-counts-explicit-option-only.md §3.1 rule 4. An internal option is never written
  // to reservation_options (reservationsModel.insertOptions + the iCal import both skip it), so
  // dropping its property-default source would silently zero it forever.
  const db = makeDb();
  const opt = makeOption(db, { title: 'Linge interne', displayToClient: 0 });
  makeReservation(db, {
    propertyId: 10, startDate: '2026-05-30', endDate: '2026-06-02',
    singleBeds: 2, doubleBeds: 1, babyBeds: 1,
  });
  makePropertyOptionDefault(db, 10, opt);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(
    model.dropOffForWindow('2026-05-26', '2026-06-02'),
    { singleBeds: 2, doubleBeds: 1, babyBeds: 1 }
  );
});

test('dropOffForWindow: property default DOES NOT count a reservation of a different property', () => {
  // Gite has the default → Tente reservations must not be inflated by it.
  const db = makeDb();
  const opt = makeOption(db);
  makePropertyOptionDefault(db, 10, opt); // Gite default only.
  makeReservation(db, {
    propertyId: 99, startDate: '2026-05-30', endDate: '2026-06-02',
    singleBeds: 5, doubleBeds: 5,
  });

  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffForWindow('2026-05-26', '2026-06-02'), { singleBeds: 0, doubleBeds: 0, babyBeds: 0 });
});

test('dropOffForWindow: explicit row WINS over the property default (operator intent preserved)', () => {
  // The property has a default that says "include all bed types". The reservation has an
  // explicit row pointing at an option with linenIncludesBaby = 0 (operator unticked baby).
  // The explicit row's includes flags must drive the aggregation; the default is suppressed
  // by NOT EXISTS in source 2.
  const db = makeDb();
  const optDefault = makeOption(db, { title: 'Linge de lit default', linenIncludesBaby: 1 });
  const optExplicit = makeOption(db, { title: 'Linge de lit no baby', linenIncludesBaby: 0 });
  const r = makeReservation(db, {
    propertyId: 10, startDate: '2026-05-30', endDate: '2026-06-02',
    singleBeds: 2, doubleBeds: 1, babyBeds: 4,
  });
  linkOption(db, r, optExplicit);            // explicit row → source 1
  makePropertyOptionDefault(db, 10, optDefault); // property default → source 2 suppressed

  const model = laundryModel.buildModel(db);
  // 4 baby beds excluded because the explicit option had linenIncludesBaby = 0.
  assert.deepEqual(model.dropOffForWindow('2026-05-26', '2026-06-02'), { singleBeds: 2, doubleBeds: 1, babyBeds: 0 });
});

test('dropOffForWindow: a PAST reservation that pre-dates the property default stays out', () => {
  // Adrien's prod case (2026-08-11): stays booked before bed linen became mandatory on the lodge
  // legitimately carry no linen. Turning the option into a property default must not retro-fit a
  // contract onto them — otherwise removing linen from a booking becomes impossible.
  const db = makeDb();
  const opt = makeOption(db);
  // Past-style reservation: no option ticked.
  makeReservation(db, {
    propertyId: 10, startDate: '2026-05-30', endDate: '2026-06-01',
    singleBeds: 3, doubleBeds: 2,
  });
  makePropertyOptionDefault(db, 10, opt);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffForWindow('2026-05-26', '2026-06-02'), { singleBeds: 0, doubleBeds: 0, babyBeds: 0 });
});

test('dropOffForWindow: schema without displayToClient falls back to explicit-row-only', () => {
  // specs/laundry-counts-explicit-option-only.md §3.1 rule 5 — a partially-migrated DB reads every
  // option as visible, so the property default never conjures a contract. No crash either.
  const db = makeDb();
  db.exec('ALTER TABLE options DROP COLUMN displayToClient');
  const opt = db.prepare('INSERT INTO options (title, countsAsBedLinen) VALUES (?, 1)').run('Linge de lit').lastInsertRowid;
  const r = makeReservation(db, {
    propertyId: 10, startDate: '2026-05-30', endDate: '2026-06-02', singleBeds: 3, doubleBeds: 2,
  });
  makePropertyOptionDefault(db, 10, Number(opt));

  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffForWindow('2026-05-26', '2026-06-02'), { singleBeds: 0, doubleBeds: 0, babyBeds: 0 });
  linkOption(db, r, Number(opt));
  const model2 = laundryModel.buildModel(db);
  assert.deepEqual(model2.dropOffForWindow('2026-05-26', '2026-06-02'), { singleBeds: 3, doubleBeds: 2, babyBeds: 0 });
});

test('dropOffForWindow: devis-stage reservation excluded even when the property has a default', () => {
  // The kind filter still wins — defaults don't lift devis into the count.
  const db = makeDb();
  const opt = makeOption(db);
  makeReservation(db, {
    kind: 'devis', propertyId: 10, startDate: '2026-05-30', endDate: '2026-06-02',
    singleBeds: 2, doubleBeds: 1,
  });
  makePropertyOptionDefault(db, 10, opt);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffForWindow('2026-05-26', '2026-06-02'), { singleBeds: 0, doubleBeds: 0, babyBeds: 0 });
});

// --- Bathroom-linen mirror ---

test('dropOffBathroomForWindow: property default of a VISIBLE option conjures no towel', () => {
  // specs/laundry-counts-explicit-option-only.md §3.1 rule 3 — bath linen is an extra sold at
  // arrival: not ticked means not provided.
  const db = makeDb();
  const opt = makeOption(db, {
    countsAsBedLinen: 0, countsAsBathroomLinen: 1,
    towelLargePerPerson: 1, towelMediumPerPerson: 0, towelSmallPerPerson: 1,
  });
  makeReservation(db, {
    propertyId: 10, startDate: '2026-05-30', endDate: '2026-06-02',
    adults: 3, children: 1, babies: 1,
  });
  makePropertyOptionDefault(db, 10, opt);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(
    model.dropOffBathroomForWindow('2026-05-26', '2026-06-02'),
    { largeTowels: 0, mediumTowels: 0, smallTowels: 0 }
  );
});

test('dropOffBathroomForWindow: property default of an INTERNAL option still counts, qty 1.0', () => {
  // Rule 4 mirror on the bathroom path: qty = 1.0 ("the whole party") × persons × perPerson.
  const db = makeDb();
  const opt = makeOption(db, {
    countsAsBedLinen: 0, countsAsBathroomLinen: 1, displayToClient: 0,
    towelLargePerPerson: 1, towelMediumPerPerson: 0, towelSmallPerPerson: 1,
  });
  makeReservation(db, {
    propertyId: 10, startDate: '2026-05-30', endDate: '2026-06-02',
    adults: 3, children: 1, babies: 1, // babies excluded → 4 persons
  });
  makePropertyOptionDefault(db, 10, opt);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(
    model.dropOffBathroomForWindow('2026-05-26', '2026-06-02'),
    { largeTowels: 4, mediumTowels: 0, smallTowels: 4 }
  );
});

test('dropOffBathroomForWindow: explicit quantity (sub-occupation factor) WINS over the property default', () => {
  // Reservation has the option with qty 0.6667 (= "2 of 3 want towels"); property also has it
  // as default. Source 1 wins → 3 × 0.6667 ≈ 2.0001 → ROUND = 2. NOT 3 × 1.0 = 3.
  const db = makeDb();
  const opt = makeOption(db, {
    countsAsBedLinen: 0, countsAsBathroomLinen: 1,
    towelLargePerPerson: 1, towelMediumPerPerson: 0, towelSmallPerPerson: 1,
  });
  const r = makeReservation(db, {
    propertyId: 10, startDate: '2026-05-30', endDate: '2026-06-02',
    adults: 1, children: 2, // 3 persons
  });
  linkOption(db, r, opt, { quantity: 0.6667 });
  makePropertyOptionDefault(db, 10, opt);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(
    model.dropOffBathroomForWindow('2026-05-26', '2026-06-02'),
    { largeTowels: 2, mediumTowels: 0, smallTowels: 2 }
  );
});

test('dropOffBathroomForWindow: property default DOES NOT cross properties', () => {
  const db = makeDb();
  const opt = makeOption(db, { countsAsBedLinen: 0, countsAsBathroomLinen: 1 });
  makePropertyOptionDefault(db, 10, opt);
  makeReservation(db, {
    propertyId: 99, startDate: '2026-05-30', endDate: '2026-06-02', adults: 4,
  });
  const model = laundryModel.buildModel(db);
  assert.deepEqual(
    model.dropOffBathroomForWindow('2026-05-26', '2026-06-02'),
    { largeTowels: 0, mediumTowels: 0, smallTowels: 0 }
  );
});

// --- incompleteBedConfigForWindow (specs/laundry-counts-explicit-option-only.md §3.2) ---
//
// Now that the ticked option is the only signal, a stay that declares bed linen with no quantity
// saved yet contributes a silent zero. These pin the list the Planning card uses to say so.

test('incompleteBedConfigForWindow: flags a ticked-option stay whose bed counts are all zero', () => {
  const db = makeDb();
  const opt = makeOption(db);
  const r = makeReservation(db, {
    propertyId: 10, startDate: '2026-05-30', endDate: '2026-06-02',
    singleBeds: 0, doubleBeds: 0, babyBeds: 0,
  });
  linkOption(db, r, opt);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(
    model.incompleteBedConfigForWindow('2026-05-26', '2026-06-02'),
    [{ id: r, clientName: `#${r}`, propertyName: '', endDate: '2026-06-02' }],
  );
});

test('incompleteBedConfigForWindow: a stay WITH bed counts is not flagged', () => {
  const db = makeDb();
  const opt = makeOption(db);
  const r = makeReservation(db, {
    propertyId: 10, startDate: '2026-05-30', endDate: '2026-06-02', doubleBeds: 1,
  });
  linkOption(db, r, opt);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.incompleteBedConfigForWindow('2026-05-26', '2026-06-02'), []);
});

test('incompleteBedConfigForWindow: a stay WITHOUT the option is not flagged (it declares no linen)', () => {
  const db = makeDb();
  const opt = makeOption(db);
  makePropertyOptionDefault(db, 10, opt); // property default is NOT a declaration (rule 3)
  makeReservation(db, {
    propertyId: 10, startDate: '2026-05-30', endDate: '2026-06-02',
    singleBeds: 0, doubleBeds: 0,
  });

  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.incompleteBedConfigForWindow('2026-05-26', '2026-06-02'), []);
});

test('incompleteBedConfigForWindow: devis excluded, and the window stays half-open', () => {
  const db = makeDb();
  const opt = makeOption(db);
  const devis = makeReservation(db, { kind: 'devis', propertyId: 10, startDate: '2026-05-30', endDate: '2026-06-02' });
  linkOption(db, devis, opt);
  const onLeftBound = makeReservation(db, { propertyId: 10, startDate: '2026-05-20', endDate: '2026-05-26' });
  linkOption(db, onLeftBound, opt);
  const onRightBound = makeReservation(db, { propertyId: 10, startDate: '2026-05-30', endDate: '2026-06-02' });
  linkOption(db, onRightBound, opt);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(
    model.incompleteBedConfigForWindow('2026-05-26', '2026-06-02').map((x) => x.id),
    [onRightBound],
  );
});
