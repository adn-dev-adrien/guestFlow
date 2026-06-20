const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;

// specs/tourist-tax-freeze-past-with-refresh.md — when `freezeTouristTax` is set, the quote pins the
// tourist-tax AMOUNT to the provided `frozenTouristTaxTotal` / `frozenTouristTaxRate` (a past
// reservation's stored values) instead of recomputing from current property settings. The routing
// (balance / complément) still applies to that frozen amount.

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL,
      depositPercent REAL DEFAULT 0, depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 1.20, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0
    );
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER, label TEXT, pricePerNight REAL DEFAULT 100, pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]', dateRanges TEXT DEFAULT '[]', color TEXT DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0, optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0, autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0, propertyIds TEXT DEFAULT '[]');
    CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  return db;
}

const BASE = {
  propertyId: 1, startDate: '2026-07-10', endDate: '2026-07-12', // 2 nights
  checkInTime: '15:00', checkOutTime: '10:00', adults: 2, children: 0, teens: 0, babies: 0,
  selectedOptions: [], customOptions: [], selectedResources: [],
  discountPercent: 0, customPrice: '', depositPaid: false, balancePaid: false, platform: 'direct',
};

test('without freeze → the tourist tax is recomputed live (2 adults × 2 nights × 1.20 = 4.80)', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db });
  assert.equal(q.touristTaxTotal, 4.80);
  db.close();
});

test('freezeTouristTax → the quote pins the stored amount/rate (not the recompute)', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, db,
    freezeTouristTax: true, frozenTouristTaxTotal: 7, frozenTouristTaxRate: 1.75,
  });
  assert.equal(q.touristTaxTotal, 7, 'amount frozen to the stored value');
  assert.equal(q.touristTaxRate, 1.75, 'rate frozen to the stored value');
  assert.equal(q.touristTaxOriginalTotal, 7);
  db.close();
});

test('freeze still routes the (frozen) tax through the schedule — direct → in the balance/total', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, db,
    freezeTouristTax: true, frozenTouristTaxTotal: 7, frozenTouristTaxRate: 1.75,
  });
  // Direct: tax in the balance → total du séjour = finalPrice + frozen tax.
  assert.equal(q.totalStayPrice, q.finalPrice + 7);
  assert.equal(q.touristTaxCollectedOnArrival, false);
  db.close();
});

test('freeze with a 0 stored amount pins 0 (e.g. an old import) — refresh would pull the computed value', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, db,
    freezeTouristTax: true, frozenTouristTaxTotal: 0, frozenTouristTaxRate: 0,
  });
  assert.equal(q.touristTaxTotal, 0);
  assert.equal(q.totalStayPrice, q.finalPrice);
  db.close();
});
