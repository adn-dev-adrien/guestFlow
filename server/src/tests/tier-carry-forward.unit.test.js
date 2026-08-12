const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;
const { normalizeProgressiveTiers } = require('../utils/pricing');

// specs/tariff-recipes/spec.md §3.6 rule 39 — beyond the last configured tier, that tier's price
// repeats for every further night. A season with NO configured tier keeps the legacy weekly model.

function createDb({ tiers }) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 30,
      depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0, extraGuestPriceUnit TEXT DEFAULT 'per_stay');
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER, label TEXT,
      pricePerNight REAL DEFAULT 100, pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]',
      dateRanges TEXT DEFAULT '[]', color TEXT DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0,
      optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0,
      autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0,
      priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0);
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Lodge')").run();
  db.prepare(`INSERT INTO pricing_rules (id, propertyId, label, pricePerNight, pricingMode, progressiveTiers, dateRanges)
    VALUES (1, 1, 'Basse saison', 179, 'progressive', ?, '[{"startDate":"2026-01-01","endDate":"2026-12-31"}]')`)
    .run(JSON.stringify(tiers));
  return db;
}

const BASE = {
  propertyId: 1, checkInTime: '16:00', checkOutTime: '10:00', adults: 2, children: 0, teens: 0, babies: 0,
  selectedOptions: [], customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
};

test('a single night-2 tier declares the whole curve: 28-night LOW stay totals 3562.10', () => {
  const db = createDb({ tiers: [{ nightNumber: 2, extraNightPrice: 125.30 }] });
  const q = calculateReservationQuote({ ...BASE, db, startDate: '2026-04-01', endDate: '2026-04-29' });
  // 179 + 27 × 125.30 = 3562.10 — not the legacy weekly model.
  assert.equal(q.finalPrice, 3562.10);
  assert.equal(q.nightlyBreakdown[1].price, 125.30);
  assert.equal(q.nightlyBreakdown[27].price, 125.30);
  db.close();
});

test('carry-forward starts after the LAST provided tier, not after a gap', () => {
  // Tiers provided for nights 2 and 5; nights 3-4 keep the legacy defaults, nights 6+ carry night 5.
  const normalized = normalizeProgressiveTiers(100, [
    { nightNumber: 2, extraNightPrice: 90 },
    { nightNumber: 5, extraNightPrice: 50 },
  ], 10);
  const byNight = new Map(normalized.map((t) => [t.nightNumber, t.extraNightPrice]));
  assert.equal(byNight.get(2), 90);
  assert.equal(byNight.get(5), 50);
  assert.equal(byNight.get(6), 50);  // carried
  assert.equal(byNight.get(10), 50); // still carried
  // Night 3 keeps the legacy default (weekly model), NOT the carried price.
  assert.notEqual(byNight.get(3), 50);
});

test('no provided tier → legacy weekly model untouched at any length', () => {
  const db = createDb({ tiers: [] });
  const q = calculateReservationQuote({ ...BASE, db, startDate: '2026-04-01', endDate: '2026-04-21' });
  // Weekly model with base 179: weekPrice 716; 20 nights → round(20 × 716 / 7) = 2046.
  assert.equal(q.finalPrice, 2046);
  db.close();
});
