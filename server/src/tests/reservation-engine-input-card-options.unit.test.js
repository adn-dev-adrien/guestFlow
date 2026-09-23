// The stored moments ride with the engine input (specs/unscheduled-card-option.md rule 10).
//
// `buildReservationEngineInput` is « the one way to re-price a booking exactly as its fiche does » —
// the finance page, the per-bucket contribution capture and the Neat runner all replay through it.
// It never selected `cardOccurrences`, so every planning-card line vanished from those replays,
// scheduled or not. Measured on a copy of production before the fix: 635 € of option lines missing
// across 13 bookings, and a tourist-tax declaration 9,74 € above what the fiches themselves say —
// the taxable base grows as the services drop out of it.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildReservationEngineInput } = require('../utils/reservationEngineInput');
const { calculateReservationQuote } = require('../utils/pricing');

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
  db.prepare("INSERT INTO options (id, title, priceType, price, showsPlanningCard, autoOptionType) VALUES (6, 'Petit déjeuner', 'per_person_per_night', 8, 1, 'breakfast')").run();
  db.prepare("INSERT INTO property_options (propertyId, optionId) VALUES (1, 6)").run();
  db.prepare(`INSERT INTO reservations
    (id, propertyId, startDate, endDate, checkInTime, checkOutTime, adults, children, teens, babies, finalPrice)
    VALUES (1, 1, '2027-03-08', '2027-03-11', '16:00', '10:00', 2, 0, 0, 0, 348)`).run();
  return db;
}

const MORNINGS = JSON.stringify([
  { date: '2027-03-09', time: '09:00' },
  { date: '2027-03-10', time: '09:00' },
  { date: '2027-03-11', time: '09:00' },
]);

function addBreakfast(db, { cardOccurrences, quantity, billedUnits, cardPersons = null }) {
  db.prepare(`INSERT INTO reservation_options
    (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, cardOccurrences, cardPersons)
    VALUES (1, 6, ?, 8, ?, 'per_person_per_night', ?, ?, ?)`)
    .run(quantity, billedUnits, billedUnits * 8, cardOccurrences, cardPersons);
}

const replay = (db) => calculateReservationQuote(
  buildReservationEngineInput(db, db.prepare('SELECT * FROM reservations WHERE id = 1').get()),
);

test('a SCHEDULED card option survives the replay with its own amount', () => {
  const db = seedDb();
  addBreakfast(db, { cardOccurrences: MORNINGS, quantity: 3, billedUnits: 6 });
  const q = replay(db);
  const line = q.optionLines.find((l) => Number(l.optionId) === 6);
  assert.ok(line, 'this is the line that used to vanish from every replay');
  assert.deepEqual(line.cardOccurrences.map((o) => o.date), ['2027-03-09', '2027-03-10', '2027-03-11']);
  assert.equal(line.billedUnits, 6);
  assert.equal(line.totalPrice, 48);
  assert.equal(q.finalPrice, 348, 'the replay reproduces the stored total');
  db.close();
});

test('the taxable base of the replay is the fiche\'s, not one inflated by the missing service', () => {
  // Where production was actually bitten (« Suivi taxe de séjour », 9,74 € over-declared across 7
  // stays): a platform booking pins `finalPrice` on the gross the guest paid, so the accommodation
  // absorbs whatever the lines do not account for. A card option that falls out of the quote does
  // not lower the total — it enlarges the accommodation, and the tax is a share of it
  // (`percentage_accommodation`, L'Estiva's mode). On reservation 22226 the page declared 4,86 €
  // where the fiche says 1,56 €.
  const db = seedDb();
  db.prepare("UPDATE properties SET touristTaxMode = 'percentage_accommodation', touristTaxPercentage = 5 WHERE id = 1").run();
  db.prepare("UPDATE reservations SET platform = 'Abracadaroom', platformGrossAmount = 348 WHERE id = 1").run();
  addBreakfast(db, { cardOccurrences: MORNINGS, quantity: 3, billedUnits: 6 });
  const withLine = replay(db).touristTaxBaseHt;
  // What the declaration page replayed before the fix: the card line simply absent.
  db.prepare('DELETE FROM reservation_options WHERE reservationId = 1').run();
  const withoutLine = replay(db).touristTaxBaseHt;
  assert.ok(withoutLine > withLine,
    `losing the 48 € service inflated the taxable base (${withoutLine} € instead of ${withLine} €)`);
  db.close();
});

test('the served covers ride along too', () => {
  const db = seedDb();
  addBreakfast(db, { cardOccurrences: MORNINGS, quantity: 3, billedUnits: 3, cardPersons: 1 });
  const line = replay(db).optionLines.find((l) => Number(l.optionId) === 6);
  assert.equal(line.billedUnits, 3, '3 mornings × 1 cover — the party would have billed 6');
  assert.equal(line.cardPersons, 1);
  db.close();
});

test('an UNSCHEDULED card option replays on the portions it was sold at', () => {
  const db = seedDb();
  addBreakfast(db, { cardOccurrences: null, quantity: 6, billedUnits: 6 });
  const q = replay(db);
  const line = q.optionLines.find((l) => Number(l.optionId) === 6);
  assert.equal(line.toBeScheduled, true);
  assert.equal(line.totalPrice, 48);
  assert.equal(q.finalPrice, 348);
  db.close();
});

test('a schema without the two columns still builds an input', () => {
  // Minimal test schemas predate `cardOccurrences` / `cardPersons`; the SELECT must not fail on them.
  const db = seedDb();
  db.exec(`
    CREATE TABLE ro_min (reservationId INTEGER, optionId INTEGER, quantity REAL, unitPrice REAL,
      billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0,
      acompteContribTtc REAL, soldeContribTtc REAL);
    DROP TABLE reservation_options;
    ALTER TABLE ro_min RENAME TO reservation_options;
  `);
  db.prepare(`INSERT INTO reservation_options
    (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice)
    VALUES (1, 6, 6, 8, 6, 'per_person_per_night', 48)`).run();
  const input = buildReservationEngineInput(db, db.prepare('SELECT * FROM reservations WHERE id = 1').get());
  assert.equal(input.selectedOptions[0].cardOccurrences, undefined);
  assert.equal(calculateReservationQuote(input).finalPrice, 348);
  db.close();
});
