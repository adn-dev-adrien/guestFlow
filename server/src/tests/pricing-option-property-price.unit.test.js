const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;

// specs/per-property-option-prices.md — the pricing engine must price a selected option at its
// EFFECTIVE per-property price: the property_option_prices override when present, else the base
// price. An explicit override of 0 is a real free line.

function createDb({ override } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL,
      depositPercent REAL DEFAULT 30, depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
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
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT NOT NULL, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0, optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0, autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL NOT NULL DEFAULT 0, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0, propertyIds TEXT DEFAULT '[]');
    CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Logement')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (10, 'Ménage', 'per_stay', 40)").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 10)').run();
  if (override !== undefined) {
    db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price) VALUES (1, 10, ?)').run(override);
  }
  return db;
}

const BASE = {
  propertyId: 1, startDate: '2026-07-10', endDate: '2026-07-12', // 2 × 100 = 200
  checkInTime: '15:00', checkOutTime: '10:00', adults: 2, children: 0, teens: 0,
  customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
  selectedOptions: [{ optionId: 10, quantity: 1 }],
};

test('no override → option priced at its base price (regression guard)', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db });
  assert.equal(q.optionLines.find((l) => l.optionId === 10).totalPrice, 40);
  assert.equal(q.finalPrice, 240); // 200 + 40
  db.close();
});

test('per-property override → option priced at the override, not the base', () => {
  const db = createDb({ override: 60 });
  const q = calculateReservationQuote({ ...BASE, db });
  assert.equal(q.optionLines.find((l) => l.optionId === 10).totalPrice, 60, 'uses the 60 € override');
  assert.equal(q.finalPrice, 260); // 200 + 60
  db.close();
});

test('explicit override of 0 → the option is free for this property', () => {
  const db = createDb({ override: 0 });
  const q = calculateReservationQuote({ ...BASE, db });
  assert.equal(q.optionLines.find((l) => l.optionId === 10).totalPrice, 0);
  assert.equal(q.finalPrice, 200);
  db.close();
});
