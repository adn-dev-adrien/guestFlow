const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;
const { setDirectChannels } = require('../utils/platformNameFormat');

// specs/tourist-tax-included-services-deduction.md rule 17 — spec review 2026-10-27 (M3). On a
// platform booking whose brut is entered, the base is the brut less the extras and the supplement it
// carries; the fiche's « Base : X − Y de prestations comprises » still printed the TARIFF as X, so
// X − Y was not the base the tax was computed on.

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
  db.prepare("INSERT INTO platforms (id, name, collectsTouristTax, touristTaxRemittedByPlatform) VALUES (1, 'Booking', 0, 0)").run();
  return db;
}

const BASE = {
  propertyId: 1, startDate: '2026-05-01', endDate: '2026-05-04',
  checkInTime: '15:00', checkOutTime: '10:00', adults: 2, children: 0, teens: 0, babies: 0,
  selectedOptions: [], customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
};

const INCLUSIONS = {
  selectedOptions: [
    { optionId: 7, quantity: 1, offered: 1 },
    { optionId: 8, quantity: 1, offered: 1 },
    { optionId: 9, quantity: 1, offered: 1 },
  ],
  offeredOptionIds: [7, 8, 9],
};

test('a brut booking names the paid base, so X − Y is the base the tax used', () => {
  setDirectChannels(['direct']);
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, ...INCLUSIONS, adults: 4, db, platform: 'Booking', platformGrossAmount: 450,
  });
  assert.equal(q.extraGuestInBrutSurcharge, 50, '2 extra × 25 € per stay, inside the brut');
  assert.equal(q.touristTaxIncludedInRateDeduction, 60);
  assert.equal(q.touristTaxBaseAccommodation, 340, '450 − 50 − 60');
  assert.equal(q.touristTaxBaseBeforeDeduction, 400, '450 − 50: the brut, not the 359,79 € tariff');
  assert.equal(
    Math.round((q.touristTaxBaseBeforeDeduction - q.touristTaxIncludedInRateDeduction) * 100) / 100,
    q.touristTaxBaseAccommodation,
  );
  db.close();
});

test('without a brut the caption keeps the tariff', () => {
  setDirectChannels(['direct']);
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, ...INCLUSIONS, db });
  assert.equal(q.touristTaxBaseBeforeDeduction, 359.79);
  db.close();
});
