/**
 * Shared in-memory database for the 2026-10-27 pricing-engine audit suites (one suite per finding).
 * A minimal schema the engine reads: one property, one season, two options, an optional platform list.
 */
const Database = require('better-sqlite3');

function pricingAuditDb({
  unit = 'per_stay', included = 2, extraGuestPrice = 20, touristTax = 0, depositPercent = 30, platforms = [],
} = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 0,
      depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 30, depositDueDays INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00', maxGuests INTEGER DEFAULT 10,
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0, extraGuestPriceUnit TEXT DEFAULT 'per_stay');
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER, label TEXT, pricePerNight REAL DEFAULT 300,
      pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]', dateRanges TEXT DEFAULT '[]', color TEXT,
      startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1, maxNights INTEGER, extraGuestPrice REAL, extraGuestTiers TEXT);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0,
      optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0,
      autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT, showsPlanningCard INTEGER DEFAULT 0,
      isCancellationInsurance INTEGER DEFAULT 0);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL, freeUnits INTEGER DEFAULT 0);
    CREATE TABLE property_option_defaults (propertyId INTEGER, optionId INTEGER, offered INTEGER DEFAULT 0, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0,
      priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0, propertyIds TEXT DEFAULT '[]');
    CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0,
      PRIMARY KEY (propertyId, resourceId));
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
    CREATE TABLE platforms (id INTEGER PRIMARY KEY, name TEXT, collectsTouristTax INTEGER DEFAULT 1,
      touristTaxRemittedByPlatform INTEGER DEFAULT 1, countsAsDirect INTEGER DEFAULT 0);
    CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, platformKey TEXT, platformLabel TEXT);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare(`INSERT INTO properties (id, name, basePriceIncludedGuests, extraGuestPrice, extraGuestPriceUnit,
    touristTaxPerDayPerPerson, depositPercent) VALUES (1, 'Gîte', ?, ?, ?, ?, ?)`)
    .run(included, extraGuestPrice, unit, touristTax, depositPercent);
  db.prepare("INSERT INTO pricing_rules (id, propertyId, label, pricePerNight) VALUES (1, 1, 'Standard', 300)").run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (10, 'Ménage', 'per_stay', 80), (11, 'Petit déjeuner', 'per_person_per_night', 8)").run();
  db.prepare('INSERT INTO property_options VALUES (1, 10), (1, 11)').run();
  for (const p of platforms) {
    db.prepare('INSERT INTO platforms (name, collectsTouristTax, touristTaxRemittedByPlatform, countsAsDirect) VALUES (?, ?, ?, ?)')
      .run(p.name, p.collects ?? 1, p.remits ?? 1, p.countsAsDirect ?? 0);
  }
  return db;
}

const STAY = {
  propertyId: 1, startDate: '2026-05-01', endDate: '2026-05-03', checkInTime: '15:00', checkOutTime: '10:00',
  adults: 2, children: 0, teens: 0, babies: 0, selectedOptions: [], customOptions: [], selectedResources: [],
  discountPercent: 0, customPrice: '', bookingDate: '2026-01-10',
};

// The locked line a save stores for an option line of a quote.
function storedOptionLine(line) {
  return {
    optionId: line.optionId, quantity: line.quantity, unitPrice: line.unitPrice, billedUnits: line.billedUnits,
    priceType: line.priceType, totalPrice: line.totalPrice, offered: 0,
  };
}

const storedNights = (quote) => quote.nightlyBreakdown.map(({ date, price, pricingMode, seasonLabel }) => ({
  date, price, pricingMode, seasonLabel,
}));

module.exports = { pricingAuditDb, STAY, storedOptionLine, storedNights };
