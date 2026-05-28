const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;

// Regression: selecting a non-hourly resource (per_stay / per_person / per_night /
// per_person_per_night) used to throw "priceType is not defined" in the resource-line builder,
// so the whole quote failed and the resource was absent from price + summary.
// Base stay = 120/night x 3 nights = 360; 2 adults, 0 children/teens → persons = 2.
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
  // price 20, quantity 1, one per type
  db.prepare("INSERT INTO resources (id, name, quantity, price, priceType) VALUES (10, 'Forfait', 1, 20, 'per_stay')").run();
  db.prepare("INSERT INTO resources (id, name, quantity, price, priceType) VALUES (11, 'Par pers', 1, 20, 'per_person')").run();
  db.prepare("INSERT INTO resources (id, name, quantity, price, priceType) VALUES (12, 'Par nuit', 1, 20, 'per_night')").run();
  db.prepare("INSERT INTO resources (id, name, quantity, price, priceType) VALUES (13, 'Pers/nuit', 1, 20, 'per_person_per_night')").run();
  return db;
}

const BASE = {
  propertyId: 1,
  startDate: '2026-07-10',
  endDate: '2026-07-13', // 3 nights
  adults: 2, children: 0, teens: 0, babies: 0,
  selectedOptions: [], customOptions: [],
};

function resourceTotal(db, resourceId) {
  const quote = calculateReservationQuote({ db, ...BASE, selectedResources: [{ resourceId, quantity: 1 }] });
  assert.ok(!quote.error, `quote errored: ${quote.error}`);
  const line = quote.resourceLines.find((l) => l.resourceId === resourceId);
  return { line, resourcesTotal: quote.resourcesTotal };
}

test('per_stay resource → price x1 (20)', () => {
  const { line, resourcesTotal } = resourceTotal(createDb(), 10);
  assert.equal(line.totalPrice, 20);
  assert.equal(resourcesTotal, 20);
});

test('per_person resource → price x persons (20 x 2 = 40)', () => {
  const { line } = resourceTotal(createDb(), 11);
  assert.equal(line.totalPrice, 40);
});

test('per_night resource → price x nights (20 x 3 = 60)', () => {
  const { line } = resourceTotal(createDb(), 12);
  assert.equal(line.totalPrice, 60);
});

test('per_person_per_night resource → price x persons x nights (20 x 2 x 3 = 120)', () => {
  const { line } = resourceTotal(createDb(), 13);
  assert.equal(line.totalPrice, 120);
  assert.equal(line.billedUnits, 6);
});
