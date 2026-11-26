// Shared fixture of the specs/platforms/platform-host-statement-and-commission-vat.md suites: a minimal engine database (one lodging, a
// ménage and a linge option, the three tourist-tax modes of the platforms) and the production figures of 2026-11-26.
const Database = require('better-sqlite3');

const MODES = { reversed: [1, 0], remits: [1, 1], owner: [0, 0] };

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL,
      depositPercent REAL DEFAULT 30, depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 1.20, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0
    );
    CREATE TABLE pricing_rules (
      id INTEGER PRIMARY KEY, propertyId INTEGER NOT NULL, label TEXT DEFAULT 'Standard',
      pricePerNight REAL NOT NULL DEFAULT 100, pricingMode TEXT NOT NULL DEFAULT 'fixed',
      progressiveTiers TEXT NOT NULL DEFAULT '[]', dateRanges TEXT NOT NULL DEFAULT '[]',
      color TEXT NOT NULL DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1
    );
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT NOT NULL, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0, optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0, autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT, isCancellationInsurance INTEGER DEFAULT 0);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0, propertyIds TEXT DEFAULT '[]');
    CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
    CREATE TABLE platforms (
      id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL,
      collectsTouristTax INTEGER NOT NULL DEFAULT 1, touristTaxRemittedByPlatform INTEGER NOT NULL DEFAULT 1,
      commissionPercent REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, propertyId INTEGER NOT NULL, platformKey TEXT NOT NULL, platformLabel TEXT);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (1, 'Ménage', 'per_stay', 80)").run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (2, 'Linge', 'per_stay', 0)").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 1), (1, 2)').run();
  return db;
}

function addPlatform(db, name, mode, commissionPercent = 0) {
  const [collects, remitted] = MODES[mode];
  db.prepare('INSERT INTO platforms (name, collectsTouristTax, touristTaxRemittedByPlatform, commissionPercent) VALUES (?, ?, ?, ?)')
    .run(name, collects, remitted, commissionPercent);
  db.prepare('INSERT INTO ical_sources (propertyId, platformKey, platformLabel) VALUES (1, ?, ?)').run(name.toLowerCase(), name);
}

const STAY = {
  propertyId: 1, checkInTime: '15:00', checkOutTime: '10:00', children: 0, teens: 0, babies: 0,
  customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '', depositPaid: false, balancePaid: false,
};

const MENAGE_PAID = { optionId: 1, quantity: 1, inComplement: 0 };
const LINGE = { optionId: 2, quantity: 1, inComplement: 0 };

// The stays of the accountant's October review (specs/platforms/platform-host-statement-and-commission-vat.md §1), figures measured in production.
const FRAISSE = {
  ...STAY, startDate: '2026-10-10', endDate: '2026-10-12', adults: 13, platformPaidAdults: 10, platformPaidGuests: 10, platformPaidOccupants: 10, // date-literal-ok: measured production stays handed to the pure pricing engine; the suites pass with the clock in 2032
  selectedOptions: [MENAGE_PAID, LINGE], offeredOptionIds: [2], platform: 'Airbnb',
  platformGrossAmount: 805, platformTouristTaxAmount: 24, platformPayoutAmount: 704.22,
};
const DAUSQUE = {
  ...STAY, startDate: '2026-10-01', endDate: '2026-10-03', adults: 6, // date-literal-ok: measured production stays handed to the pure pricing engine; the suites pass with the clock in 2032
  selectedOptions: [MENAGE_PAID], offeredOptionIds: [1], platform: 'GitesDeFrance',
  platformGrossAmount: 864, platformTouristTaxAmount: 36, platformPayoutAmount: 786,
};
const TOUSSAINT = {
  ...STAY, startDate: '2026-12-26', endDate: '2026-12-30', adults: 5, selectedOptions: [], platform: 'Airbnb', // date-literal-ok: measured production stays handed to the pure pricing engine; the suites pass with the clock in 2032
  platformGrossAmount: 1154.6, platformTouristTaxAmount: 52.8, platformPayoutAmount: 1028.44,
};
const GILIBERT = {
  ...STAY, startDate: '2027-01-10', endDate: '2027-01-12', adults: 11, selectedOptions: [], platform: 'Booking', // date-literal-ok: measured production stays handed to the pure pricing engine; the suites pass with the clock in 2032
  platformGrossAmount: 690, platformTouristTaxAmount: 20.02, platformPayoutAmount: 596.58,
};

module.exports = {
  createDb, addPlatform, STAY, MENAGE_PAID, LINGE, FRAISSE, DAUSQUE, TOUSSAINT, GILIBERT,
};
