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
      isComplex INTEGER NOT NULL DEFAULT 0, propertyIds TEXT DEFAULT '[]',
      showsPlanningCard INTEGER NOT NULL DEFAULT 0, slotDuration INTEGER NOT NULL DEFAULT 30,
      hourlyEveningStart TEXT, hourlyEveningRate REAL NOT NULL DEFAULT 0,
      openTime TEXT DEFAULT '12:00', closeTime TEXT DEFAULT '22:00', minimumUsageMinutes INTEGER DEFAULT 60
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
  // Hourly-scheduled (bain nordique): day 30 / evening 50 from 20:00, 30-min slots.
  db.prepare("INSERT INTO resources (id, name, quantity, price, priceType, isComplex, showsPlanningCard, slotDuration, hourlyEveningStart, hourlyEveningRate) VALUES (14, 'Bain nordique', 1, 30, 'per_hour', 1, 1, 30, '20:00', 50)").run();
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

// specs/resource-hourly-scheduling.md §3.3 — hourly-scheduled resource priced from the fiche sessions.
test('hourly-scheduled resource → time-banded grid over the sessions', () => {
  const db = createDb();
  const quote = calculateReservationQuote({
    db, ...BASE,
    selectedResources: [{ resourceId: 14, sessions: [
      { date: '2026-07-11', start: '19:00', end: '21:00' }, // 2×15 + 2×25 = 80
      { date: '2026-07-12', start: '14:00', end: '15:00' }, // 30
    ] }],
  });
  assert.ok(!quote.error, `quote errored: ${quote.error}`);
  const line = quote.resourceLines.find((l) => l.resourceId === 14);
  assert.equal(line.totalPrice, 110); // 80 + 30, no free minutes (no property override)
  assert.equal(line.billedUnits, 3);  // 3 h booked
  assert.equal(line.sessions.length, 2);
});

test('hourly-scheduled resource → free first hour deducted once (property freeMinutes)', () => {
  const db = createDb();
  db.prepare('INSERT INTO property_resource_prices (propertyId, resourceId, price, freeMinutes) VALUES (1, 14, 30, 60)').run();
  const quote = calculateReservationQuote({
    db, ...BASE,
    selectedResources: [{ resourceId: 14, sessions: [
      { date: '2026-07-11', start: '19:00', end: '21:00' }, // earliest → first hour (19-20 = 30) free
    ] }],
  });
  const line = quote.resourceLines.find((l) => l.resourceId === 14);
  assert.equal(line.totalPrice, 50); // 80 − 30
  assert.equal(line.billedUnits, 1);
});

test('hourly-scheduled resource → an unusable session falls back to quantity pricing, never to nothing', () => {
  // A session below the minimum duration (a resource reconfigured under a saved booking, say) used to
  // erase the line and its money. The hours it described were still sold, so they are billed as a
  // bare quantity and re-placed during the arrival SAS
  // (specs/hourly-resource-quantity-and-sas-scheduling.md §3.1 rule 2).
  const db = createDb();
  const quote = calculateReservationQuote({
    db, ...BASE,
    selectedResources: [{ resourceId: 14, sessions: [{ date: '2026-07-11', start: '19:00', end: '19:30' }] }], // < 1 h
  });
  const line = quote.resourceLines.find((l) => l.resourceId === 14);
  assert.ok(line, 'the line must survive an unusable session');
  assert.equal(line.quantity, 0.5);   // hours derived from the session it could not schedule
  assert.equal(line.totalPrice, 15);  // 0,5 h × 30 €
  assert.equal(line.sessions, undefined, 'nothing is presented as scheduled');
});

test('hourly-scheduled resource → an explicit quantity wins over unusable sessions', () => {
  const db = createDb();
  const quote = calculateReservationQuote({
    db, ...BASE,
    selectedResources: [{ resourceId: 14, quantity: 3, sessions: [{ date: '2026-07-11', start: '19:00', end: '19:30' }] }],
  });
  const line = quote.resourceLines.find((l) => l.resourceId === 14);
  assert.equal(line.quantity, 3);
  assert.equal(line.totalPrice, 90);
});
