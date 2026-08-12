const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;

// specs/tariff-recipes/spec.md §3.4 rule 20bis — the maximum stay, mirror of the minimum: a per-range
// override wins over the season default, the MOST RESTRICTIVE ceiling across the nights touched wins,
// and absent/NULL means unlimited (what every existing property carries).

function createDb({ seasons }) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 30,
      depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '16:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0, extraGuestPriceUnit TEXT DEFAULT 'per_stay');
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER, label TEXT,
      pricePerNight REAL DEFAULT 100, pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]',
      dateRanges TEXT DEFAULT '[]', color TEXT DEFAULT '#1976d2', startDate TEXT, endDate TEXT,
      minNights INTEGER DEFAULT 1, maxNights INTEGER DEFAULT NULL);
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
  seasons.forEach((s, i) => {
    db.prepare(`INSERT INTO pricing_rules (id, propertyId, label, pricePerNight, dateRanges, minNights, maxNights)
      VALUES (?, 1, ?, 100, ?, ?, ?)`)
      .run(i + 1, s.label, JSON.stringify(s.ranges), s.minNights ?? 1, s.maxNights ?? null);
  });
  return db;
}

const BASE = {
  propertyId: 1, checkInTime: '16:00', checkOutTime: '10:00', adults: 2, children: 0, teens: 0, babies: 0,
  selectedOptions: [], customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
};
const quote = (db, startDate, endDate) => calculateReservationQuote({ ...BASE, db, startDate, endDate });

test('no ceiling configured → unlimited, nothing breached (every existing property)', () => {
  const db = createDb({ seasons: [{ label: 'Annuel', ranges: [{ startDate: '2026-01-01', endDate: '2026-12-31' }] }] });
  const q = quote(db, '2026-05-01', '2026-07-01'); // 61 nights
  assert.equal(q.requiredMaxNights, null);
  assert.equal(q.maxNightsBreached, false);
  db.close();
});

test('a 7-night ceiling: 7 nights pass, 8 breach', () => {
  const db = createDb({ seasons: [{ label: 'Annuel', maxNights: 7, ranges: [{ startDate: '2026-01-01', endDate: '2026-12-31' }] }] });
  const ok = quote(db, '2026-05-01', '2026-05-08');
  assert.equal(ok.nights, 7);
  assert.equal(ok.requiredMaxNights, 7);
  assert.equal(ok.maxNightsBreached, false);

  const tooLong = quote(db, '2026-05-01', '2026-05-09');
  assert.equal(tooLong.nights, 8);
  assert.equal(tooLong.maxNightsBreached, true);
  // The price is still computed — the ceiling is a save-time guard, not a quote failure.
  assert.ok(tooLong.finalPrice > 0);
  db.close();
});

test('the MOST RESTRICTIVE ceiling across the nights touched wins', () => {
  const db = createDb({ seasons: [
    { label: 'Basse', maxNights: 14, ranges: [{ startDate: '2026-01-01', endDate: '2026-06-30' }] },
    { label: 'Haute', maxNights: 7, ranges: [{ startDate: '2026-07-01', endDate: '2026-08-31' }] },
  ] });
  // A stay straddling both takes the 7 of the high season, not the 14 of the low one.
  const q = quote(db, '2026-06-28', '2026-07-08'); // 10 nights across the boundary
  assert.equal(q.requiredMaxNights, 7);
  assert.equal(q.maxNightsBreached, true);
  assert.deepEqual(q.maxNightsRules.map((r) => [r.label, r.maxNights]).sort(), [['Basse', 14], ['Haute', 7]].sort());
  db.close();
});

test('a season without a ceiling does not lift a neighbour\'s', () => {
  const db = createDb({ seasons: [
    { label: 'Libre', ranges: [{ startDate: '2026-01-01', endDate: '2026-06-30' }] },
    { label: 'Plafonnée', maxNights: 7, ranges: [{ startDate: '2026-07-01', endDate: '2026-08-31' }] },
  ] });
  const q = quote(db, '2026-06-28', '2026-07-08');
  assert.equal(q.requiredMaxNights, 7);
  assert.equal(q.maxNightsBreached, true);
  db.close();
});

test('a per-range override wins over the season default, blank inherits', () => {
  const db = createDb({ seasons: [{
    label: 'Annuel', maxNights: 14,
    ranges: [
      { startDate: '2026-01-01', endDate: '2026-06-30', maxNights: 3 },
      { startDate: '2026-07-01', endDate: '2026-12-31' },
    ],
  }] });
  assert.equal(quote(db, '2026-05-01', '2026-05-05').requiredMaxNights, 3);  // override
  assert.equal(quote(db, '2026-09-01', '2026-09-05').requiredMaxNights, 14); // inherits
  assert.equal(quote(db, '2026-05-01', '2026-05-05').maxNightsBreached, true); // 4 nights > 3
  db.close();
});

test('a zero-night selection reports no ceiling and no breach', () => {
  const db = createDb({ seasons: [{ label: 'Annuel', maxNights: 7, ranges: [{ startDate: '2026-01-01', endDate: '2026-12-31' }] }] });
  const q = quote(db, '2026-05-01', '2026-05-01');
  assert.equal(q.requiredMaxNights, null);
  assert.equal(q.maxNightsBreached, false);
  db.close();
});
