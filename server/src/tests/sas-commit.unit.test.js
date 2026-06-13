// Arrival / departure SAS commit logic + priced linen items.
// See specs/arrival-departure-sas.md §4.1.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { create: createReservationsModel } = require('../models/reservationsModel');
const { buildModel: buildLinenItems } = require('../models/linenItemsModel');

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
      clientId INTEGER, propertyId INTEGER, startDate TEXT, endDate TEXT, platform TEXT DEFAULT 'direct',
      cautionAmount REAL DEFAULT 0, cautionReceived INTEGER DEFAULT 0, cautionReceivedDate TEXT,
      cautionReturned INTEGER DEFAULT 0, cautionReturnedDate TEXT,
      complementAmount REAL NOT NULL DEFAULT 0, complementPaid INTEGER NOT NULL DEFAULT 0,
      endOfStayComplementAmount REAL NOT NULL DEFAULT 0, endOfStayComplementPaid INTEGER NOT NULL DEFAULT 0,
      endOfStayComplementPaidDate TEXT, endOfStayComplementDetail TEXT,
      arrivalSasDoneAt TEXT, departureSasDoneAt TEXT,
      breakfastTime TEXT,
      breakfastCoffee INTEGER NOT NULL DEFAULT 0, breakfastTea INTEGER NOT NULL DEFAULT 0,
      breakfastChocolate INTEGER NOT NULL DEFAULT 0, breakfastNote TEXT, departureHandoverNote TEXT,
      updatedAt TEXT
    );
    CREATE TABLE reservation_custom_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, description TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0, sortOrder INTEGER NOT NULL DEFAULT 0,
      inComplement INTEGER NOT NULL DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL
    );
    CREATE TABLE options (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, autoOptionType TEXT, price REAL DEFAULT 0);
    CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE linen_priced_items (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, category TEXT NOT NULL DEFAULT 'bed', sortOrder INTEGER NOT NULL DEFAULT 0);
  `);
  db.prepare("INSERT INTO reservations (id, propertyId, complementAmount, complementPaid, cautionAmount) VALUES (1, 7, 30, 0, 300)").run();
  return db;
}

// ---- linen items model ----

test('linenItemsModel.replaceAll: drops empty labels, re-numbers per category, list ordered', () => {
  const db = makeDb();
  const m = buildLinenItems(db);
  const out = m.replaceAll([
    { label: 'Taie d\'oreiller', price: 5, category: 'bed' },
    { label: '', price: 9, category: 'bed' },             // dropped
    { label: 'Serviette de bain', price: 8, category: 'towel' },
    { label: 'Housse de couette', price: 15, category: 'bed' },
  ]);
  assert.equal(out.length, 3);
  const bed = out.filter((i) => i.category === 'bed').map((i) => i.label);
  assert.deepEqual(bed, ['Taie d\'oreiller', 'Housse de couette']);
  assert.equal(out.find((i) => i.category === 'towel').label, 'Serviette de bain');
});

// ---- cleaning price ----

test('getCleaningPriceForProperty: per-property override wins over base price', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  db.prepare("INSERT INTO options (id, title, autoOptionType, price) VALUES (50, 'Ménage', 'cleaning', 40)").run();
  assert.equal(model.getCleaningPriceForProperty(7), 40);
  db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price) VALUES (7, 50, 55)').run();
  assert.equal(model.getCleaningPriceForProperty(7), 55);
});

test('getCleaningPriceForProperty: null when no cleaning option exists', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  assert.equal(model.getCleaningPriceForProperty(7), null);
});

// ---- arrival commit ----

test('commitArrivalSas: caution marked received + items added inComplement + complement bumped', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const newComplement = model.commitArrivalSas(1, {
    cautionReceived: true,
    complementItems: [{ label: 'Taie d\'oreiller', amount: 5 }, { label: 'Ménage', amount: 40 }],
  });
  assert.equal(newComplement, 75); // 30 + 5 + 40
  const r = db.prepare('SELECT cautionReceived, cautionReceivedDate, complementAmount, arrivalSasDoneAt FROM reservations WHERE id = 1').get();
  assert.equal(r.cautionReceived, 1);
  assert.ok(r.cautionReceivedDate);
  assert.equal(r.complementAmount, 75);
  assert.ok(r.arrivalSasDoneAt, 'arrival SAS marked done');
  const customs = db.prepare("SELECT description, amount, inComplement, offered FROM reservation_custom_options WHERE reservationId = 1 ORDER BY sortOrder").all();
  assert.equal(customs.length, 2);
  assert.ok(customs.every((c) => c.inComplement === 1 && c.offered === 0));
});

test('commitArrivalSas: a paid complement stays frozen, items still recorded', () => {
  const db = makeDb();
  db.prepare('UPDATE reservations SET complementPaid = 1, complementAmount = 30 WHERE id = 1').run();
  const model = createReservationsModel(db);
  const newComplement = model.commitArrivalSas(1, { complementItems: [{ label: 'Drap-housse', amount: 12 }] });
  assert.equal(newComplement, 30); // frozen
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_custom_options WHERE reservationId = 1').get().n, 1);
});

test('commitArrivalSas: ignores zero/blank items', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const c = model.commitArrivalSas(1, { complementItems: [{ label: 'x', amount: 0 }, { label: '', amount: 9 }] });
  assert.equal(c, 30);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_custom_options WHERE reservationId = 1').get().n, 0);
});

test('commitArrivalSas: writes breakfast composition (clamped) + breakfastTime + handover note', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, {
    breakfastTime: '9:05',         // normalised to 09:05
    breakfastCoffee: 2.7,          // → 3 (round, non-negative)
    breakfastTea: -1,              // → 0 (clamp)
    breakfastChocolate: 1,
    breakfastNote: '  sans lactose  ',
    departureHandoverNote: '  clé sous le pot  ',
  });
  const r = db.prepare('SELECT breakfastTime, breakfastCoffee, breakfastTea, breakfastChocolate, breakfastNote, departureHandoverNote FROM reservations WHERE id = 1').get();
  assert.equal(r.breakfastTime, '09:05');
  assert.equal(r.breakfastCoffee, 3);
  assert.equal(r.breakfastTea, 0);
  assert.equal(r.breakfastChocolate, 1);
  assert.equal(r.breakfastNote, 'sans lactose');
  assert.equal(r.departureHandoverNote, 'clé sous le pot');
});

test('commitArrivalSas: omitted breakfast fields default to 0 / null, breakfastTime untouched', () => {
  const db = makeDb();
  db.prepare("UPDATE reservations SET breakfastTime = '08:30' WHERE id = 1").run();
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, { cautionReceived: true });
  const r = db.prepare('SELECT breakfastTime, breakfastCoffee, breakfastNote, departureHandoverNote FROM reservations WHERE id = 1').get();
  assert.equal(r.breakfastTime, '08:30');   // not passed → left as-is
  assert.equal(r.breakfastCoffee, 0);
  assert.equal(r.breakfastNote, null);
  assert.equal(r.departureHandoverNote, null);
});

// ---- departure commit ----

test('commitDepartureSas: caution returned + end-of-stay complement + detail set', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitDepartureSas(1, {
    cautionReturned: true,
    endOfStayComplementAmount: 48,
    endOfStayComplementDetail: [{ label: 'Ménage', amount: 40 }, { label: 'Serviette', amount: 8 }],
  });
  const r = db.prepare('SELECT cautionReturned, cautionReturnedDate, endOfStayComplementAmount, endOfStayComplementDetail, departureSasDoneAt FROM reservations WHERE id = 1').get();
  assert.equal(r.cautionReturned, 1);
  assert.ok(r.departureSasDoneAt, 'departure SAS marked done');
  assert.ok(r.cautionReturnedDate);
  assert.equal(r.endOfStayComplementAmount, 48);
  assert.deepEqual(JSON.parse(r.endOfStayComplementDetail).map((d) => d.label), ['Ménage', 'Serviette']);
});

test('commitDepartureSas: « litige » (cautionReturned false) leaves the caution untouched', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitDepartureSas(1, { cautionReturned: false, endOfStayComplementAmount: 0 });
  assert.equal(db.prepare('SELECT cautionReturned FROM reservations WHERE id = 1').get().cautionReturned, 0);
});
