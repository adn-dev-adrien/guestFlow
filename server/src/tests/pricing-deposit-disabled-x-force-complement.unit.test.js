const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing');

// Cross-feature interaction tests: `depositDisabled` (specs/disable-deposit-per-reservation.md)
// composed with per-item routing to Complément (specs/force-item-to-complement.md). Both
// features modify the deposit/balance/complement split in the engine; this file pins their
// expected interaction so neither side can silently break the other.

function freshDb({ withTax = false, withOption = false } = {}) {
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
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRateAccommodation REAL, vatRateStandard REAL);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRateAccommodation, vatRateStandard) VALUES (1, 10, 20)').run();
  db.prepare('INSERT INTO properties (id, name, touristTaxPerDayPerPerson) VALUES (1, ?, ?)').run('Logement', withTax ? 1 : 0);
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  if (withOption) {
    db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (10, 'Lit supp.', 'per_stay', 50)").run();
    db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 10)').run();
  }
  return db;
}

const BASE_INPUTS = {
  propertyId: 1,
  startDate: '2026-07-10',
  endDate: '2026-07-12', // 2 nights × 100 = 200 €
  checkInTime: '15:00',
  checkOutTime: '10:00',
  adults: 2,
  children: 0,
  teens: 0,
  selectedOptions: [],
  customOptions: [],
  selectedResources: [],
  discountPercent: 0,
  customPrice: '',
};

test('depositDisabled + no force flag: balance absorbs full preArrival (same as deposit-disabled alone)', () => {
  const db = freshDb();
  const q = calculateReservationQuote({ ...BASE_INPUTS, db, depositDisabled: 1 });
  assert.equal(q.depositAmount, 0);
  assert.equal(q.balanceAmount, 200);
  assert.equal(q.complementAmount, 0);
  db.close();
});

test('depositDisabled + forced option: balance absorbs non-forced preArrival, forced option lands in complément', () => {
  const db = freshDb({ withOption: true });
  // Stay 200 + option 50 = 250. Forced → preArrival = 200 (excluding option). depositDisabled
  // → deposit = 0, balance = 200. Complément = 50 (the forced option).
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db,
    depositDisabled: 1,
    selectedOptions: [{ optionId: 10, quantity: 1, inComplement: 1 }],
  });
  assert.equal(q.depositAmount, 0);
  assert.equal(q.balanceAmount, 200);
  assert.equal(q.complementAmount, 50);
  assert.equal(q.forcedItemsTotal, 50);
  db.close();
});

test('depositDisabled + forced tax: balance covers accommodation, tax lands in complément', () => {
  const db = freshDb({ withTax: true });
  // 2 adults × 2 nights × 1€ = 4€ tax. depositDisabled + touristTaxInComplement.
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db,
    platform: 'direct',
    depositDisabled: 1,
    touristTaxInComplement: 1,
  });
  assert.equal(q.touristTaxTotal, 4);
  assert.equal(q.depositAmount, 0);
  // Balance = preArrival (excluding the forced tax) = finalPrice = 200.
  assert.equal(q.balanceAmount, 200);
  assert.equal(q.complementAmount, 4);
  db.close();
});

test('depositDisabled + forced option + forced tax: complement carries both, balance covers accommodation', () => {
  const db = freshDb({ withTax: true, withOption: true });
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db,
    platform: 'direct',
    depositDisabled: 1,
    touristTaxInComplement: 1,
    selectedOptions: [{ optionId: 10, quantity: 1, inComplement: 1 }],
  });
  // Stay = 200 + 50 = 250 TTC. Tax = 4. Total = 254. Forced option + tax → complement = 54.
  // Balance = preArrival (accommodation only) = 200. Deposit = 0 (disabled).
  assert.equal(q.depositAmount, 0);
  assert.equal(q.balanceAmount, 200);
  assert.equal(q.complementAmount, 54);
  assert.equal(q.forcedItemsTotal, 50);
  db.close();
});

test('depositDisabled wins over depositPaid: stale paid flag does not override the disable', () => {
  // Regression guard: if a reservation was paid then later marked disabled, the disabled
  // branch must still apply (deposit=0, balance absorbs). This is the rationale for the
  // controller's `effectiveDepositPaid = depositDisabled ? false : ...` mirror.
  const db = freshDb();
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db,
    depositDisabled: 1,
    depositPaid: true,
    balancePaid: false,
    depositAmount: 60, // would have been the auto split — must be ignored
  });
  assert.equal(q.depositAmount, 0);
  assert.equal(q.balanceAmount, 200);
  db.close();
});

test('OFF state (regression): depositDisabled=0 with forced option behaves identically to force-only', () => {
  const db = freshDb({ withOption: true });
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db,
    depositDisabled: 0,
    selectedOptions: [{ optionId: 10, quantity: 1, inComplement: 1 }],
  });
  // preArrival = 200 (excludes forced option). Auto split 30 % / 70 %: 60 / 140.
  assert.equal(q.depositAmount, 60);
  assert.equal(q.balanceAmount, 140);
  assert.equal(q.complementAmount, 50);
  db.close();
});
