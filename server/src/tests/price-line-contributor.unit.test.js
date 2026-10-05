// The price-line contributor (specs/plugins-phase-3c-hourly-resources.md rules 1–4).

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const registry = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');
const priceLineContributors = require('../utils/priceLineContributors');
const { calculateReservationQuote } = require('../utils/pricing').__test;

function pricingDb() {
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
      isComplex INTEGER NOT NULL DEFAULT 0, propertyIds TEXT DEFAULT '[]',
      showsPlanningCard INTEGER NOT NULL DEFAULT 0, slotDuration INTEGER NOT NULL DEFAULT 30,
      hourlyEveningStart TEXT, hourlyEveningRate REAL NOT NULL DEFAULT 0,
      openTime TEXT DEFAULT '12:00', closeTime TEXT DEFAULT '22:00', minimumUsageMinutes INTEGER DEFAULT 60
    );
    CREATE TABLE property_resource_prices ( propertyId INTEGER NOT NULL, resourceId INTEGER NOT NULL, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId) );
  `);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Maison test')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 120, 1)').run();
  db.prepare("INSERT INTO resources (id, name, quantity, price, priceType) VALUES (14, 'Sauna', 1, 30, 'per_hour')").run();
  db.prepare("INSERT INTO resources (id, name, quantity, price, priceType, isComplex) VALUES (15, 'Vélo', 2, 10, 'per_night', 1)").run();
  db.prepare('INSERT INTO property_resource_prices (propertyId, resourceId, price, freeMinutes) VALUES (1, 15, 10, 60)').run();
  return db;
}

const STAY = {
  propertyId: 1, startDate: '2026-07-10', endDate: '2026-07-13',
  adults: 2, children: 0, teens: 0, babies: 0, selectedOptions: [], customOptions: [],
};
const lineOf = (quote, id) => quote.resourceLines.find((l) => Number(l.resourceId) === id);

// A plugin declaring a contributor, live unless told otherwise.
function declare(contributor, { live = true, id = 'hourly-resources' } = {}) {
  registry.reset();
  registry.configure({ isActive: () => live, allows: () => true });
  createContext(id, {}).priceLineContributor({ id, priceTypes: ['per_hour'], ...contributor });
}

test.afterEach(() => registry.reset());

test('rule 1: a contributor lacking a member is refused at registration', () => {
  registry.reset();
  assert.throws(() => createContext('hourly-resources', {}).priceLineContributor({ id: 'x', priceTypes: ['per_hour'] }), /lacks "priceLine"/);
});

test('rule 1: one contributor per price type — a second plugin fails its registration', () => {
  declare({ priceLine: () => null });
  assert.throws(
    () => createContext('other', {}).priceLineContributor({ id: 'other', priceTypes: ['per_hour'], priceLine: () => null }),
    /already priced by hourly-resources/,
  );
});

test('rules 1–2: an unsold line takes the amounts; `extra` is closed', () => {
  declare({
    priceLine: () => ({
      quantity: 2, unitPrice: 40, billedUnits: 2, totalPrice: 80,
      extra: { sessions: [], scheduledHours: 2, detail: 'x', totalPrice: 1 },
    }),
  });
  const line = lineOf(calculateReservationQuote({ db: pricingDb(), ...STAY, selectedResources: [{ resourceId: 14, quantity: 2 }] }), 14);
  assert.equal(line.totalPrice, 80);
  assert.equal(line.scheduledHours, 2);
  assert.equal(line.detail, 'x');
  assert.equal(line.originalTotalPrice, 80, 'an extra key never reaches the line');
});

test('rule 3: a sold line goes through the lock with its sold hours, whatever the plugin prices', () => {
  declare({ priceLine: () => ({ quantity: 1, unitPrice: 50, billedUnits: 1, totalPrice: 50, extra: { scheduledHours: 1 } }) });
  const quote = calculateReservationQuote({
    db: pricingDb(), ...STAY,
    lockedResourceLines: [{ resourceId: 14, quantity: 3, unitPrice: 30, billedUnits: 3, priceType: 'per_hour', totalPrice: 90, offered: 0 }],
    selectedResources: [{ resourceId: 14, quantity: 3 }],
  });
  const line = lineOf(quote, 14);
  assert.equal(line.quantity, 3, 'never fewer hours than sold');
  assert.equal(line.totalPrice, 90);
  assert.equal(line.scheduledHours, 1);
});

test('rule 1: a throwing contributor leaves the line to the engine, and the quote stands', () => {
  declare({ priceLine: () => { throw new Error('boom'); } });
  const errors = [];
  const answer = priceLineContributors.priceLine({ id: 14, priceType: 'per_hour' }, {}, { error: (...a) => errors.push(a), warn: () => {} });
  assert.equal(answer, null);
  assert.equal(errors.length, 1);
  const line = lineOf(calculateReservationQuote({ db: pricingDb(), ...STAY, selectedResources: [{ resourceId: 14, quantity: 2 }] }), 14);
  assert.equal(line.totalPrice, 60, '2 h × 30 € as a plain quantity');
});

test('rule 2: the contributor of an inactive plugin is never called, and per_hour is not offered', () => {
  let called = false;
  declare({ priceLine: () => { called = true; return null; } }, { live: false });
  calculateReservationQuote({ db: pricingDb(), ...STAY, selectedResources: [{ resourceId: 14, quantity: 2 }] });
  assert.equal(called, false);
  assert.equal(priceLineContributors.offered('per_hour'), false);
  assert.equal(priceLineContributors.offered('per_stay'), true, 'a core price type is always offered');
});

test('rule 4: slot settings and a free hour on another price type keep its multiplier and its stock', () => {
  registry.reset();
  const line = lineOf(calculateReservationQuote({ db: pricingDb(), ...STAY, selectedResources: [{ resourceId: 15, quantity: 1 }] }), 15);
  assert.equal(line.billedUnits, 3, '1 bike × 3 nights, no hour deducted');
  assert.equal(line.totalPrice, 30);
});
