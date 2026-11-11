// specs/pricing-components.md §3 rules 17, 50 and 70 — PLATFORM PRICE alone: the gross pin (accommodation = gross − extra
// guests in the gross − lines inside the platform price − withheld / reversed tax, floored at 0, to the cent), the
// display gross-up `grossFromNet` shared with the engine, the settings schema, and the pin against the engine's quote.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const platformPrice = require('../utils/pricing/platformPrice');
const engine = require('../utils/pricing');
const { settingsSchema } = platformPrice;

const { resolvePlatformPrice, grossFromNet } = platformPrice;

test('rule 17 — the accommodation is the gross less every term the platform price already holds', () => {
  const { accommodation } = resolvePlatformPrice({
    gross: 500, extraGuestsInBrut: 40, platformLines: 60, withheldTax: [10, 5],
  });
  assert.equal(accommodation, 385);
});

test('rule 17 — platformLines may be a list of line totals, summed to the cent', () => {
  assert.equal(resolvePlatformPrice({ gross: 100, platformLines: [10.1, 20.2] }).accommodation, 69.7);
  assert.equal(resolvePlatformPrice({ gross: 100, platformLines: [] }).accommodation, 100);
});

test('rule 17 — withheldTax is a total or the pair [reversed, withheld]', () => {
  assert.equal(resolvePlatformPrice({ gross: 100, withheldTax: 7 }).accommodation, 93);
  assert.equal(resolvePlatformPrice({ gross: 100, withheldTax: [7, 3] }).accommodation, 90);
});

test('rule 17 — a gross that does not cover the terms is floored at 0, never negative', () => {
  assert.equal(resolvePlatformPrice({ gross: 50, platformLines: 80 }).accommodation, 0);
});

test('rule 17 — no gross, no pin: the accommodation stays the tariff\'s (null)', () => {
  for (const gross of [null, undefined, '']) assert.equal(resolvePlatformPrice({ gross, platformLines: 5 }).accommodation, null);
});

test('rule 70 — mode gross carries no commission (it is a stored figure); mode commission gives the display figures', () => {
  assert.deepEqual(resolvePlatformPrice({ mode: 'gross', gross: 200, commissionRate: 15 }), { accommodation: 200, commission: null, payout: null });
  assert.deepEqual(resolvePlatformPrice({ mode: 'commission', gross: 200, commissionRate: 15 }), { accommodation: 200, commission: 30, payout: 170 });
  assert.deepEqual(resolvePlatformPrice({ mode: 'commission', gross: null, commissionRate: 15 }), { accommodation: null, commission: null, payout: null });
});

test('rule 17 — grossFromNet is the one function the catalogue grid and the engine export', () => {
  assert.equal(engine.grossFromNet, grossFromNet);
  assert.equal(grossFromNet(100, 15), 118);
  assert.equal(grossFromNet(100, 15, { rounding: 'cents' }), 117.65);
  assert.equal(grossFromNet(160, 5, { fixedCost: 9.32 }), 179);
  assert.equal(grossFromNet(100, 100), null);
  assert.equal(grossFromNet(80, -5), 80);
});

test('rule 50 — settingsSchema: gross / commission mode and a rate below 100', () => {
  const by = Object.fromEntries(settingsSchema.map((entry) => [entry.key, entry]));
  assert.equal(by.mode.default, 'gross');
  assert.equal(by.mode.validate('commission'), null);
  assert.notEqual(by.mode.validate('net'), null);
  assert.equal(by.commissionRate.validate(15), null);
  assert.notEqual(by.commissionRate.validate(100), null);
  assert.notEqual(by.commissionRate.validate(-1), null);
});

function engineDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT NOT NULL, depositPercent REAL DEFAULT 30, depositDaysBefore INTEGER DEFAULT 30,
      balanceDaysBefore INTEGER DEFAULT 7, defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 1.20, touristTaxMode TEXT DEFAULT 'per_day_per_person', touristTaxPercentage REAL DEFAULT 0,
      touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0, basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0);
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER NOT NULL, label TEXT DEFAULT 'Standard', pricePerNight REAL NOT NULL DEFAULT 100,
      pricingMode TEXT NOT NULL DEFAULT 'fixed', progressiveTiers TEXT NOT NULL DEFAULT '[]', dateRanges TEXT NOT NULL DEFAULT '[]',
      color TEXT NOT NULL DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT NOT NULL, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0, optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0, autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0, propertyIds TEXT DEFAULT '[]');
    CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
    CREATE TABLE platforms (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, collectsTouristTax INTEGER NOT NULL DEFAULT 1, touristTaxRemittedByPlatform INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, propertyId INTEGER NOT NULL, platformKey TEXT NOT NULL, platformLabel TEXT);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Tente')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  db.prepare("INSERT INTO platforms (name, collectsTouristTax, touristTaxRemittedByPlatform) VALUES ('expedia', 1, 0)").run();
  db.prepare("INSERT INTO ical_sources (propertyId, platformKey, platformLabel) VALUES (1, 'expedia', 'expedia')").run();
  return db;
}

test('rule 17 — the unit and the engine agree: the engine\'s accommodation under a reversed-tax gross is the unit\'s pin', () => {
  const db = engineDb();
  const quote = engine.__test.calculateReservationQuote({
    propertyId: 1, db, platform: 'expedia', startDate: '2026-07-10', endDate: '2026-07-12', checkInTime: '15:00', checkOutTime: '10:00', // date-literal-ok: seeded stay, nothing compares with today
    adults: 2, children: 0, teens: 0, babies: 0, selectedOptions: [], customOptions: [], selectedResources: [],
    discountPercent: 0, customPrice: '', depositPaid: false, balancePaid: false,
    platformGrossAmount: 204.8, platformCommissionAmount: 20,
  });
  const { accommodation } = resolvePlatformPrice({ gross: 204.8, extraGuestsInBrut: 0, platformLines: 0, withheldTax: [4.8, 0] });
  assert.equal(quote.accommodationAdjustedPrice, accommodation);
  assert.equal(accommodation, 200);
  db.close();
});
