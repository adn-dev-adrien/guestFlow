const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;

// specs/pricing-min-nights-per-range.md — a season's date range can carry its OWN minimum nights.
// The engine resolves the effective minimum per night (range override ?? season default ?? 1) and
// exposes `requiredMinNights` = MAX over the nights the stay actually touches. `minNightsBreached` /
// `minNightsRules` keep their existing shapes so the 409 MIN_NIGHTS guards are unaffected.

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
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT NOT NULL, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0, optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0, autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0, propertyIds TEXT DEFAULT '[]');
    CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
    CREATE TABLE platforms (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, collectsTouristTax INTEGER NOT NULL DEFAULT 1, touristTaxRemittedByPlatform INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, propertyId INTEGER NOT NULL, platformKey TEXT NOT NULL, platformLabel TEXT);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte')").run();
  return db;
}

function insertSeason(db, { id, label = 'Standard', pricePerNight = 100, minNights = 1, dateRanges }) {
  db.prepare('INSERT INTO pricing_rules (id, propertyId, label, pricePerNight, minNights, dateRanges) VALUES (?, 1, ?, ?, ?, ?)')
    .run(id, label, pricePerNight, minNights, JSON.stringify(dateRanges));
}

const BASE = {
  propertyId: 1, checkInTime: '15:00', checkOutTime: '10:00',
  adults: 2, children: 0, teens: 0, babies: 0,
  selectedOptions: [], customOptions: [], selectedResources: [],
  discountPercent: 0, customPrice: '', depositPaid: false, balancePaid: false,
  platform: 'direct',
};

function quote(db, startDate, endDate) {
  return calculateReservationQuote({ ...BASE, db, startDate, endDate });
}

const MAI_WITH_PONT = [
  { startDate: '2026-05-01', endDate: '2026-05-07' },
  { startDate: '2026-05-08', endDate: '2026-05-09', minNights: 3 },
  { startDate: '2026-05-10', endDate: '2026-05-31' },
];

test('per-range minNights blocks a short stay on the pont only (Fri→Sun refused, Thu→Sun ok)', () => {
  const db = createDb();
  insertSeason(db, { id: 1, label: 'Mai', minNights: 1, dateRanges: MAI_WITH_PONT });

  // Fri 05-08 → Sun 05-10 = nights 08 + 09 (both in the pont) → 2 < 3 → breached.
  const short = quote(db, '2026-05-08', '2026-05-10');
  assert.equal(short.requiredMinNights, 3);
  assert.equal(short.minNightsBreached, true);

  // Thu 05-07 → Sun 05-10 = nights 07,08,09 → touches the pont → min 3, 3 nights → ok.
  const ok = quote(db, '2026-05-07', '2026-05-10');
  assert.equal(ok.requiredMinNights, 3);
  assert.equal(ok.minNightsBreached, false);

  // Off-pont: 05-04 → 05-06 = nights 04,05 → season default (1) → ok.
  const offPont = quote(db, '2026-05-04', '2026-05-06');
  assert.equal(offPont.requiredMinNights, 1);
  assert.equal(offPont.minNightsBreached, false);
});

test('requiredMinNights is the MAX over the nights actually touched (departure day excluded)', () => {
  const db = createDb();
  insertSeason(db, { id: 1, label: 'Mai', minNights: 1, dateRanges: MAI_WITH_PONT });

  // 05-06 → 05-09 touches nights 06,07 (min1) + 08 (min3) → max 3, 3 nights → ok.
  assert.equal(quote(db, '2026-05-06', '2026-05-09').requiredMinNights, 3);

  // 05-06 → 05-08 touches nights 06,07 ONLY — night 08 is the departure day, not a stay night → min 1.
  assert.equal(quote(db, '2026-05-06', '2026-05-08').requiredMinNights, 1);
});

test('backward compatible: a range with no override uses the season default', () => {
  const db = createDb();
  insertSeason(db, { id: 1, label: 'Haute', minNights: 2, dateRanges: [{ startDate: '2026-07-01', endDate: '2026-07-31' }] });

  const q = quote(db, '2026-07-10', '2026-07-11'); // 1 night, season min 2 → breached
  assert.equal(q.requiredMinNights, 2);
  assert.equal(q.minNightsBreached, true);
  assert.deepEqual(q.minNightsRules, [{ label: 'Haute', minNights: 2 }]);
});

test('minNightsRules groups by season label with the max effective min (shape preserved)', () => {
  const db = createDb();
  insertSeason(db, {
    id: 1, label: 'Mai', minNights: 1,
    dateRanges: [
      { startDate: '2026-05-01', endDate: '2026-05-07' },
      { startDate: '2026-05-08', endDate: '2026-05-09', minNights: 3 },
    ],
  });
  const q = quote(db, '2026-05-07', '2026-05-09'); // touches night 07 (min1) + 08 (min3)
  assert.deepEqual(q.minNightsRules, [{ label: 'Mai', minNights: 3 }]);
});
