const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;

// specs/option-planning-card.md §3.4 — for a `showsPlanningCard` option the SELECTED occurrences
// REPLACE the automatic nights/days path: billedUnits = occurrences × (persons if per-person else 1).

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL,
      depositPercent REAL DEFAULT 30, depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0,
      maxGuests INTEGER DEFAULT 0
    );
    CREATE TABLE pricing_rules (
      id INTEGER PRIMARY KEY, propertyId INTEGER NOT NULL, label TEXT DEFAULT 'Standard',
      pricePerNight REAL NOT NULL DEFAULT 100, pricingMode TEXT NOT NULL DEFAULT 'fixed',
      progressiveTiers TEXT NOT NULL DEFAULT '[]', dateRanges TEXT NOT NULL DEFAULT '[]',
      color TEXT NOT NULL DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1
    );
    CREATE TABLE options (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0,
      optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0,
      autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT,
      showsPlanningCard INTEGER NOT NULL DEFAULT 0, cardRepeat TEXT DEFAULT 'once',
      planningCardDate TEXT, planningCardTimes TEXT
    );
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL NOT NULL DEFAULT 0, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0, propertyIds TEXT DEFAULT '[]');
    CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Logement')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  // id=20 fixed-price card option (10 €); id=21 per-person card option (5 €).
  db.prepare("INSERT INTO options (id, title, priceType, price, showsPlanningCard, cardRepeat) VALUES (20, 'Repas', 'per_stay', 10, 1, 'daily')").run();
  db.prepare("INSERT INTO options (id, title, priceType, price, showsPlanningCard, cardRepeat) VALUES (21, 'Repas/pers', 'per_person', 5, 1, 'daily')").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 20), (1, 21)').run();
  return db;
}

const BASE = {
  propertyId: 1, startDate: '2026-07-10', endDate: '2026-07-13', // 3 × 100 = 300
  checkInTime: '15:00', checkOutTime: '10:00', adults: 4, children: 0, teens: 0,
  customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
};

test('fixed-price card option: billedUnits = selected occurrences (× 1)', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, db,
    selectedOptions: [{ optionId: 20, quantity: 1, cardOccurrences: [
      { date: '2026-07-10', time: '12:00' },
      { date: '2026-07-11', time: '12:00' },
      { date: '2026-07-12', time: '12:00' },
    ] }],
  });
  const line = q.optionLines.find((l) => l.optionId === 20);
  assert.equal(line.billedUnits, 3, '3 occurrences × 1');
  assert.equal(line.totalPrice, 30); // 3 × 10
  assert.equal(q.finalPrice, 330); // 300 + 30
  db.close();
});

test('per-person card option: billedUnits = occurrences × persons (4 guests × 2 days = 8)', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, db,
    selectedOptions: [{ optionId: 21, quantity: 1, cardOccurrences: [
      { date: '2026-07-10', time: '08:00' },
      { date: '2026-07-11', time: '08:00' },
    ] }],
  });
  const line = q.optionLines.find((l) => l.optionId === 21);
  assert.equal(line.billedUnits, 8, '2 occurrences × 4 persons');
  assert.equal(line.totalPrice, 40); // 8 × 5
  db.close();
});

test('3 slots/day × 3 days × 4 guests = 36 (per-person)', () => {
  const db = createDb();
  const occ = [];
  for (const d of ['2026-07-10', '2026-07-11', '2026-07-12']) {
    for (const t of ['08:00', '12:30', '19:30']) occ.push({ date: d, time: t });
  }
  const q = calculateReservationQuote({ ...BASE, db, selectedOptions: [{ optionId: 21, quantity: 1, cardOccurrences: occ }] });
  const line = q.optionLines.find((l) => l.optionId === 21);
  assert.equal(line.billedUnits, 36, '9 occurrences × 4 persons');
  assert.equal(line.totalPrice, 180); // 36 × 5
  db.close();
});

test('no selected occurrences → no line, no charge', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, selectedOptions: [{ optionId: 20, quantity: 1, cardOccurrences: [] }] });
  assert.equal(q.optionLines.find((l) => l.optionId === 20), undefined);
  assert.equal(q.finalPrice, 300);
  db.close();
});

test('card option carries its occurrences on the line (for persistence)', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, db,
    selectedOptions: [{ optionId: 20, quantity: 1, cardOccurrences: [{ date: '2026-07-11', time: '12:00' }] }],
  });
  const line = q.optionLines.find((l) => l.optionId === 20);
  assert.deepEqual(line.cardOccurrences, [{ date: '2026-07-11', time: '12:00', done: false }]);
  db.close();
});

// specs/devis-extras-parity-and-price-lock.md §3 rule 13bis — a card option is billed from its
// occurrences, so it never went through the units-based locked merge and was silently re-priced at
// today's tariff on every save of an already-sold booking.

const TWO_MORNINGS = [
  { date: '2026-07-10', time: '08:00' },
  { date: '2026-07-11', time: '08:00' },
];

test('a sold card option keeps its unit price when the tariff rises', () => {
  const db = createDb();
  db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price) VALUES (1, 21, 8)').run();
  const q = calculateReservationQuote({
    ...BASE, db,
    selectedOptions: [{ optionId: 21, quantity: 1, cardOccurrences: TWO_MORNINGS }],
    lockedOptionLines: [{ optionId: 21, quantity: 2, unitPrice: 5, billedUnits: 8, priceType: 'per_person', totalPrice: 40, offered: 0 }],
  });
  const line = q.optionLines.find((l) => l.optionId === 21);
  assert.equal(line.unitPrice, 5, 'sold at 5 €, not re-priced to 8 €');
  assert.equal(line.totalPrice, 40);
  db.close();
});

test('an occurrence added to a sold card option is billed at the sold price too', () => {
  const db = createDb();
  db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price) VALUES (1, 21, 8)').run();
  const q = calculateReservationQuote({
    ...BASE, db,
    selectedOptions: [{ optionId: 21, quantity: 1, cardOccurrences: [...TWO_MORNINGS, { date: '2026-07-12', time: '08:00' }] }],
    lockedOptionLines: [{ optionId: 21, quantity: 2, unitPrice: 5, billedUnits: 8, priceType: 'per_person', totalPrice: 40, offered: 0 }],
  });
  const line = q.optionLines.find((l) => l.optionId === 21);
  assert.equal(line.billedUnits, 12, '3 occurrences × 4 persons');
  assert.equal(line.totalPrice, 60, '12 × the sold 5 €');
  db.close();
});

test('an offered card line replays its sold unit price once un-offered', () => {
  const db = createDb();
  db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price) VALUES (1, 21, 8)').run();
  const q = calculateReservationQuote({
    ...BASE, db,
    selectedOptions: [{ optionId: 21, quantity: 1, cardOccurrences: TWO_MORNINGS }],
    // Offered → stored with totalPrice = 0; the unit price is what survives.
    lockedOptionLines: [{ optionId: 21, quantity: 2, unitPrice: 5, billedUnits: 8, priceType: 'per_person', totalPrice: 0, offered: 1 }],
  });
  const line = q.optionLines.find((l) => l.optionId === 21);
  assert.equal(line.totalPrice, 40, 'back to the sold 5 €/unit, not the catalogue 8 €');
  db.close();
});

test('« utiliser les tarifs actuels » (no locked lines) re-prices the card option', () => {
  const db = createDb();
  db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price) VALUES (1, 21, 8)').run();
  const q = calculateReservationQuote({
    ...BASE, db,
    selectedOptions: [{ optionId: 21, quantity: 1, cardOccurrences: TWO_MORNINGS }],
    lockedOptionLines: [],
  });
  const line = q.optionLines.find((l) => l.optionId === 21);
  assert.equal(line.unitPrice, 8);
  assert.equal(line.totalPrice, 64); // 8 units × 8
  db.close();
});

test('a card option added to an existing booking is priced at today’s tariff', () => {
  const db = createDb();
  db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price) VALUES (1, 21, 8)').run();
  const q = calculateReservationQuote({
    ...BASE, db,
    selectedOptions: [{ optionId: 21, quantity: 1, cardOccurrences: TWO_MORNINGS }],
    // The booking carries another option only — nothing locked for 21.
    lockedOptionLines: [{ optionId: 20, quantity: 1, unitPrice: 10, billedUnits: 1, priceType: 'per_stay', totalPrice: 10, offered: 0 }],
  });
  const line = q.optionLines.find((l) => l.optionId === 21);
  assert.equal(line.unitPrice, 8);
  assert.equal(line.totalPrice, 64);
  db.close();
});

// specs/card-option-served-persons.md §3.1 — a per-person card option is not always taken by the
// whole party (the children skip the meal): `cardPersons` says how many covers each moment serves.

test('cardPersons lowers the covers: 2 moments × 2 served instead of × 4 guests', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, db,
    selectedOptions: [{ optionId: 21, quantity: 1, cardPersons: 2, cardOccurrences: TWO_MORNINGS }],
  });
  const line = q.optionLines.find((l) => l.optionId === 21);
  assert.equal(line.billedUnits, 4, '2 occurrences × 2 served');
  assert.equal(line.totalPrice, 20); // 4 × 5
  assert.equal(line.cardPersons, 2, 'persisted as the operator decision');
  db.close();
});

test('cardPersons equal to the party is stored as NULL (the line keeps following the party)', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, db,
    selectedOptions: [{ optionId: 21, quantity: 1, cardPersons: 4, cardOccurrences: TWO_MORNINGS }],
  });
  const line = q.optionLines.find((l) => l.optionId === 21);
  assert.equal(line.billedUnits, 8, 'billed like the whole party');
  assert.equal(line.cardPersons, null);
  db.close();
});

test('no cardPersons → the whole party, exactly as before', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, db,
    selectedOptions: [{ optionId: 21, quantity: 1, cardOccurrences: TWO_MORNINGS }],
  });
  const line = q.optionLines.find((l) => l.optionId === 21);
  assert.equal(line.billedUnits, 8);
  assert.equal(line.cardPersons, null);
  db.close();
});

test('cardPersons above the party is allowed up to the property capacity', () => {
  const db = createDb();
  db.prepare('UPDATE properties SET maxGuests = 6 WHERE id = 1').run();
  const q = calculateReservationQuote({
    ...BASE, db,
    selectedOptions: [{ optionId: 21, quantity: 1, cardPersons: 6, cardOccurrences: TWO_MORNINGS }],
  });
  const line = q.optionLines.find((l) => l.optionId === 21);
  assert.equal(line.billedUnits, 12, '2 occurrences × 6 served (a friend joined for dinner)');
  assert.equal(line.cardPersons, 6);
  db.close();
});

test('cardPersons above the capacity is clamped to it', () => {
  const db = createDb();
  db.prepare('UPDATE properties SET maxGuests = 6 WHERE id = 1').run();
  const q = calculateReservationQuote({
    ...BASE, db,
    selectedOptions: [{ optionId: 21, quantity: 1, cardPersons: 99, cardOccurrences: TWO_MORNINGS }],
  });
  const line = q.optionLines.find((l) => l.optionId === 21);
  assert.equal(line.cardPersons, 6);
  assert.equal(line.billedUnits, 12);
  db.close();
});

test('capacity not configured (maxGuests = 0) → the ceiling is the party', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, db,
    selectedOptions: [{ optionId: 21, quantity: 1, cardPersons: 99, cardOccurrences: TWO_MORNINGS }],
  });
  const line = q.optionLines.find((l) => l.optionId === 21);
  assert.equal(line.billedUnits, 8, 'clamped back to the 4 guests');
  assert.equal(line.cardPersons, null);
  db.close();
});

test('cardPersons 0 or negative falls back to the party (a prestation is removed by unticking)', () => {
  const db = createDb();
  for (const bogus of [0, -3]) {
    const q = calculateReservationQuote({
      ...BASE, db,
      selectedOptions: [{ optionId: 21, quantity: 1, cardPersons: bogus, cardOccurrences: TWO_MORNINGS }],
    });
    const line = q.optionLines.find((l) => l.optionId === 21);
    assert.equal(line.billedUnits, 8, `cardPersons ${bogus} → the party`);
    assert.equal(line.cardPersons, null);
  }
  db.close();
});

test('a fixed-price card option ignores cardPersons (the covers do not bite)', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, db,
    selectedOptions: [{ optionId: 20, quantity: 1, cardPersons: 2, cardOccurrences: TWO_MORNINGS }],
  });
  const line = q.optionLines.find((l) => l.optionId === 20);
  assert.equal(line.billedUnits, 2, '2 occurrences × 1');
  assert.equal(line.totalPrice, 20);
  assert.equal(line.cardPersons, null);
  db.close();
});

test('lowering the covers on a SOLD card option keeps the sold unit price', () => {
  const db = createDb();
  db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price) VALUES (1, 21, 8)').run();
  const q = calculateReservationQuote({
    ...BASE, db,
    selectedOptions: [{ optionId: 21, quantity: 1, cardPersons: 2, cardOccurrences: TWO_MORNINGS }],
    lockedOptionLines: [{ optionId: 21, quantity: 2, unitPrice: 5, billedUnits: 8, priceType: 'per_person', totalPrice: 40, offered: 0 }],
  });
  const line = q.optionLines.find((l) => l.optionId === 21);
  assert.equal(line.unitPrice, 5, 'still the sold price');
  assert.equal(line.totalPrice, 20, '4 units × 5 €');
  db.close();
});
