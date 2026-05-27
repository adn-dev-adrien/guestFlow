const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;

// Minimal pricing DB with one per-stay option (price 50) applicable to property 1.
// Base stay = 120/night x 3 nights = 360.
function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL,
      depositPercent REAL DEFAULT 30, depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      vatPercentageAccommodation REAL DEFAULT 20, vatPercentageOptions REAL DEFAULT 20, vatPercentageResources REAL DEFAULT 20,
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
      autoEnabled INTEGER NOT NULL DEFAULT 0, autoPricingMode TEXT NOT NULL DEFAULT 'fixed', autoFullNightThreshold TEXT
    );
    CREATE TABLE property_options ( propertyId INTEGER NOT NULL, optionId INTEGER NOT NULL, PRIMARY KEY (propertyId, optionId) );
    CREATE TABLE resources (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0, priceType TEXT NOT NULL DEFAULT 'per_stay',
      isComplex INTEGER NOT NULL DEFAULT 0, propertyIds TEXT DEFAULT '[]'
    );
    CREATE TABLE property_resource_prices ( propertyId INTEGER NOT NULL, resourceId INTEGER NOT NULL, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId) );
  `);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Maison test')").run();
  db.prepare("INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 120, 1)").run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (1, 'Ménage', 'per_stay', 50)").run();
  db.prepare("INSERT INTO property_options (propertyId, optionId) VALUES (1, 1)").run();
  return db;
}

const BASE_INPUTS = {
  propertyId: 1,
  startDate: '2026-07-10',
  endDate: '2026-07-13',
  checkInTime: '15:00',
  checkOutTime: '10:00',
  adults: 2,
  children: 0,
  teens: 0,
  selectedResources: [],
  depositPaid: false,
  balancePaid: false,
};

test('quote exposes engineFinalPrice + priceOverridden (no override)', () => {
  const db = createDb();
  const quote = calculateReservationQuote({
    ...BASE_INPUTS,
    db,
    discountPercent: 0,
    customPrice: '',
    selectedOptions: [{ optionId: 1, quantity: 1 }],
  });
  assert.equal(quote.finalPrice, 410); // 360 + 50
  assert.equal(quote.engineFinalPrice, 410);
  assert.equal(quote.priceOverridden, false);
  db.close();
});

test('manual override sets finalPrice on accommodation; engineFinalPrice keeps the computed value', () => {
  const db = createDb();
  const quote = calculateReservationQuote({
    ...BASE_INPUTS,
    db,
    discountPercent: 0,
    customPrice: 300, // override accommodation (was 360)
    selectedOptions: [{ optionId: 1, quantity: 1 }],
  });
  assert.equal(quote.priceOverridden, true);
  assert.equal(quote.finalPrice, 350); // 300 override + 50 option
  assert.equal(quote.engineFinalPrice, 410); // 360 engine accommodation + 50 option
  // VAT base for accommodation must follow the override, not the engine price.
  assert.equal(quote.accommodationAdjustedPrice, 300);
  db.close();
});

test('offered option zeroes the billed total but keeps the real price as originalTotalPrice', () => {
  const db = createDb();
  const quote = calculateReservationQuote({
    ...BASE_INPUTS,
    db,
    discountPercent: 0,
    customPrice: '',
    selectedOptions: [{ optionId: 1, quantity: 1 }],
    offeredOptionIds: [1],
  });
  const line = quote.optionLines.find((l) => Number(l.optionId) === 1);
  assert.equal(line.offered, true);
  assert.equal(line.totalPrice, 0);
  assert.equal(line.originalTotalPrice, 50);
  assert.equal(quote.finalPrice, 360); // option billed at 0
  db.close();
});

test('un-offering a locked offered line (stored totalPrice=0) restores the real price — the reported bug', () => {
  const db = createDb();
  // Simulate a saved reservation where the option was offered: totalPrice stored as 0,
  // unitPrice kept at the real 50, billedUnits 1, offered flag set.
  const lockedOptionLines = [
    { optionId: 1, quantity: 1, billedUnits: 1, unitPrice: 50, priceType: 'per_stay', totalPrice: 0, offered: 1 },
  ];
  const quote = calculateReservationQuote({
    ...BASE_INPUTS,
    db,
    discountPercent: 0,
    customPrice: '',
    selectedOptions: [{ optionId: 1, quantity: 1 }],
    offeredOptionIds: [], // user un-offers it (makes it paid again)
    lockedOptionLines,
  });
  const line = quote.optionLines.find((l) => Number(l.optionId) === 1);
  assert.equal(line.offered, false);
  assert.equal(line.totalPrice, 50); // restored, NOT 0
  assert.equal(line.originalTotalPrice, 50);
  assert.equal(quote.finalPrice, 410);
  db.close();
});

test('re-offering a locked offered line keeps it at 0 with the real price recoverable', () => {
  const db = createDb();
  const lockedOptionLines = [
    { optionId: 1, quantity: 1, billedUnits: 1, unitPrice: 50, priceType: 'per_stay', totalPrice: 0, offered: 1 },
  ];
  const quote = calculateReservationQuote({
    ...BASE_INPUTS,
    db,
    discountPercent: 0,
    customPrice: '',
    selectedOptions: [{ optionId: 1, quantity: 1 }],
    offeredOptionIds: [1],
    lockedOptionLines,
  });
  const line = quote.optionLines.find((l) => Number(l.optionId) === 1);
  assert.equal(line.offered, true);
  assert.equal(line.totalPrice, 0);
  assert.equal(line.originalTotalPrice, 50);
  db.close();
});
