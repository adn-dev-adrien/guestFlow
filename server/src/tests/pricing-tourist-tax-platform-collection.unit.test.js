const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;

// Per-platform tourist-tax collection (spec rule X). Direct → owner always collects. Non-direct →
// look up `ical_sources.collectsTouristTax` for this property + platformKey:
//   collectsTouristTax = 1 → platform collects → tax offered (= 0) on the quote.
//   collectsTouristTax = 0 → owner collects → tax charged to the guest (and reaches the Suivi page).
//   no matching source        → default to "collects" (legacy backwards-compat).

function createDb({ collectsTouristTax } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL,
      depositPercent REAL DEFAULT 30, depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 1.20, touristTaxMode TEXT DEFAULT 'per_day_per_person',
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
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0, propertyIds TEXT DEFAULT '[]');
    CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRateAccommodation REAL, vatRateStandard REAL);
    CREATE TABLE ical_sources (
      id INTEGER PRIMARY KEY, propertyId INTEGER NOT NULL,
      platformKey TEXT NOT NULL, collectsTouristTax INTEGER NOT NULL DEFAULT 1
    );
  `);
  db.prepare('INSERT INTO app_settings (id, vatRateAccommodation, vatRateStandard) VALUES (1, 10, 20)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Tente')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  if (collectsTouristTax !== undefined) {
    db.prepare('INSERT INTO ical_sources (id, propertyId, platformKey, collectsTouristTax) VALUES (1, 1, ?, ?)')
      .run('airbnb', collectsTouristTax ? 1 : 0);
  }
  return db;
}

const BASE_INPUTS = {
  propertyId: 1,
  startDate: '2026-07-10',
  endDate: '2026-07-12', // 2 nights
  checkInTime: '15:00', checkOutTime: '10:00',
  adults: 2, children: 0, teens: 0, babies: 0,
  selectedOptions: [], customOptions: [], selectedResources: [],
  discountPercent: 0, customPrice: '',
  depositPaid: false, balancePaid: false,
};

test('direct booking → owner always collects the tourist tax (charged on the quote)', () => {
  const db = createDb(); // no ical source needed for direct
  const q = calculateReservationQuote({ ...BASE_INPUTS, db, platform: 'direct' });
  assert.equal(q.touristTaxOfferedByPlatform, false);
  assert.ok(q.touristTaxTotal > 0); // 2 adults × 2 nights × 1.20 = 4.80
  assert.equal(q.touristTaxTotal, 4.80);
  db.close();
});

test('Airbnb with collectsTouristTax=1 (default) → tax is offered (= 0 in the quote)', () => {
  const db = createDb({ collectsTouristTax: true });
  const q = calculateReservationQuote({ ...BASE_INPUTS, db, platform: 'airbnb' });
  assert.equal(q.touristTaxOfferedByPlatform, true);
  assert.equal(q.touristTaxTotal, 0);
  // The original (would-be) tourist tax is still surfaced for display purposes.
  assert.equal(q.touristTaxOriginalTotal, 4.80);
  db.close();
});

test('Airbnb with collectsTouristTax=0 → owner collects, tax is charged like a direct booking', () => {
  const db = createDb({ collectsTouristTax: false });
  const q = calculateReservationQuote({ ...BASE_INPUTS, db, platform: 'airbnb' });
  assert.equal(q.touristTaxOfferedByPlatform, false);
  assert.equal(q.touristTaxTotal, 4.80);
  db.close();
});

test('non-direct platform with NO matching ical_source → defaults to "collects" (legacy behaviour preserved)', () => {
  const db = createDb(); // platform=airbnb but no ical_sources row → fall back to collects
  const q = calculateReservationQuote({ ...BASE_INPUTS, db, platform: 'airbnb' });
  assert.equal(q.touristTaxOfferedByPlatform, true);
  assert.equal(q.touristTaxTotal, 0);
  db.close();
});

test('platform key match is case-insensitive (Airbnb / AIRBNB / airbnb)', () => {
  const db = createDb({ collectsTouristTax: false });
  for (const platform of ['Airbnb', 'AIRBNB', 'airbnb']) {
    const q = calculateReservationQuote({ ...BASE_INPUTS, db, platform });
    assert.equal(q.touristTaxOfferedByPlatform, false, platform);
    assert.equal(q.touristTaxTotal, 4.80, platform);
  }
  db.close();
});

test('missing ical_sources table → engine still returns a valid quote (defensive default = collects)', () => {
  const db = new Database(':memory:');
  // Minimal DB without ical_sources at all — the helper should swallow the SQL error.
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 30,
      depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 1.20, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0);
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER, label TEXT, pricePerNight REAL DEFAULT 100, pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]', dateRanges TEXT DEFAULT '[]', color TEXT DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0, optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0, autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0, propertyIds TEXT DEFAULT '[]');
    CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));
  `);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Tente')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  const q = calculateReservationQuote({ ...BASE_INPUTS, db, platform: 'airbnb' });
  assert.equal(q.touristTaxOfferedByPlatform, true);
  assert.equal(q.touristTaxTotal, 0);
  db.close();
});
