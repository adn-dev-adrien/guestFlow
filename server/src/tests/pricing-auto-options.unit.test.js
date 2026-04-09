const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const pricingUtils = require('../utils/pricing');

const {
  timeToDecimalHour,
  computeAutoTimedOptionContext,
  calculateReservationQuote,
} = pricingUtils.__test;

function createPricingTestDb() {
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE properties (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      depositPercent REAL DEFAULT 30,
      depositDaysBefore INTEGER DEFAULT 30,
      balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00',
      defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0
    );

    CREATE TABLE pricing_rules (
      id INTEGER PRIMARY KEY,
      propertyId INTEGER NOT NULL,
      label TEXT DEFAULT 'Standard',
      pricePerNight REAL NOT NULL DEFAULT 100,
      pricingMode TEXT NOT NULL DEFAULT 'fixed',
      progressiveTiers TEXT NOT NULL DEFAULT '[]',
      dateRanges TEXT NOT NULL DEFAULT '[]',
      color TEXT NOT NULL DEFAULT '#1976d2',
      startDate TEXT,
      endDate TEXT,
      minNights INTEGER DEFAULT 1
    );

    CREATE TABLE options (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      priceType TEXT NOT NULL DEFAULT 'per_stay',
      price REAL NOT NULL DEFAULT 0,
      autoOptionType TEXT,
      autoEnabled INTEGER NOT NULL DEFAULT 0,
      autoPricingMode TEXT NOT NULL DEFAULT 'fixed',
      autoFullNightThreshold TEXT
    );

    CREATE TABLE property_options (
      propertyId INTEGER NOT NULL,
      optionId INTEGER NOT NULL,
      PRIMARY KEY (propertyId, optionId)
    );

    CREATE TABLE resources (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      priceType TEXT NOT NULL DEFAULT 'per_stay',
      propertyIds TEXT DEFAULT '[]'
    );
  `);

  db.prepare(`
    INSERT INTO properties (id, name, depositPercent, depositDaysBefore, balanceDaysBefore, defaultCheckIn, defaultCheckOut, touristTaxPerDayPerPerson)
    VALUES (1, 'Maison test', 30, 30, 7, '15:00', '10:00', 0)
  `).run();

  db.prepare(`
    INSERT INTO pricing_rules (id, propertyId, label, pricePerNight, pricingMode, progressiveTiers, dateRanges, color, startDate, endDate, minNights)
    VALUES (1, 1, 'Standard', 120, 'fixed', '[]', '[]', '#1976d2', NULL, NULL, 1)
  `).run();

  return db;
}

test('timeToDecimalHour converts half-hour values', () => {
  assert.equal(timeToDecimalHour('15:30'), 15.5);
  assert.equal(timeToDecimalHour('08:00'), 8);
});

test('computeAutoTimedOptionContext computes proportional early check-in hours and price', () => {
  const line = computeAutoTimedOptionContext({
    option: {
      id: 10,
      title: 'Arrivee anticipee',
      autoOptionType: 'early_check_in',
      autoEnabled: 1,
      autoPricingMode: 'proportional',
      autoFullNightThreshold: '10:00',
      price: 0,
    },
    checkInTime: '13:00',
    defaultCheckIn: '15:00',
    defaultCheckOut: '10:00',
    nightlyBreakdown: [{ price: 120 }],
  });

  assert.equal(line.optionId, 10);
  assert.equal(line.autoExtraHours, 2);
  assert.equal(line.autoFullNightApplied, false);
  assert.equal(line.totalPrice, 20);
});

test('computeAutoTimedOptionContext applies full-night price for late check-out beyond threshold', () => {
  const line = computeAutoTimedOptionContext({
    option: {
      id: 11,
      title: 'Depart tardif',
      autoOptionType: 'late_check_out',
      autoEnabled: 1,
      autoPricingMode: 'proportional',
      autoFullNightThreshold: '17:00',
      price: 0,
    },
    checkOutTime: '17:30',
    defaultCheckIn: '15:00',
    defaultCheckOut: '10:00',
    nightlyBreakdown: [{ price: 120 }, { price: 120 }],
  });

  assert.equal(line.autoExtraHours, 7.5);
  assert.equal(line.autoFullNightApplied, true);
  assert.equal(line.totalPrice, 120);
});

test('calculateReservationQuote auto-adds proportional early check-in option with extra hours', () => {
  const db = createPricingTestDb();
  db.prepare(`
    INSERT INTO options (id, title, priceType, price, autoOptionType, autoEnabled, autoPricingMode, autoFullNightThreshold)
    VALUES (10, 'Arrivee anticipee', 'per_stay', 0, 'early_check_in', 1, 'proportional', '10:00')
  `).run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 10)').run();

  const quote = calculateReservationQuote({
    db,
    propertyId: 1,
    startDate: '2026-07-10',
    endDate: '2026-07-12',
    checkInTime: '13:00',
    checkOutTime: '10:00',
    adults: 2,
    children: 0,
    teens: 0,
    discountPercent: 0,
    customPrice: '',
    selectedOptions: [],
    selectedResources: [],
    depositPaid: false,
    balancePaid: false,
  });

  assert.equal(quote.optionLines.length, 1);
  assert.equal(quote.optionLines[0].optionId, 10);
  assert.equal(quote.optionLines[0].autoExtraHours, 2);
  assert.equal(quote.optionLines[0].autoFullNightApplied, false);
  assert.equal(quote.optionLines[0].totalPrice, 20);
  assert.equal(quote.optionsTotal, 20);

  db.close();
});

test('calculateReservationQuote does not add timed options when reservation uses default hours', () => {
  const db = createPricingTestDb();
  db.prepare(`
    INSERT INTO options (id, title, priceType, price, autoOptionType, autoEnabled, autoPricingMode, autoFullNightThreshold)
    VALUES (10, 'Arrivee anticipee', 'per_stay', 0, 'early_check_in', 1, 'proportional', '10:00')
  `).run();
  db.prepare(`
    INSERT INTO options (id, title, priceType, price, autoOptionType, autoEnabled, autoPricingMode, autoFullNightThreshold)
    VALUES (11, 'Depart tardif', 'per_stay', 0, 'late_check_out', 1, 'proportional', '17:00')
  `).run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 10)').run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 11)').run();

  const quote = calculateReservationQuote({
    db,
    propertyId: 1,
    startDate: '2026-07-10',
    endDate: '2026-07-12',
    checkInTime: '15:00',
    checkOutTime: '10:00',
    adults: 2,
    children: 0,
    teens: 0,
    discountPercent: 0,
    customPrice: '',
    selectedOptions: [],
    selectedResources: [],
    depositPaid: false,
    balancePaid: false,
  });

  assert.equal(quote.optionLines.length, 0);
  assert.equal(quote.optionsTotal, 0);

  db.close();
});