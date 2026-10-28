const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;
const { setDirectChannels } = require('../utils/platformNameFormat');

// specs/platform-tourist-tax-out-of-the-commission.md rule 26 — spec review 2026-10-27 (agent 4 #5).
// A platform that withheld NO tourist tax (« 0 » typed in the box) is an answer; the engine served it
// as `null`, so the fiche fell back to its own estimate and printed it struck through as if the
// platform had kept it.

function createDb({ mode = 'percentage_accommodation', includedGuests = 2 } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 0,
      depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0, extraGuestPriceUnit TEXT DEFAULT 'per_stay');
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER, label TEXT,
      pricePerNight REAL DEFAULT 100, pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]',
      dateRanges TEXT DEFAULT '[]', color TEXT DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0,
      optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0,
      autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE property_option_defaults (propertyId INTEGER, optionId INTEGER, offered INTEGER DEFAULT 0, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0,
      priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0);
    CREATE TABLE platforms (id INTEGER PRIMARY KEY, name TEXT, collectsTouristTax INTEGER DEFAULT 1,
      touristTaxRemittedByPlatform INTEGER DEFAULT 1);
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare(`INSERT INTO properties
      (id, name, touristTaxMode, touristTaxPercentage, touristTaxDepartmentPercentage, touristTaxPerDayPerPerson,
       basePriceIncludedGuests, extraGuestPrice, extraGuestPriceUnit)
    VALUES (1, 'Aventura lodge', ?, ?, ?, ?, ?, 25, 'per_stay')`)
    .run(
      mode,
      mode === 'per_day_per_person' ? 0 : 5,
      mode === 'per_day_per_person' ? 0 : 10,
      mode === 'per_day_per_person' ? 1.2 : 0,
      includedGuests,
    );
  db.prepare(`INSERT INTO pricing_rules (id, propertyId, pricePerNight, dateRanges)
    VALUES (1, 1, 119.93, '[{"startDate":"2026-01-01","endDate":"2026-12-31"}]')`).run();
  const addOption = db.prepare('INSERT INTO options (id, title, priceType, price) VALUES (?, ?, ?, ?)');
  addOption.run(7, 'Ménage', 'per_stay', 30);
  addOption.run(8, 'Linge de lit', 'per_person', 7);
  addOption.run(9, 'Linge de toilette', 'per_person', 8);
  addOption.run(11, 'Panier gourmand', 'per_stay', 45);
  const addApplicable = db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, ?)');
  for (const id of [7, 8, 9, 11]) addApplicable.run(id);
  const addDefault = db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, ?, 1)');
  for (const id of [7, 8, 9]) addDefault.run(id);
  db.prepare("INSERT INTO resources (id, name, quantity, price, priceType) VALUES (20, 'Bain nordique', 1, 90, 'per_stay')").run();
  db.prepare("INSERT INTO platforms (id, name, collectsTouristTax, touristTaxRemittedByPlatform) VALUES (1, 'Booking', 1, 1)").run();
  return db;
}

const BASE = {
  propertyId: 1, startDate: '2026-05-01', endDate: '2026-05-04',
  checkInTime: '15:00', checkOutTime: '10:00', adults: 2, children: 0, teens: 0, babies: 0,
  selectedOptions: [], customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
};

const STAY = { ...BASE, platform: 'Booking', platformGrossAmount: 450 };

test('« 0 » withheld is served as 0, not as an empty box', () => {
  setDirectChannels(['direct']);
  const db = createDb();
  const q = calculateReservationQuote({ ...STAY, db, platformTouristTaxAmount: 0 });
  assert.equal(q.touristTaxOfferedByPlatform, true);
  assert.equal(q.platformTouristTaxWithheld, 0);
  db.close();
});

test('an empty box stays null, an amount stays the amount', () => {
  setDirectChannels(['direct']);
  const db = createDb();
  assert.equal(calculateReservationQuote({ ...STAY, db, platformTouristTaxAmount: '' }).platformTouristTaxWithheld, null);
  assert.equal(calculateReservationQuote({ ...STAY, db }).platformTouristTaxWithheld, null);
  assert.equal(calculateReservationQuote({ ...STAY, db, platformTouristTaxAmount: 12.5 }).platformTouristTaxWithheld, 12.5);
  db.close();
});

test('a negative amount stays an empty box — never an answer of 0', () => {
  setDirectChannels(['direct']);
  const db = createDb();
  assert.equal(calculateReservationQuote({ ...STAY, db, platformTouristTaxAmount: -14.4 }).platformTouristTaxWithheld, null);
  db.close();
});
