// A replay keeps the hours placed (specs/plugins-phase-3c-hourly-resources.md rule 5).
//
// `buildReservationEngineInput` re-prices a stored stay for finance, the contribution capture and the
// Neat runner. It left the sessions out, so a replayed bath lost `scheduledHours` and read
// « À planifier » however many hours were placed. The amount was right either way: a sold line is the
// locked snapshot's.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildReservationEngineInput } = require('../utils/reservationEngineInput');
const { calculateReservationQuote } = require('../utils/pricing');
const { liveHourlyResources } = require('./hourlyResourcesFixture');

liveHourlyResources();

function seedDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, maxGuests INTEGER DEFAULT 10,
      depositPercent REAL DEFAULT 30, depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '16:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 1.10, touristTaxMode TEXT DEFAULT 'per_day_per_person',
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
    CREATE TABLE resources ( id INTEGER PRIMARY KEY, name TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0, price REAL NOT NULL DEFAULT 0, priceType TEXT NOT NULL DEFAULT 'per_stay', isComplex INTEGER NOT NULL DEFAULT 0, propertyIds TEXT DEFAULT '[]', showsPlanningCard INTEGER NOT NULL DEFAULT 0, slotDuration INTEGER NOT NULL DEFAULT 30, hourlyEveningStart TEXT, hourlyEveningRate REAL NOT NULL DEFAULT 0, openTime TEXT DEFAULT '12:00', closeTime TEXT DEFAULT '22:00', minimumUsageMinutes INTEGER DEFAULT 60 );
    CREATE TABLE property_resource_prices ( propertyId INTEGER NOT NULL, resourceId INTEGER NOT NULL, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId) );
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY, propertyId INTEGER, startDate TEXT, endDate TEXT,
      checkInTime TEXT, checkOutTime TEXT, adults INTEGER, children INTEGER, teens INTEGER, babies INTEGER,
      babyBeds INTEGER DEFAULT 0, discountPercent REAL DEFAULT 0, customPrice REAL,
      platform TEXT DEFAULT 'direct', extraGuestSurchargeOffered INTEGER DEFAULT 0,
      touristTaxInComplement INTEGER DEFAULT 0, platformGrossAmount REAL,
      touristTaxRate REAL, touristTaxTotal REAL, touristTaxFrozenBaseHt REAL,
      touristTaxFrozenOccupants INTEGER, touristTaxFrozenAt TEXT,
      depositAmount REAL DEFAULT 0, balanceAmount REAL DEFAULT 0, complementAmount REAL DEFAULT 0,
      depositPaid INTEGER DEFAULT 0, balancePaid INTEGER DEFAULT 0, complementPaid INTEGER DEFAULT 0,
      finalPrice REAL DEFAULT 0
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
  db.prepare("INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)").run();
  // Bain nordique: 30 €/h, 50 €/h from 20:00, 1-hour slots.
  db.prepare("INSERT INTO resources (id, name, quantity, price, priceType, isComplex, showsPlanningCard, slotDuration, hourlyEveningStart, hourlyEveningRate) VALUES (14, 'Bain nordique', 1, 30, 'per_hour', 1, 1, 60, '20:00', 50)").run();
  db.prepare(`INSERT INTO reservations
    (id, propertyId, startDate, endDate, checkInTime, checkOutTime, adults, children, teens, babies, finalPrice)
    VALUES (1, 1, '2027-03-08', '2027-03-11', '16:00', '10:00', 2, 0, 0, 0, 360)`).run();
  return db;
}

const replay = (db) => calculateReservationQuote(
  buildReservationEngineInput(db, db.prepare('SELECT * FROM reservations WHERE id = 1').get()),
);

test('rule 5: a replayed bath keeps its sessions and the hours placed, at its sold amount', () => {
  const db = seedDb();
  db.prepare(`INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, sessions)
    VALUES (1, 14, 2, 30, 2, 'per_hour', 60, ?)`).run(JSON.stringify([
    { date: '2027-03-09', start: '17:00', end: '18:00' },
    { date: '2027-03-09', start: '20:00', end: '21:00' },
  ]));
  const line = replay(db).resourceLines.find((l) => Number(l.resourceId) === 14);
  assert.equal(line.scheduledHours, 2);
  assert.equal(line.sessions.length, 2);
  assert.equal(line.totalPrice, 60, 'the evening is the SAS supplement, never the replayed line');
  assert.equal(line.detail, undefined);
  db.close();
});

test('rule 5: a replayed bath with no session placed still reads « À planifier »', () => {
  const db = seedDb();
  db.prepare(`INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, sessions)
    VALUES (1, 14, 2, 30, 2, 'per_hour', 60, NULL)`).run();
  const line = replay(db).resourceLines.find((l) => Number(l.resourceId) === 14);
  assert.equal(line.scheduledHours, 0);
  assert.equal(line.detail, 'À planifier');
  assert.equal(line.totalPrice, 60);
  db.close();
});
