// A card option sold without its moments keeps its line (specs/unscheduled-card-option.md).
//
// The engine used to answer `null` for a planning-card option carrying no occurrence, unless the
// public flag was set. Since that flag lives only for the duration of a booking request — the
// conversion does not carry it, the fiche never sends it — a breakfast bought on the website was
// erased the first time anyone opened or saved the reservation, 48 € the guest had already paid.
// These tests pin the rules that replace that behaviour.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing');

function seedDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, maxGuests INTEGER DEFAULT 10,
      depositPercent REAL DEFAULT 30, depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '16:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0
    );
    CREATE TABLE pricing_rules (
      id INTEGER PRIMARY KEY, propertyId INTEGER NOT NULL, label TEXT DEFAULT 'Standard',
      pricePerNight REAL NOT NULL DEFAULT 100, pricingMode TEXT NOT NULL DEFAULT 'fixed',
      progressiveTiers TEXT NOT NULL DEFAULT '[]', dateRanges TEXT NOT NULL DEFAULT '[]',
      color TEXT NOT NULL DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1
    );
    CREATE TABLE options (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '',
      priceType TEXT NOT NULL DEFAULT 'per_stay', price REAL NOT NULL DEFAULT 0,
      optionProgressiveTiers TEXT NOT NULL DEFAULT '[]', autoOptionType TEXT,
      autoEnabled INTEGER NOT NULL DEFAULT 0, autoPricingMode TEXT NOT NULL DEFAULT 'fixed', autoFullNightThreshold TEXT,
      showsPlanningCard INTEGER NOT NULL DEFAULT 0, cardRepeat TEXT DEFAULT 'once_per_day', planningCardTimes TEXT DEFAULT '["09:00"]',
      freeUnitsDirect REAL DEFAULT 0
    );
    CREATE TABLE property_options ( propertyId INTEGER NOT NULL, optionId INTEGER NOT NULL, PRIMARY KEY (propertyId, optionId) );
    CREATE TABLE resources ( id INTEGER PRIMARY KEY, name TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0, price REAL NOT NULL DEFAULT 0, priceType TEXT NOT NULL DEFAULT 'per_stay', isComplex INTEGER NOT NULL DEFAULT 0, propertyIds TEXT DEFAULT '[]', showsPlanningCard INTEGER NOT NULL DEFAULT 0, slotDuration INTEGER NOT NULL DEFAULT 30, hourlyEveningStart TEXT, hourlyEveningRate REAL NOT NULL DEFAULT 0, openTime TEXT DEFAULT '12:00', closeTime TEXT DEFAULT '22:00', minimumUsageMinutes INTEGER DEFAULT 60 );
    CREATE TABLE property_resource_prices ( propertyId INTEGER NOT NULL, resourceId INTEGER NOT NULL, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId) );
  `);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte test')").run();
  db.prepare("INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)").run();
  // « Petit déjeuner », 8 €, per person — the option the website sells by portions.
  db.prepare("INSERT INTO options (id, title, priceType, price, showsPlanningCard, autoOptionType) VALUES (6, 'Petit déjeuner', 'per_person_per_night', 8, 1, 'breakfast')").run();
  db.prepare("INSERT INTO property_options (propertyId, optionId) VALUES (1, 6)").run();
  // « Location salle », 45 €, per group — a card option that is NOT per person.
  db.prepare("INSERT INTO options (id, title, priceType, price, showsPlanningCard) VALUES (7, 'Location salle', 'per_stay', 45, 1)").run();
  db.prepare("INSERT INTO property_options (propertyId, optionId) VALUES (1, 7)").run();
  return db;
}

// 2 adults, 3 nights — the reproduction of the bug report.
const STAY = {
  propertyId: 1, startDate: '2027-03-08', endDate: '2027-03-11',
  adults: 2, children: 0, teens: 0, babies: 0, checkInTime: '16:00', checkOutTime: '10:00',
};

const quote = (db, over) => calculateReservationQuote({ db, ...STAY, ...over });
const breakfastOf = (q) => q.optionLines.find((l) => Number(l.optionId) === 6);

// The line as the website stored it: 6 portions, 48 €, no moment placed.
const SOLD_BREAKFAST = {
  optionId: 6, quantity: 6, unitPrice: 8, billedUnits: 6, priceType: 'per_person_per_night', totalPrice: 48,
};

// ── Rule 1 — the line is never dropped ───────────────────────────────────────────────────────

test('rule 1 — an unplaced card option yields a line even without the public flag', () => {
  const line = breakfastOf(quote(seedDb(), { selectedOptions: [{ optionId: 6, quantity: 6 }] }));
  assert.ok(line, 'the option is taken: it must be billed, not erased');
  assert.equal(line.toBeScheduled, true);
  assert.deepEqual(line.cardOccurrences, []);
});

test('rule 1 — the reproduction: a converted site booking keeps its 48 €', () => {
  const q = quote(seedDb(), {
    selectedOptions: [{ optionId: 6, quantity: 6 }],   // the stored line, no occurrence
    lockedOptionLines: [SOLD_BREAKFAST],
  });
  const line = breakfastOf(q);
  assert.equal(line.billedUnits, 6);
  assert.equal(line.totalPrice, 48);
  assert.equal(q.finalPrice, 348);                     // 300 € of nights + the 48 € the guest paid
});

// ── Rule 2 — placed moments still win ────────────────────────────────────────────────────────

test('rule 2 — occurrences drive the billing exactly as before', () => {
  const line = breakfastOf(quote(seedDb(), {
    selectedOptions: [{
      optionId: 6,
      quantity: 6,
      cardOccurrences: [{ date: '2027-03-09', time: '09:00' }, { date: '2027-03-10', time: '09:00' }, { date: '2027-03-11', time: '09:00' }],
    }],
    lockedOptionLines: [SOLD_BREAKFAST],
  }));
  assert.equal(line.quantity, 3);        // 3 mornings
  assert.equal(line.billedUnits, 6);     // × 2 covers
  assert.equal(line.totalPrice, 48);
  assert.equal(line.toBeScheduled, undefined);
});

// ── Rule 3 — the portions come from the line's own snapshot ──────────────────────────────────

test('rule 3 — an emptied admin grid keeps the portions the line was sold at', () => {
  // The operator unticks every morning of a breakfast sold at 3 mornings × 2 covers. The stale
  // `quantity` on the wire is the old occurrence COUNT (3) — billing it as portions would silently
  // halve the line. The snapshot is what decides.
  const line = breakfastOf(quote(seedDb(), {
    selectedOptions: [{ optionId: 6, quantity: 3, cardOccurrences: [] }],
    lockedOptionLines: [{ ...SOLD_BREAKFAST, quantity: 3 }],
  }));
  assert.equal(line.billedUnits, 6);
  assert.equal(line.totalPrice, 48);
  assert.equal(line.toBeScheduled, true);
});

test('rule 3 — a fresh line with no snapshot falls back on its quantity', () => {
  const line = breakfastOf(quote(seedDb(), { selectedOptions: [{ optionId: 6, quantity: 4 }] }));
  assert.equal(line.billedUnits, 4);
  assert.equal(line.totalPrice, 32);
});

test('rule 3 — a card option that is not per person bills its quantity as is', () => {
  const q = quote(seedDb(), { selectedOptions: [{ optionId: 7, quantity: 2 }] });
  const line = q.optionLines.find((l) => Number(l.optionId) === 7);
  assert.equal(line.billedUnits, 2);
  assert.equal(line.totalPrice, 90);
  assert.equal(line.toBeScheduled, true);
});

// ── Rule 4 — the flag now carries the public cap, and nothing else ───────────────────────────

test('rule 4 — the public flow still clamps at what the stay can serve', () => {
  // 2 persons × 3 mornings = 6 portions maximum (specs/site-meal-portions.md rule 3).
  const line = breakfastOf(quote(seedDb(), {
    selectedOptions: [{ optionId: 6, quantity: 9 }], planningCardAsQuantity: true,
  }));
  assert.equal(line.billedUnits, 6);
  assert.equal(line.clampedFrom, 9);
});

test('rule 4 — an operator is never clamped', () => {
  const line = breakfastOf(quote(seedDb(), { selectedOptions: [{ optionId: 6, quantity: 9 }] }));
  assert.equal(line.billedUnits, 9, 'the cap belongs to the website, not to the fiche');
  assert.equal(line.clampedFrom, null);
});

test('rule 4 — the visitor\'s quantity wins over a snapshot on the public flow', () => {
  // Re-quoting a public devis whose visitor lowered the number: the intent is the new quantity.
  const line = breakfastOf(quote(seedDb(), {
    selectedOptions: [{ optionId: 6, quantity: 2 }],
    lockedOptionLines: [SOLD_BREAKFAST],
    planningCardAsQuantity: true,
  }));
  assert.equal(line.billedUnits, 2);
  assert.equal(line.totalPrice, 16);
});

// ── Rule 5 — the switch is the only way out ──────────────────────────────────────────────────

test('rule 5 — quantity 0 (switch off) removes the line', () => {
  const q = quote(seedDb(), {
    selectedOptions: [{ optionId: 6, quantity: 0, cardOccurrences: [] }],
    lockedOptionLines: [SOLD_BREAKFAST],
  });
  assert.equal(breakfastOf(q), undefined);
  assert.equal(q.finalPrice, 300);
});

// ── Rule 9 — planning less than what was sold is said out loud ───────────────────────────────

test('rule 9 — a planning below the sale reports what was sold', () => {
  const line = breakfastOf(quote(seedDb(), {
    selectedOptions: [{ optionId: 6, quantity: 6, cardOccurrences: [{ date: '2027-03-09', time: '09:00' }] }],
    lockedOptionLines: [SOLD_BREAKFAST],
  }));
  assert.equal(line.billedUnits, 2);   // 1 morning × 2 covers
  assert.equal(line.totalPrice, 16);
  assert.equal(line.soldUnits, 6, 'the fiche shows « planifié 2 · vendu 6 »');
});

test('rule 9 — nothing is reported once the planning matches the sale', () => {
  const line = breakfastOf(quote(seedDb(), {
    selectedOptions: [{
      optionId: 6,
      quantity: 6,
      cardOccurrences: [{ date: '2027-03-09', time: '09:00' }, { date: '2027-03-10', time: '09:00' }, { date: '2027-03-11', time: '09:00' }],
    }],
    lockedOptionLines: [SOLD_BREAKFAST],
  }));
  assert.equal(line.soldUnits, undefined);
});

test('rule 9 — an unplaced line never reports a gap with itself', () => {
  const line = breakfastOf(quote(seedDb(), {
    selectedOptions: [{ optionId: 6, quantity: 6 }],
    lockedOptionLines: [SOLD_BREAKFAST],
  }));
  assert.equal(line.soldUnits, undefined);
});

// ── Edge cases ───────────────────────────────────────────────────────────────────────────────

test('edge — an offered unplaced line is billed 0 € and keeps its real price', () => {
  const q = quote(seedDb(), {
    selectedOptions: [{ optionId: 6, quantity: 6 }],
    lockedOptionLines: [SOLD_BREAKFAST],
    offeredOptionIds: [6],
  });
  const line = breakfastOf(q);
  assert.equal(line.totalPrice, 0);
  assert.equal(line.originalTotalPrice, 48);
  assert.equal(q.finalPrice, 300);
});

test('edge — the served covers still apply once the moments are placed', () => {
  const line = breakfastOf(quote(seedDb(), {
    selectedOptions: [{
      optionId: 6, quantity: 6, cardPersons: 1,
      cardOccurrences: [{ date: '2027-03-09', time: '09:00' }, { date: '2027-03-10', time: '09:00' }],
    }],
    lockedOptionLines: [SOLD_BREAKFAST],
  }));
  assert.equal(line.billedUnits, 2);   // 2 mornings × 1 cover
  assert.equal(line.cardPersons, 1);
});
