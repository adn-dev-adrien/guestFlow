const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;

// Complément à percevoir: the engine surfaces the gap that appears when the deposit + balance are
// frozen-paid and the stay total has since grown. Auto-derived while unpaid; frozen once paid.

function createDb({ totalStayPriceOverride } = {}) {
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
  // Property pays 100 €/night × 2 nights = 200 TTC by default; tests can override via the totalStayPriceOverride.
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Tente')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, ?, 1)').run(
    totalStayPriceOverride ? totalStayPriceOverride / 2 : 100,
  );
  return db;
}

const BASE_INPUTS = {
  propertyId: 1,
  startDate: '2026-07-10',
  endDate: '2026-07-12', // 2 nights → accommodation 200 TTC
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

test('complement = 0 when neither deposit nor balance is paid (defaults)', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE_INPUTS, db, depositPaid: false, balancePaid: false });
  assert.equal(q.complementAmount, 0);
  // Sanity: deposit + balance = totalStayPrice automatically.
  assert.equal(q.depositAmount + q.balanceAmount, q.totalStayPrice);
  db.close();
});

test('complement = 0 when only the deposit is paid (engine recomputes the balance from the new total)', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db,
    depositPaid: true, balancePaid: false,
    depositAmount: 60, // frozen at 60; balance auto-recomputed to totalStayPrice − 60
  });
  assert.equal(q.complementAmount, 0);
  assert.equal(q.depositAmount, 60);
  assert.equal(q.depositAmount + q.balanceAmount, q.totalStayPrice);
  db.close();
});

test('complement = max(0, totalStayPrice − deposit − balance) when BOTH are paid and the total has grown', () => {
  const db = createDb(); // totalStayPrice = 200
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db,
    depositPaid: true, balancePaid: true,
    depositAmount: 30,   // both stored from an earlier 100 € total
    balanceAmount: 70,
  });
  assert.equal(q.depositAmount, 30);
  assert.equal(q.balanceAmount, 70);
  assert.equal(q.complementAmount, 100); // 200 (current total) − 100 (stored paid) = 100 to bill
  db.close();
});

test('complement is zero when frozen deposit + balance already cover the total', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db,
    depositPaid: true, balancePaid: true,
    depositAmount: 60, balanceAmount: 140, // sum = 200 = totalStayPrice
  });
  assert.equal(q.complementAmount, 0);
  db.close();
});

test('complement is frozen once complementPaid = true (mirrors deposit/balance)', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db,
    depositPaid: true, balancePaid: true, complementPaid: true,
    depositAmount: 30, balanceAmount: 70,
    complementAmount: 50, // user paid 50 even though current gap is 100 — frozen at 50.
  });
  assert.equal(q.complementAmount, 50);
  db.close();
});

test('complement is never negative — a total drop after payment does NOT erode received amounts', () => {
  const db = createDb({ totalStayPriceOverride: 100 }); // total dropped to 100
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db,
    depositPaid: true, balancePaid: true,
    depositAmount: 60, balanceAmount: 140, // overpaid: total now 100 but we collected 200
  });
  assert.equal(q.complementAmount, 0); // no negative complement
  db.close();
});

test('the 3 encaissement amounts sum back to the total stay price (deposit + balance + complement)', () => {
  const db = createDb(); // total 200
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db,
    depositPaid: true, balancePaid: true,
    depositAmount: 30, balanceAmount: 70,
  });
  const sum = q.depositAmount + q.balanceAmount + q.complementAmount;
  assert.equal(sum, q.totalStayPrice);
  db.close();
});
