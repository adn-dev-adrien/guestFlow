const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;

// specs/platform-commission-line.md — the engine derives the platform commission from the
// operator-entered gross (`clientGrossAmount`): commission = gross − net stay (finalPrice), only for a
// non-direct platform with a gross above the net. The fiche summary shows « brut − commission = net ».

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 0,
      depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0);
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER, label TEXT, pricePerNight REAL DEFAULT 100, pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]', dateRanges TEXT DEFAULT '[]', color TEXT DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0, optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0, autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0, propertyIds TEXT DEFAULT '[]');
    CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  return db;
}

const BASE = {
  propertyId: 1, startDate: '2026-07-10', endDate: '2026-07-12', // 2 nights → finalPrice 200
  checkInTime: '15:00', checkOutTime: '10:00', adults: 2, children: 0, teens: 0, babies: 0,
  selectedOptions: [], customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
  depositPaid: false, balancePaid: false,
};

test('platform reservation with a gross above net → commission = gross − net', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, platform: 'airbnb', clientGrossAmount: 235 });
  assert.equal(q.finalPrice, 200);
  assert.equal(q.platformCommissionAmount, 35); // 235 − 200
  db.close();
});

test('direct reservation → no commission even with a gross', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, platform: 'direct', clientGrossAmount: 235 });
  assert.equal(q.platformCommissionAmount, 0);
  db.close();
});

test('platform reservation with no gross entered → commission 0', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, platform: 'airbnb', clientGrossAmount: '' });
  assert.equal(q.platformCommissionAmount, 0);
  db.close();
});

test('gross below/equal net → commission 0 (no negative commission)', () => {
  const db = createDb();
  assert.equal(calculateReservationQuote({ ...BASE, db, platform: 'airbnb', clientGrossAmount: 200 }).platformCommissionAmount, 0);
  assert.equal(calculateReservationQuote({ ...BASE, db, platform: 'airbnb', clientGrossAmount: 150 }).platformCommissionAmount, 0);
  db.close();
});
