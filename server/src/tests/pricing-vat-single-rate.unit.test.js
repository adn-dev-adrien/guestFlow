const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;
const { roundMoney } = require('../utils/pricing');

// Single-rate global VAT model — specs/single-vat-rate.md. The two-rate split (accommodation vs.
// standard) was collapsed to a single `app_settings.vatRate` column that drives every billable
// line of the quote (accommodation, options, custom options, resources). The legacy
// per-property `vatPercentage*` columns remain dropped — only the single global drives the quote.
// The quote payload keeps the `vatPercentageAccommodation` / `vatPercentageOptions` /
// `vatPercentageResources` field names for backward compatibility — they just always carry the
// same value now.
function createDb({ withSettings = true, vatRate = 10 } = {}) {
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
  `);
  if (withSettings) {
    db.exec('CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10)');
    db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, ?)').run(vatRate);
  }
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Maison test')").run();
  db.prepare("INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)").run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (1, 'Ménage', 'per_stay', 60)").run();
  db.prepare("INSERT INTO property_options (propertyId, optionId) VALUES (1, 1)").run();
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
  selectedResources: [],
  depositPaid: false,
  balancePaid: false,
  discountPercent: 0,
  customPrice: '',
};

function quoteWith(db) {
  return calculateReservationQuote({ ...BASE_INPUTS, db, selectedOptions: [{ optionId: 1, quantity: 1 }] });
}

test('accommodation, options and resources all use the single global rate', () => {
  const db = createDb({ vatRate: 10 });
  const q = quoteWith(db);
  // All three legacy payload keys carry the SAME single rate now.
  assert.equal(q.vatPercentageAccommodation, 10);
  assert.equal(q.vatPercentageOptions, 10);
  assert.equal(q.vatPercentageResources, 10);
  // Accommodation 200 TTC @10% → VAT = 200 * 10/110.
  assert.equal(q.accommodationVatAmount, roundMoney(200 * (10 / 110)));
  // Option 60 TTC @10% → VAT = 60 * 10/110.
  assert.equal(q.optionsVatAmount, roundMoney(60 * (10 / 110)));
  db.close();
});

test('TTC totals are independent of the VAT rate (VAT is extracted, not added)', () => {
  const a = quoteWith(createDb({ vatRate: 10 }));
  const b = quoteWith(createDb({ vatRate: 0 }));
  assert.equal(a.finalPrice, b.finalPrice); // 200 + 60 = 260 either way
  assert.equal(a.finalPrice, 260);
  // Only the VAT split differs.
  assert.equal(b.accommodationVatAmount, 0);
  assert.equal(b.optionsVatAmount, 0);
  assert.notEqual(a.accommodationVatAmount, 0);
  assert.notEqual(a.optionsVatAmount, 0);
});

test('missing app_settings falls back to the 10 % default', () => {
  const q = quoteWith(createDb({ withSettings: false }));
  assert.equal(q.vatPercentageAccommodation, 10);
  assert.equal(q.vatPercentageOptions, 10);
  assert.equal(q.vatPercentageResources, 10);
});

test('custom global rate flows through to the quote (e.g. 5.5 %)', () => {
  const q = quoteWith(createDb({ vatRate: 5.5 }));
  assert.equal(q.vatPercentageAccommodation, 5.5);
  assert.equal(q.vatPercentageOptions, 5.5);
  assert.equal(q.vatPercentageResources, 5.5);
  assert.equal(q.accommodationVatAmount, roundMoney(200 * (5.5 / 105.5)));
  assert.equal(q.optionsVatAmount, roundMoney(60 * (5.5 / 105.5)));
});
