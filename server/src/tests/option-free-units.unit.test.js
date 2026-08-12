const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;

// specs/tariff-recipes/spec.md §3.9 rules 52bis-52ter — the first N units of an option are included
// in the rate (the direct welcome pack's two breakfasts). The operator adds the FULL quantity and
// only the units beyond the free ones are billed; the prepared quantity is untouched so the Planning
// and SAS cards still show everything to serve. Direct bookings only.

function createDb({ freeUnits = 2 } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 0,
      depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '16:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0, extraGuestPriceUnit TEXT DEFAULT 'per_stay');
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER, label TEXT, pricePerNight REAL DEFAULT 100,
      pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]', dateRanges TEXT DEFAULT '[]',
      color TEXT DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1, maxNights INTEGER);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0,
      optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0,
      autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT,
      showsPlanningCard INTEGER DEFAULT 0, cardRepeat TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL DEFAULT 0,
      freeUnits REAL NOT NULL DEFAULT 0, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0,
      priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0);
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Aventura Lodge')").run();
  db.prepare(`INSERT INTO pricing_rules (id, propertyId, pricePerNight, dateRanges)
    VALUES (1, 1, 100, '[{"startDate":"2026-01-01","endDate":"2026-12-31"}]')`).run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (10, 'Petit-déjeuner', 'per_person_per_night', 10)").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 10)').run();
  db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price, freeUnits) VALUES (1, 10, 10, ?)').run(freeUnits);
  return db;
}

const BASE = {
  propertyId: 1, checkInTime: '16:00', checkOutTime: '10:00', children: 0, teens: 0, babies: 0,
  customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
  selectedOptions: [{ optionId: 10, quantity: 1 }],
};
const line = (q) => q.optionLines.find((l) => l.optionId === 10);

test('5 guests × 2 nights with 2 free: 10 breakfasts prepared, 8 billed', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, adults: 5, startDate: '2026-05-01', endDate: '2026-05-03' });
  const l = line(q);
  assert.equal(l.billedUnits, 10, 'the full quantity stays — the SAS still prepares 10');
  assert.equal(l.freeUnits, 2);
  assert.equal(l.chargedUnits, 8);
  assert.equal(l.freeUnitsAmount, 20, 'the value of what is offered, for the guest to see');
  assert.equal(l.totalPrice, 80);
  assert.equal(q.optionsTotal, 80);
  db.close();
});

test('2 guests × 1 night with 2 free: everything is included, nothing billed', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, adults: 2, startDate: '2026-05-01', endDate: '2026-05-02' });
  const l = line(q);
  assert.equal(l.billedUnits, 2);
  assert.equal(l.freeUnits, 2);
  assert.equal(l.chargedUnits, 0);
  assert.equal(l.totalPrice, 0);
  db.close();
});

test('the free units never exceed what was ordered', () => {
  const db = createDb({ freeUnits: 5 });
  const q = calculateReservationQuote({ ...BASE, db, adults: 1, startDate: '2026-05-01', endDate: '2026-05-02' });
  const l = line(q);
  assert.equal(l.billedUnits, 1);
  assert.equal(l.freeUnits, 1, 'clamped to the ordered quantity — never a negative charge');
  assert.equal(l.totalPrice, 0);
  db.close();
});

test('no free units configured → the option bills in full (every existing property)', () => {
  const db = createDb({ freeUnits: 0 });
  const q = calculateReservationQuote({ ...BASE, db, adults: 5, startDate: '2026-05-01', endDate: '2026-05-03' });
  const l = line(q);
  assert.equal(l.freeUnits, 0);
  assert.equal(l.totalPrice, 100);
  db.close();
});

test('a platform reservation gets no free units — the pack is direct-only (rule 53)', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, db, adults: 5, startDate: '2026-05-01', endDate: '2026-05-03', platform: 'Airbnb',
  });
  const l = line(q);
  assert.equal(l.freeUnits, 0);
  assert.equal(l.totalPrice, 100);
  db.close();
});

test('offering the whole line still zeroes it and keeps the real price recoverable', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, db, adults: 5, startDate: '2026-05-01', endDate: '2026-05-03', offeredOptionIds: [10],
  });
  const l = line(q);
  assert.equal(l.totalPrice, 0);
  assert.equal(l.originalTotalPrice, 80, 'the amount that would have been charged after the free units');
  db.close();
});

// The real breakfast option is a PLANNING-CARD option: it is billed from the mornings actually
// ticked, not from a bare quantity. The free units must apply on that branch too — this is the
// path every real reservation takes.
function createPlanningCardDb() {
  const db = createDb();
  db.prepare("UPDATE options SET showsPlanningCard = 1, cardRepeat = 'once_per_day' WHERE id = 10").run();
  return db;
}

test('planning-card breakfast: 5 guests × 2 mornings ticked → 10 prepared, 2 free, 8 billed', () => {
  const db = createPlanningCardDb();
  const q = calculateReservationQuote({
    ...BASE, db, adults: 5, startDate: '2026-05-01', endDate: '2026-05-03',
    selectedOptions: [{
      optionId: 10, quantity: 1,
      cardOccurrences: [{ date: '2026-05-02', time: '08:30' }, { date: '2026-05-03', time: '08:30' }],
    }],
  });
  const l = line(q);
  assert.equal(l.billedUnits, 10, 'the SAS still prepares every breakfast');
  assert.equal(l.cardOccurrences.length, 2, 'both mornings stay scheduled');
  assert.equal(l.freeUnits, 2);
  assert.equal(l.freeUnitsAmount, 20);
  assert.equal(l.totalPrice, 80);
  db.close();
});

test('planning-card breakfast on a platform reservation bills every unit', () => {
  const db = createPlanningCardDb();
  const q = calculateReservationQuote({
    ...BASE, db, adults: 5, startDate: '2026-05-01', endDate: '2026-05-03', platform: 'Booking',
    selectedOptions: [{
      optionId: 10, quantity: 1,
      cardOccurrences: [{ date: '2026-05-02', time: '08:30' }, { date: '2026-05-03', time: '08:30' }],
    }],
  });
  const l = line(q);
  assert.equal(l.freeUnits, 0);
  assert.equal(l.totalPrice, 100);
  db.close();
});

test('planning-card breakfast, a single morning for 2 guests → entirely covered', () => {
  const db = createPlanningCardDb();
  const q = calculateReservationQuote({
    ...BASE, db, adults: 2, startDate: '2026-05-01', endDate: '2026-05-02',
    selectedOptions: [{ optionId: 10, quantity: 1, cardOccurrences: [{ date: '2026-05-02', time: '08:30' }] }],
  });
  const l = line(q);
  assert.equal(l.billedUnits, 2);
  assert.equal(l.freeUnits, 2);
  assert.equal(l.totalPrice, 0);
  db.close();
});
