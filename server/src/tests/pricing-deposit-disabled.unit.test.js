const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing');

// Per-reservation `depositDisabled` toggle (specs/disable-deposit-per-reservation.md).
// When ON, the pricing engine must:
//   - drop depositAmount to 0 (not the property's depositPercent fraction)
//   - let balanceAmount absorb the full pre-arrival total
//   - drop depositDueDate to null
//   - survive multiple recompute calls without flipping back to the property's default split
// When OFF, the engine behaves exactly as before (no regression).

function freshDb({ depositPercent = 30, depositDaysBefore = 30, balanceDaysBefore = 7 } = {}) {
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
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRateAccommodation REAL DEFAULT 10, vatRateStandard REAL DEFAULT 20);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRateAccommodation, vatRateStandard) VALUES (1, 10, 20)').run();
  db.prepare(`
    INSERT INTO properties (id, name, depositPercent, depositDaysBefore, balanceDaysBefore)
    VALUES (1, 'Maison test', ?, ?, ?)
  `).run(depositPercent, depositDaysBefore, balanceDaysBefore);
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
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

test('depositDisabled=0 (default): deposit follows property.depositPercent — regression', () => {
  const db = freshDb({ depositPercent: 30 });
  const q = calculateReservationQuote({ ...BASE_INPUTS, db });
  // 30% of 300 = 90 deposit ; 210 balance.
  assert.equal(q.depositAmount, 90);
  assert.equal(q.balanceAmount, 210);
  assert.equal(q.depositAmount + q.balanceAmount, q.finalPrice);
  // Default due-date derivation is unchanged: depositDaysBefore=30, balanceDaysBefore=7.
  assert.notEqual(q.depositDueDate, null);
  db.close();
});

test('depositDisabled=1: deposit collapses to 0, balance absorbs the full pre-arrival total', () => {
  const db = freshDb({ depositPercent: 30 });
  const q = calculateReservationQuote({ ...BASE_INPUTS, db, depositDisabled: 1 });
  assert.equal(q.depositAmount, 0);
  assert.equal(q.balanceAmount, 300);
  assert.equal(q.depositAmount + q.balanceAmount, q.finalPrice);
  // depositDueDate must also be null — keeping a deadline for a €0 line would just confuse the UI.
  assert.equal(q.depositDueDate, null);
  // balanceDueDate stays at the standard derivation (the whole amount is now due there).
  assert.notEqual(q.balanceDueDate, null);
  db.close();
});

test('depositDisabled=true (boolean) is accepted the same as 1', () => {
  const db = freshDb({ depositPercent: 50 });
  const q = calculateReservationQuote({ ...BASE_INPUTS, db, depositDisabled: true });
  assert.equal(q.depositAmount, 0);
  assert.equal(q.balanceAmount, 300);
  db.close();
});

test('depositDisabled=1 survives repeated recompute calls — flag is never silently flipped back', () => {
  const db = freshDb({ depositPercent: 30 });
  const q1 = calculateReservationQuote({ ...BASE_INPUTS, db, depositDisabled: 1 });
  const q2 = calculateReservationQuote({ ...BASE_INPUTS, db, depositDisabled: 1 });
  const q3 = calculateReservationQuote({ ...BASE_INPUTS, db, depositDisabled: 1 });
  assert.equal(q1.depositAmount, 0);
  assert.equal(q2.depositAmount, 0);
  assert.equal(q3.depositAmount, 0);
  assert.equal(q1.balanceAmount, 300);
  assert.equal(q2.balanceAmount, 300);
  assert.equal(q3.balanceAmount, 300);
  db.close();
});

test('depositDisabled=1 + depositPercent=0: still consistent (0+300, no edge case)', () => {
  const db = freshDb({ depositPercent: 0 });
  const q = calculateReservationQuote({ ...BASE_INPUTS, db, depositDisabled: 1 });
  assert.equal(q.depositAmount, 0);
  assert.equal(q.balanceAmount, 300);
  db.close();
});

test('depositDisabled=1 wins over depositPaid (the toggle takes precedence over a stale paid-flag)', () => {
  // Scenario: an admin disables the deposit on a reservation where the deposit was previously
  // marked paid. The pricing engine should still collapse the deposit to 0 — the controller is
  // responsible for also force-zeroing depositPaid before persisting (asserted by the controller-
  // level flow in reservationsController.update). At the engine level, we just check the
  // depositDisabled branch wins over the depositPaid branch in the if/else ladder.
  const db = freshDb({ depositPercent: 30 });
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db, depositDisabled: 1, depositPaid: true, depositAmount: 90,
  });
  assert.equal(q.depositAmount, 0);
  assert.equal(q.balanceAmount, 300);
  db.close();
});

test('depositDisabled=0/false/undefined: no change in behaviour (every falsy variant)', () => {
  const db = freshDb({ depositPercent: 30 });
  const q0 = calculateReservationQuote({ ...BASE_INPUTS, db, depositDisabled: 0 });
  const qF = calculateReservationQuote({ ...BASE_INPUTS, db, depositDisabled: false });
  const qU = calculateReservationQuote({ ...BASE_INPUTS, db });
  for (const q of [q0, qF, qU]) {
    assert.equal(q.depositAmount, 90);
    assert.equal(q.balanceAmount, 210);
  }
  db.close();
});
