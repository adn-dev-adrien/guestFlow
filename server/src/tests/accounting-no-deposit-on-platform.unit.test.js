const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing');

// accounting-platform-commission-and-no-deposit.md §3.3 + §7.1.
// The pricing engine enforces depositAmount = 0 on non-direct platforms; the whole
// pre-arrival amount lands on the balance. Direct bookings keep the regular split.

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL,
      depositPercent REAL DEFAULT 30, depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'none',
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
    CREATE TABLE ical_sources (
      id INTEGER PRIMARY KEY, propertyId INTEGER NOT NULL,
      platformKey TEXT NOT NULL, collectsTouristTax INTEGER NOT NULL DEFAULT 1
    );
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Tente')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  return db;
}

const BASE_INPUTS = {
  propertyId: 1, startDate: '2026-09-15', endDate: '2026-09-17',
  checkInTime: '15:00', checkOutTime: '10:00',
  adults: 2, children: 0, teens: 0, babies: 0,
  selectedOptions: [], customOptions: [], selectedResources: [],
  discountPercent: 0, customPrice: '',
  depositPaid: false, balancePaid: false,
};

test('Direct booking → standard 30 / 70 deposit/balance split (unchanged)', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE_INPUTS, db, platform: 'direct' });
  assert.equal(q.finalPrice, 200);
  assert.equal(q.depositAmount, 60);
  assert.equal(q.balanceAmount, 140);
  db.close();
});

test('Non-direct platform → depositAmount = 0, balance = full pre-arrival amount', () => {
  const db = createDb();
  for (const platform of ['airbnb', 'Booking', 'Gîtes de France']) {
    const q = calculateReservationQuote({ ...BASE_INPUTS, db, platform });
    assert.equal(q.depositAmount, 0, `depositAmount should be 0 on '${platform}'`);
    assert.equal(q.balanceAmount, 200, `balanceAmount should equal preArrival on '${platform}'`);
  }
  db.close();
});

test('Platform rule wins even when caller passes depositPaid + depositAmount (legacy form payload)', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE_INPUTS,
    db,
    platform: 'Airbnb',
    depositPaid: true,
    depositAmount: 60,
  });
  assert.equal(q.depositAmount, 0);
  assert.equal(q.balanceAmount, 200);
  db.close();
});

test("'direct' is case-insensitive — 'Direct' / 'DIRECT' all get the standard split", () => {
  const db = createDb();
  for (const platform of ['direct', 'Direct', 'DIRECT']) {
    const q = calculateReservationQuote({ ...BASE_INPUTS, db, platform });
    assert.equal(q.depositAmount, 60, `'${platform}' should split deposit`);
  }
  db.close();
});
