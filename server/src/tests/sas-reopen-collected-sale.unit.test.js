// specs/arrival-departure-sas.md rule 34 (2026-11-12, verification of the manual trial of 4.0.0) — reopening a check-in whose
// complement it collected and walking through with the same answers must not bill the sale a second time: only what a sale
// bills BEYOND what the collected complement holds for its key rides the end-of-stay complement.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { create: createReservationsModel } = require('../models/reservationsModel');

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
      propertyId INTEGER, startDate TEXT, endDate TEXT, checkInTime TEXT, checkOutTime TEXT,
      adults INTEGER NOT NULL DEFAULT 0, teens INTEGER NOT NULL DEFAULT 0, children INTEGER NOT NULL DEFAULT 0, babies INTEGER NOT NULL DEFAULT 0,
      cautionAmount REAL DEFAULT 0, cautionReceived INTEGER DEFAULT 0, cautionWaived INTEGER NOT NULL DEFAULT 0, cautionReceivedDate TEXT,
      complementAmount REAL NOT NULL DEFAULT 0, complementPaid INTEGER NOT NULL DEFAULT 0,
      complementPaidDate TEXT, complementPaidCash INTEGER NOT NULL DEFAULT 0,
      complementDeferredToCheckout INTEGER NOT NULL DEFAULT 0,
      endOfStayComplementAmount REAL NOT NULL DEFAULT 0, endOfStayComplementPaid INTEGER NOT NULL DEFAULT 0,
      endOfStayComplementPaidCash INTEGER NOT NULL DEFAULT 0, endOfStayComplementDetail TEXT,
      arrivalExtrasBaseline TEXT, midStaySettledNotes TEXT,
      arrivalSasDoneAt TEXT, checkInReady INTEGER DEFAULT 0, checkInDone INTEGER DEFAULT 0,
      extinguisherSealOkAtArrival INTEGER, breakfastTime TEXT,
      breakfastCoffee INTEGER NOT NULL DEFAULT 0, breakfastTea INTEGER NOT NULL DEFAULT 0,
      breakfastChocolate INTEGER NOT NULL DEFAULT 0, breakfastMilk INTEGER NOT NULL DEFAULT 0,
      breakfastPastries INTEGER NOT NULL DEFAULT 0, breakfastCereals INTEGER NOT NULL DEFAULT 0,
      breakfastBread REAL NOT NULL DEFAULT 0, breakfastNote TEXT, departureHandoverNote TEXT,
      updatedAt TEXT
    );
    CREATE TABLE options (
      id INTEGER PRIMARY KEY, title TEXT, description TEXT DEFAULT '', autoOptionType TEXT,
      price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', category TEXT DEFAULT '',
      showsPlanningCard INTEGER NOT NULL DEFAULT 0, cardRepeat TEXT DEFAULT 'once',
      planningCardTimes TEXT, displayToClient INTEGER NOT NULL DEFAULT 1, autoEnabled INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE reservation_options (
      reservationId INTEGER NOT NULL, optionId INTEGER NOT NULL,
      quantity REAL DEFAULT 1, unitPrice REAL NOT NULL DEFAULT 0, billedUnits REAL NOT NULL DEFAULT 0,
      priceType TEXT NOT NULL DEFAULT 'per_stay', totalPrice REAL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0,
      inComplement INTEGER NOT NULL DEFAULT 0, sasArrivalOrigin INTEGER NOT NULL DEFAULT 0, cardOccurrences TEXT,
      cardPersons REAL,
      PRIMARY KEY (reservationId, optionId)
    );
    CREATE TABLE reservation_custom_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, description TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0, sortOrder INTEGER NOT NULL DEFAULT 0,
      inComplement INTEGER NOT NULL DEFAULT 0, sasArrivalOrigin INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE reservation_resources (reservationId INTEGER, resourceId INTEGER, totalPrice REAL DEFAULT 0, offered INTEGER DEFAULT 0);
    CREATE TABLE reservation_nights (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, date TEXT);
    CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, defaultCautionAmount REAL DEFAULT 0, maxGuests INTEGER DEFAULT 0);
  `);
  db.prepare('INSERT INTO properties (id, defaultCautionAmount, maxGuests) VALUES (7, 500, 6)').run();
  // date-literal-ok: stay days of the fixture, nothing compares them with today
  const STAY_DAYS = ['2026-08-18', '2026-08-21'];
  db.prepare(`INSERT INTO reservations (id, propertyId, startDate, endDate, checkInTime, checkOutTime, adults, teens, babies, complementAmount)
              VALUES (1, 7, ?, ?, '15:00', '10:00', 2, 1, 1, 30)`).run(...STAY_DAYS);
  // date-literal-ok: stay days of the fixture, nothing compares them with today
  for (const date of ['2026-08-18', '2026-08-19', '2026-08-20']) {
    db.prepare('INSERT INTO reservation_nights (reservationId, date) VALUES (1, ?)').run(date);
  }
  const insertOption = db.prepare(`INSERT INTO options (id, title, description, autoOptionType, price, priceType, category, showsPlanningCard, cardRepeat, planningCardTimes)
                                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  insertOption.run(6, 'Petit déjeuner', '', 'breakfast', 8, 'per_person_per_night', 'Restauration', 1, 'once_per_day', '["09:00"]');
  insertOption.run(16, 'Le repas des trappeurs', 'Repas', null, 25, 'per_person_per_night', 'Restauration', 1, 'multiple_per_day', '["12:00","19:30"]');
  insertOption.run(27, 'Planche S', 'Apéro', null, 17, 'per_stay', 'Restauration', 0, 'once', '[]');
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (7, 6), (7, 16), (7, 27)').run();
  return db;
}


// date-literal-ok: stay days of the fixture, nothing compares them with today
const MORNINGS = (n) => ['2026-08-19', '2026-08-20', '2026-08-21'].slice(0, n).map((date) => ({ date, time: '09:00' }));
const sale = (n) => ({ soldOptions: [{ optionId: 6, occurrences: MORNINGS(n) }] });
const eos = (db) => db.prepare('SELECT endOfStayComplementAmount AS a, endOfStayComplementDetail AS d, complementAmount AS c, arrivalExtrasBaseline AS b FROM reservations WHERE id = 1').get();

// The check-in sells 2 mornings (48 €) while its complement is open, then collects it (complement 78 €).
function collectedSale() {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, sale(2));
  db.prepare('UPDATE reservations SET complementPaid = 1 WHERE id = 1').run();
  return { db, model };
}

test('the same sale sent again on a reopened check-in bills nothing more, and the recap announces no supplement', () => {
  const { db, model } = collectedSale();
  assert.equal(model.planArrivalSas(1, sale(2), { withExistingLines: false }).supplementOutsideComplement, 0);
  model.commitArrivalSas(1, sale(2));
  const r = eos(db);
  assert.equal(r.a, 0);
  assert.equal(r.c, 78, 'the collected complement is untouched');
  assert.ok(JSON.parse(r.b)['opt:6'] !== undefined, 'a covered key stays in the arrival baseline');
});

test('a quantity raised on the re-run bills only the difference', () => {
  const { db, model } = collectedSale();
  assert.equal(model.planArrivalSas(1, sale(3), { withExistingLines: false }).supplementOutsideComplement, 24);
  model.commitArrivalSas(1, sale(3));
  assert.equal(eos(db).a, 24);
  model.commitArrivalSas(1, sale(3));
  assert.equal(eos(db).a, 24, 'a third pass with the same answers moves nothing');
});

test('a quantity lowered on the re-run writes nothing negative: the collected money stays collected', () => {
  const { db, model } = collectedSale();
  model.commitArrivalSas(1, sale(1));
  const r = eos(db);
  assert.equal(r.a, 0);
  assert.equal(r.c, 78);
  assert.equal(model.planArrivalSas(1, sale(1), { withExistingLines: false }).supplementOutsideComplement, 0);
});

test('a new key on the re-run is billed in full, beside the covered one', () => {
  const { db, model } = collectedSale();
  const both = { soldOptions: [{ optionId: 6, occurrences: MORNINGS(2) }, { optionId: 27, units: 1 }] };
  model.commitArrivalSas(1, both);
  const r = eos(db);
  assert.equal(r.a, 17);
  assert.deepEqual(JSON.parse(r.d).map((l) => l.label), ['Planche S']);
});
