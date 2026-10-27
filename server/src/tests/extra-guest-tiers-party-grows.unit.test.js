const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;

// specs/tariff-events-and-extra-guest-tiers/spec.md §3 rule 23 — spec review 2026-10-27 (H2).
// A Lodge stay sold for 2 (nobody above the included guests) stored « no tiers » in its tariff
// snapshot, because the tier table was only resolved when someone was billed. Adding a teen later
// replayed that empty table and fell back to the property's single price, 0 €: the newcomer was
// never billed. The tiers are now resolved and stored whatever the count at the sale.

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 0,
      depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '16:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 2, extraGuestPrice REAL DEFAULT 0, extraGuestPriceUnit TEXT DEFAULT 'per_night');
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER, label TEXT, pricePerNight REAL DEFAULT 200,
      pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]', dateRanges TEXT DEFAULT '[]',
      color TEXT DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1, maxNights INTEGER,
      extraGuestPrice REAL, extraGuestTiers TEXT);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0,
      optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0,
      autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT, showsPlanningCard INTEGER DEFAULT 0, cardRepeat TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL DEFAULT 0,
      freeUnits REAL NOT NULL DEFAULT 0, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0,
      priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0);
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Aventura Lodge')").run();
  db.prepare(`INSERT INTO pricing_rules (id, propertyId, pricePerNight, dateRanges, extraGuestTiers)
    VALUES (1, 1, 200, '[{"startDate":"2026-01-01","endDate":"2027-12-31"}]', ?)`)
    .run(JSON.stringify([{ fromNight: 1, price: 15 }, { fromNight: 2, price: 8 }]));
  return db;
}

const STAY = {
  propertyId: 1, checkInTime: '16:00', checkOutTime: '10:00', children: 0, babies: 0,
  customOptions: [], selectedResources: [], selectedOptions: [], discountPercent: 0, customPrice: '',
  platform: 'direct', startDate: '2027-04-19', endDate: '2027-04-22',
};

test('a stay sold for the included guests stores the tier table it was sold under', () => {
  const db = createDb();
  const sold = calculateReservationQuote({ ...STAY, db, adults: 2, teens: 0 });
  assert.equal(sold.extraGuestSurcharge, 0);
  assert.deepEqual(sold.tariffSnapshot.extraGuestTiers, [{ fromNight: 1, price: 15 }, { fromNight: 2, price: 8 }]);
  db.close();
});

test('a teen added after the sale is billed 15 + 8 + 8 = 31 €, as a fresh quote would', () => {
  const db = createDb();
  const sold = calculateReservationQuote({ ...STAY, db, adults: 2, teens: 0 });
  const grown = calculateReservationQuote({ ...STAY, db, adults: 2, teens: 1, lockedTariff: sold.tariffSnapshot });
  assert.equal(grown.extraGuestCount, 1);
  assert.equal(grown.extraGuestSurcharge, 31);
  const fresh = calculateReservationQuote({ ...STAY, db, adults: 2, teens: 1 });
  assert.equal(fresh.extraGuestSurcharge, 31);
  db.close();
});

test('a later recipe change does not reach the grown party — the sold table wins', () => {
  const db = createDb();
  const sold = calculateReservationQuote({ ...STAY, db, adults: 2, teens: 0 });
  db.prepare('UPDATE pricing_rules SET extraGuestTiers = ?')
    .run(JSON.stringify([{ fromNight: 1, price: 30 }, { fromNight: 2, price: 20 }]));
  const grown = calculateReservationQuote({ ...STAY, db, adults: 4, teens: 0, lockedTariff: sold.tariffSnapshot });
  assert.equal(grown.extraGuestSurcharge, 62, '2 × (15 + 8 + 8)');
  db.close();
});

test('a stay sold on a season without tiers stores an explicit empty table', () => {
  const db = createDb();
  db.prepare('UPDATE pricing_rules SET extraGuestTiers = NULL').run();
  const sold = calculateReservationQuote({ ...STAY, db, adults: 2, teens: 0 });
  assert.deepEqual(sold.tariffSnapshot.extraGuestTiers, []);
  db.close();
});
