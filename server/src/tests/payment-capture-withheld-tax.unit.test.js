// A platform booking whose tourist tax the platform withheld can be marked paid
// (specs/platform-tourist-tax-out-of-the-commission.md rule 25).
//
// The fiche prices the solde as « brut − taxe retenue », but `buildReservationEngineInput` never
// selected `platformTouristTaxAmount`, so the contribution capture replayed the booking with the
// tax back in the solde and refused the flip on its conservation invariant (409). Measured on a
// copy of production on 2026-10-23: reservation 202609003 (Airbnb, 24 € withheld) and 11773
// (Gîtes de France, 19,20 €) could not be marked paid from the fiche.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildReservationEngineInput } = require('../utils/reservationEngineInput');
const { calculateReservationQuote } = require('../utils/pricing');
const { captureContribsOnFlip } = require('../utils/forceItemContribsCapture');

const GROSS = 600;
const WITHHELD = 20;

function seedDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, maxGuests INTEGER DEFAULT 10,
      depositPercent REAL DEFAULT 30, depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '16:00', defaultCheckOut TEXT DEFAULT '10:00',
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
    CREATE TABLE options (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '',
      priceType TEXT NOT NULL DEFAULT 'per_stay', price REAL NOT NULL DEFAULT 0,
      optionProgressiveTiers TEXT NOT NULL DEFAULT '[]', autoOptionType TEXT,
      autoEnabled INTEGER NOT NULL DEFAULT 0, autoPricingMode TEXT NOT NULL DEFAULT 'fixed', autoFullNightThreshold TEXT,
      showsPlanningCard INTEGER NOT NULL DEFAULT 0, cardRepeat TEXT DEFAULT 'once_per_day', planningCardTimes TEXT DEFAULT '["09:00"]'
    );
    CREATE TABLE property_options ( propertyId INTEGER NOT NULL, optionId INTEGER NOT NULL, PRIMARY KEY (propertyId, optionId) );
    CREATE TABLE resources ( id INTEGER PRIMARY KEY, name TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0, price REAL NOT NULL DEFAULT 0, priceType TEXT NOT NULL DEFAULT 'per_stay', isComplex INTEGER NOT NULL DEFAULT 0, propertyIds TEXT DEFAULT '[]' );
    CREATE TABLE property_resource_prices ( propertyId INTEGER NOT NULL, resourceId INTEGER NOT NULL, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId) );
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY, propertyId INTEGER, startDate TEXT, endDate TEXT,
      checkInTime TEXT, checkOutTime TEXT, adults INTEGER, children INTEGER, teens INTEGER, babies INTEGER,
      babyBeds INTEGER DEFAULT 0, discountPercent REAL DEFAULT 0, customPrice REAL,
      platform TEXT DEFAULT 'direct', extraGuestSurchargeOffered INTEGER DEFAULT 0,
      touristTaxInComplement INTEGER DEFAULT 0, platformGrossAmount REAL, platformTouristTaxAmount REAL,
      touristTaxRate REAL, touristTaxTotal REAL, touristTaxFrozenBaseHt REAL,
      touristTaxFrozenOccupants INTEGER, touristTaxFrozenAt TEXT,
      depositAmount REAL DEFAULT 0, balanceAmount REAL DEFAULT 0, complementAmount REAL DEFAULT 0,
      depositPaid INTEGER DEFAULT 0, balancePaid INTEGER DEFAULT 0, complementPaid INTEGER DEFAULT 0,
      finalPrice REAL DEFAULT 0,
      accommodationAcompteContribTtc REAL, accommodationSoldeContribTtc REAL,
      touristTaxAcompteContribTtc REAL, touristTaxSoldeContribTtc REAL
    );
    CREATE TABLE reservation_options (
      reservationId INTEGER, optionId INTEGER, quantity REAL, unitPrice REAL, billedUnits REAL,
      priceType TEXT, totalPrice REAL, offered INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0,
      acompteContribTtc REAL, soldeContribTtc REAL, cardOccurrences TEXT, cardPersons INTEGER,
      PRIMARY KEY (reservationId, optionId)
    );
    CREATE TABLE reservation_custom_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, description TEXT,
      amount REAL, offered INTEGER DEFAULT 0, sortOrder INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0,
      acompteContribTtc REAL, soldeContribTtc REAL);
    CREATE TABLE reservation_resources (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, resourceId INTEGER,
      quantity REAL, unitPrice REAL, billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER DEFAULT 0,
      inComplement INTEGER DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL, sessions TEXT);
    CREATE TABLE reservation_nights (reservationId INTEGER, date TEXT, seasonLabel TEXT, pricingMode TEXT, price REAL);
  `);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte test')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 300, 1)').run();
  // No `platforms` table → the legacy default for a non-direct platform: it collects AND remits the
  // tax itself (the OFFERED case, the only one in which a withheld amount is read).
  db.prepare(`INSERT INTO reservations
    (id, propertyId, startDate, endDate, checkInTime, checkOutTime, adults, children, teens, babies,
     platform, platformGrossAmount, platformTouristTaxAmount, balanceAmount, finalPrice)
    VALUES (1, 1, '2027-03-08', '2027-03-10', '16:00', '10:00', 4, 0, 0, 0, 'Airbnb', ?, ?, ?, ?)`)
    .run(GROSS, WITHHELD, GROSS - WITHHELD, GROSS - WITHHELD);
  return db;
}

const row = (db) => db.prepare('SELECT * FROM reservations WHERE id = 1').get();

test('the engine input carries the tourist tax the platform withheld', () => {
  const db = seedDb();
  assert.equal(buildReservationEngineInput(db, row(db)).platformTouristTaxAmount, WITHHELD);
});

test('the replayed solde is the brut minus the withheld tax, as on the fiche', () => {
  const db = seedDb();
  const quote = calculateReservationQuote(buildReservationEngineInput(db, row(db)));
  assert.equal(quote.balanceAmount, GROSS - WITHHELD);
});

test('marking the solde paid captures its contributions instead of refusing the flip', () => {
  const db = seedDb();
  assert.doesNotThrow(() => captureContribsOnFlip({ db, reservation: row(db), bucket: 'balance' }));
  assert.equal(row(db).accommodationSoldeContribTtc, GROSS - WITHHELD);
});
