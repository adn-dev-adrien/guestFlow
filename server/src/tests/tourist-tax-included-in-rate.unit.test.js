const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;

// specs/tariff-recipes/spec.md §3.8 rules 48-49 — includedInRate lines reduce the percentage-mode
// tourist-tax base by their real value; a one-off gesture does not; the base floors at 0; a frozen
// past tax is untouched; a flat per-adult-per-night property is unaffected.

function createDb({ mode = 'percentage_accommodation', defaultOffered = true, optionPrice = 34.09 } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 0,
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
    CREATE TABLE property_option_defaults (propertyId INTEGER, optionId INTEGER, offered INTEGER DEFAULT 0, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0,
      priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0);
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare(`INSERT INTO properties (id, name, touristTaxMode, touristTaxPercentage, touristTaxPerDayPerPerson)
    VALUES (1, 'Lodge', ?, ?, ?)`)
    .run(mode, mode === 'per_day_per_person' ? 0 : 5, mode === 'per_day_per_person' ? 1.5 : 0);
  db.prepare(`INSERT INTO pricing_rules (id, propertyId, pricePerNight, dateRanges)
    VALUES (1, 1, 100, '[{"startDate":"2026-01-01","endDate":"2026-12-31"}]')`).run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (10, 'Ménage et linge', 'per_stay', ?)").run(optionPrice);
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 10)').run();
  db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, 10, ?)').run(defaultOffered ? 1 : 0);
  return db;
}

const BASE = {
  propertyId: 1, startDate: '2026-05-01', endDate: '2026-05-03',
  checkInTime: '15:00', checkOutTime: '10:00', adults: 2, children: 0, teens: 0, babies: 0,
  customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
};

const WITH_INCLUDED = { selectedOptions: [{ optionId: 10, quantity: 1, offered: 1 }], offeredOptionIds: [10] };

test('includedInRate option reduces the percentage-mode tax base by its real value', () => {
  const db = createDb();
  const withOption = calculateReservationQuote({ ...BASE, ...WITH_INCLUDED, db });
  const without = calculateReservationQuote({ ...BASE, db, selectedOptions: [] });
  assert.equal(withOption.optionLines[0].includedInRate, true);
  assert.equal(withOption.touristTaxIncludedInRateDeduction, 34.09);
  assert.equal(withOption.touristTaxBaseAccommodation, 165.91); // 200 − 34.09
  assert.equal(without.touristTaxBaseAccommodation, 200);
  assert.ok(withOption.touristTaxTotal < without.touristTaxTotal);
  db.close();
});

test('a one-off commercial gesture (offered but NOT a property default) is not deducted', () => {
  const db = createDb({ defaultOffered: false });
  const q = calculateReservationQuote({ ...BASE, ...WITH_INCLUDED, db });
  assert.notEqual(q.optionLines[0].includedInRate, true);
  assert.equal(q.touristTaxIncludedInRateDeduction, 0);
  assert.equal(q.touristTaxBaseAccommodation, 200);
  db.close();
});

test('base floors at 0 when the included value exceeds the accommodation', () => {
  const db = createDb({ optionPrice: 500 });
  const q = calculateReservationQuote({ ...BASE, ...WITH_INCLUDED, db });
  assert.equal(q.touristTaxBaseAccommodation, 0);
  assert.equal(q.touristTaxTotal, 0);
  db.close();
});

test('flat per-adult-per-night mode is unaffected by the deduction', () => {
  const db = createDb({ mode: 'per_day_per_person' });
  const q = calculateReservationQuote({ ...BASE, ...WITH_INCLUDED, db });
  assert.equal(q.touristTaxIncludedInRateDeduction, 34.09); // exposed…
  assert.equal(q.touristTaxTotal, 6); // …but inert: 1.50 × 2 adults × 2 nights
  db.close();
});

test('a frozen past tax keeps its stored amount, deduction or not', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, ...WITH_INCLUDED, db,
    freezeTouristTax: true, frozenTouristTaxTotal: 12.34, frozenTouristTaxRate: 3.21,
  });
  assert.equal(q.touristTaxTotal, 12.34);
  assert.equal(q.touristTaxRate, 3.21);
  db.close();
});
