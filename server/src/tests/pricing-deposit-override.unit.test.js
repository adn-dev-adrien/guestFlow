const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing');

// Manual deposit override (specs/editable-deposit-amount.md).
// When `depositAmountOverride` is a number, the engine must:
//   - freeze the deposit at that value (clamped to [0, preArrival])
//   - let balanceAmount absorb the rest of the pre-arrival total
//   - keep the deposit frozen across recomputes — a later tariff change (added option) grows the
//     balance, never the deposit
//   - yield precedence to the platform / depositDisabled / paid branches
// When NULL/''/undefined, the engine keeps the percentage-based behaviour (no regression).

function freshDb({ depositPercent = 30 } = {}) {
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
      isComplex INTEGER NOT NULL DEFAULT 0, propertyIds TEXT DEFAULT '[]'
    );
    CREATE TABLE property_resource_prices ( propertyId INTEGER NOT NULL, resourceId INTEGER NOT NULL, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId) );
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare('INSERT INTO properties (id, name, depositPercent) VALUES (1, ?, ?)').run('Maison test', depositPercent);
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  // One per-stay option (50 €) the tests can add to grow the pre-arrival total.
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (1, 'Ménage', 'per_stay', 50)").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 1)').run();
  return db;
}

const BASE_INPUTS = {
  propertyId: 1,
  startDate: '2026-07-10',
  endDate: '2026-07-13', // 3 nights × 100 = 300 TTC pre-arrival
  checkInTime: '15:00',
  checkOutTime: '10:00',
  adults: 2,
  children: 0,
  teens: 0,
  selectedOptions: [],
  customOptions: [],
  selectedResources: [],
  depositPaid: false,
  balancePaid: false,
  discountPercent: 0,
  customPrice: '',
};

test('no override (rule 2): deposit follows property.depositPercent — regression', () => {
  const db = freshDb({ depositPercent: 30 });
  for (const override of [null, undefined, '']) {
    const q = calculateReservationQuote({ ...BASE_INPUTS, db, depositAmountOverride: override });
    assert.equal(q.depositAmount, 90); // 30% of 300
    assert.equal(q.balanceAmount, 210);
    assert.equal(q.depositAmount + q.balanceAmount, q.finalPrice);
  }
  db.close();
});

test('override set (rule 3): deposit frozen at the manual value, balance = preArrival − override', () => {
  const db = freshDb({ depositPercent: 30 });
  const q = calculateReservationQuote({ ...BASE_INPUTS, db, depositAmountOverride: 100 });
  assert.equal(q.depositAmount, 100);
  assert.equal(q.balanceAmount, 200); // 300 − 100
  assert.equal(q.depositAmount + q.balanceAmount, q.finalPrice);
  db.close();
});

test('override + added option (rule 3): the new option amount lands in the solde, not the acompte', () => {
  const db = freshDb({ depositPercent: 30 });
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db, depositAmountOverride: 100,
    selectedOptions: [{ optionId: 1, quantity: 1 }], // +50 → preArrival 350
  });
  assert.equal(q.depositAmount, 100); // unchanged
  assert.equal(q.balanceAmount, 250); // 350 − 100, absorbed the +50
  db.close();
});

test('override > preArrival (rule 4): deposit clamped to preArrival, balance 0', () => {
  const db = freshDb({ depositPercent: 30 });
  const q = calculateReservationQuote({ ...BASE_INPUTS, db, depositAmountOverride: 9999 });
  assert.equal(q.depositAmount, 300); // clamped to the whole pre-arrival total
  assert.equal(q.balanceAmount, 0);
  db.close();
});

test('override = 0 (edge): explicit zero deposit, full balance — distinct from auto', () => {
  const db = freshDb({ depositPercent: 30 });
  const q = calculateReservationQuote({ ...BASE_INPUTS, db, depositAmountOverride: 0 });
  assert.equal(q.depositAmount, 0);
  assert.equal(q.balanceAmount, 300);
  db.close();
});

test('override stays frozen across repeated recomputes', () => {
  const db = freshDb({ depositPercent: 30 });
  const q1 = calculateReservationQuote({ ...BASE_INPUTS, db, depositAmountOverride: 120 });
  const q2 = calculateReservationQuote({ ...BASE_INPUTS, db, depositAmountOverride: 120 });
  assert.equal(q1.depositAmount, 120);
  assert.equal(q2.depositAmount, 120);
  assert.equal(q1.balanceAmount, 180);
  assert.equal(q2.balanceAmount, 180);
  db.close();
});

test('depositDisabled wins over the override (edge): deposit 0, balance absorbs all', () => {
  const db = freshDb({ depositPercent: 30 });
  const q = calculateReservationQuote({ ...BASE_INPUTS, db, depositAmountOverride: 100, depositDisabled: 1 });
  assert.equal(q.depositAmount, 0);
  assert.equal(q.balanceAmount, 300);
  db.close();
});

test('platform reservation ignores the override (edge): no deposit on a non-direct platform', () => {
  const db = freshDb({ depositPercent: 30 });
  const q = calculateReservationQuote({ ...BASE_INPUTS, db, depositAmountOverride: 100, platform: 'Airbnb' });
  assert.equal(q.depositAmount, 0);
  assert.equal(q.balanceAmount, 300);
  db.close();
});

test('paid deposit takes precedence over the override branch (uses the stored depositAmount)', () => {
  const db = freshDb({ depositPercent: 30 });
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db, depositAmountOverride: 100, depositPaid: true, depositAmount: 90,
  });
  // depositPaid branch wins: the frozen-at-payment amount (90) is used, not the live override.
  assert.equal(q.depositAmount, 90);
  assert.equal(q.balanceAmount, 210);
  db.close();
});
