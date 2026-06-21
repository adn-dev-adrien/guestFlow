const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;

// specs/per-property-default-options.md — an option that is a property DEFAULT configured « offered »
// (`property_option_defaults.offered = 1`) is INCLUDED in the night rate. The engine tags its line
// `includedInRate` so the fiche summary shows « Comprise » at 0 € instead of « Offert ».

function createDb({ defaultOffered } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 0,
      depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0);
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER, label TEXT, pricePerNight REAL DEFAULT 100, pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]', dateRanges TEXT DEFAULT '[]', color TEXT DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0, optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0, autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE property_option_defaults (propertyId INTEGER, optionId INTEGER, offered INTEGER DEFAULT 0, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0, propertyIds TEXT DEFAULT '[]');
    CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (10, 'Petit-déjeuner', 'per_stay', 25)").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 10)').run();
  if (defaultOffered !== undefined) {
    db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, 10, ?)').run(defaultOffered ? 1 : 0);
  }
  return db;
}

const BASE = {
  propertyId: 1, startDate: '2026-07-10', endDate: '2026-07-12',
  checkInTime: '15:00', checkOutTime: '10:00', adults: 2, children: 0, teens: 0, babies: 0,
  customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
};

const optLine = (q) => q.optionLines.find((l) => l.optionId === 10);

test('property-default option offered → the offered line is tagged includedInRate at 0 €', () => {
  const db = createDb({ defaultOffered: true });
  const q = calculateReservationQuote({
    ...BASE, db,
    selectedOptions: [{ optionId: 10, quantity: 1, offered: 1 }],
    offeredOptionIds: [10],
  });
  const line = optLine(q);
  assert.equal(line.includedInRate, true);
  assert.equal(line.offered, true);
  assert.equal(line.totalPrice, 0);
  db.close();
});

test('a manually-offered option that is NOT a default-offered → NOT includedInRate (geste commercial)', () => {
  const db = createDb({ defaultOffered: false }); // default exists but not offered
  const q = calculateReservationQuote({
    ...BASE, db,
    selectedOptions: [{ optionId: 10, quantity: 1, offered: 1 }],
    offeredOptionIds: [10],
  });
  const line = optLine(q);
  assert.notEqual(line.includedInRate, true);
  assert.equal(line.offered, true);
  db.close();
});

test('no property default at all → manually-offered option is not includedInRate', () => {
  const db = createDb(); // no property_option_defaults row
  const q = calculateReservationQuote({
    ...BASE, db,
    selectedOptions: [{ optionId: 10, quantity: 1, offered: 1 }],
    offeredOptionIds: [10],
  });
  assert.notEqual(optLine(q).includedInRate, true);
  db.close();
});

test('a default-offered option that the operator un-offers (charges) → NOT includedInRate, real price', () => {
  const db = createDb({ defaultOffered: true });
  const q = calculateReservationQuote({
    ...BASE, db,
    selectedOptions: [{ optionId: 10, quantity: 1, offered: 0 }],
    offeredOptionIds: [],
  });
  const line = optLine(q);
  assert.notEqual(line.includedInRate, true);
  assert.equal(line.offered, false);
  assert.equal(line.totalPrice, 25);
  db.close();
});
