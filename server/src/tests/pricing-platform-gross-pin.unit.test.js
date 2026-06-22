const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;

// specs/platform-payment-entry.md — on a non-direct reservation a set `platformGrossAmount` (the brut the
// guest paid) PINS the total séjour: finalPrice = brut, the accommodation back-solved (= brut − options −
// resources − extra-guest). Empty brut / direct → normal pricing.

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 0,
      depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0);
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER, label TEXT, pricePerNight REAL DEFAULT 300, pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]', dateRanges TEXT DEFAULT '[]', color TEXT DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0, optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0, autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE property_option_defaults (propertyId INTEGER, optionId INTEGER, offered INTEGER DEFAULT 0, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0, propertyIds TEXT DEFAULT '[]');
    CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 300, 1)').run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (10, 'Ménage', 'per_stay', 80)").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 10)').run();
  return db;
}

const BASE = {
  propertyId: 1, startDate: '2026-05-01', endDate: '2026-05-03', // 2 nights × 300 = 600
  checkInTime: '15:00', checkOutTime: '10:00', adults: 2, children: 0, teens: 0, babies: 0,
  customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
};

test('brut set → finalPrice = brut; accommodation back-solved = brut − options', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, db, platform: 'Gîtes de France',
    selectedOptions: [{ optionId: 10, quantity: 1 }], // ménage 80
    platformGrossAmount: 687,
  });
  assert.equal(q.finalPrice, 687, 'total séjour pinned to the brut');
  assert.equal(q.optionsTotal, 80);
  assert.equal(q.baseAccommodationAdjustedPrice, 607, 'accommodation = 687 − 80');
  assert.equal(q.platformGrossAmount, 687, 'echoed back');
  db.close();
});

test('brut + commission → net perçu = brut − commission', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, db, platform: 'Gîtes de France',
    selectedOptions: [{ optionId: 10, quantity: 1 }],
    platformGrossAmount: 687, platformCommissionAmount: 61,
  });
  assert.equal(q.finalPrice, 687);
  assert.equal(q.platformNetReceivedAmount, 626, 'net = 687 − 61');
  db.close();
});

test('empty brut → normal pricing (regression)', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, db, platform: 'Gîtes de France',
    selectedOptions: [{ optionId: 10, quantity: 1 }],
    platformGrossAmount: '',
  });
  assert.equal(q.finalPrice, 680, '600 nights + 80 ménage'); // not pinned
  db.close();
});

test('direct reservation ignores the brut', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, db, platform: 'direct',
    selectedOptions: [{ optionId: 10, quantity: 1 }],
    platformGrossAmount: 687,
  });
  assert.equal(q.finalPrice, 680, 'direct → normal pricing, brut ignored');
  assert.equal(q.platformGrossAmount, null);
  db.close();
});

test('offered option is excluded from the back-solve (accommodation not reduced by a 0 € line)', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, db, platform: 'Airbnb',
    selectedOptions: [{ optionId: 10, quantity: 1, offered: 1 }], // ménage offered → 0 €
    offeredOptionIds: [10],
    platformGrossAmount: 600,
  });
  assert.equal(q.optionsTotal, 0, 'offered → 0');
  assert.equal(q.finalPrice, 600);
  assert.equal(q.baseAccommodationAdjustedPrice, 600, 'accommodation = brut (option is free)');
  db.close();
});

test('brut < options → accommodation clamps to 0 (no negative)', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, db, platform: 'Airbnb',
    selectedOptions: [{ optionId: 10, quantity: 1 }], // ménage 80
    platformGrossAmount: 50, // < 80
  });
  assert.equal(q.baseAccommodationAdjustedPrice, 0, 'accommodation clamps to 0');
  assert.equal(q.finalPrice, 80, 'finalPrice = 0 accommodation + 80 options');
  db.close();
});
