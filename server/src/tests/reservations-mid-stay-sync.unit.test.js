// Base de référence + synchronisation du complément de fin de séjour (couche modèle).
// See specs/mid-stay-extras-to-end-of-stay-complement.md §3.1 rules 3-4 + §3.4 rule 11 + §3.5.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { create: createReservationsModel } = require('../models/reservationsModel');
const { MID_STAY_SOURCE } = require('../utils/midStayExtras');

const TODAY = '2026-07-11';

function makeDb({ startDate = '2026-07-10' } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
      clientId INTEGER, propertyId INTEGER, startDate TEXT, endDate TEXT, platform TEXT DEFAULT 'direct',
      adults INTEGER NOT NULL DEFAULT 0, teens INTEGER NOT NULL DEFAULT 0, children INTEGER NOT NULL DEFAULT 0, babies INTEGER NOT NULL DEFAULT 0,
      cautionAmount REAL DEFAULT 0, cautionReceived INTEGER DEFAULT 0, cautionReceivedDate TEXT,
      cautionReturned INTEGER DEFAULT 0, cautionReturnedDate TEXT,
      complementAmount REAL NOT NULL DEFAULT 0, complementPaid INTEGER NOT NULL DEFAULT 0,
      complementPaidDate TEXT, complementPaidCash INTEGER NOT NULL DEFAULT 0,
      complementDeferredToCheckout INTEGER NOT NULL DEFAULT 0,
      endOfStayComplementAmount REAL NOT NULL DEFAULT 0, endOfStayComplementPaid INTEGER NOT NULL DEFAULT 0,
      endOfStayComplementPaidDate TEXT, endOfStayComplementPaidCash INTEGER NOT NULL DEFAULT 0, endOfStayComplementDetail TEXT,
      arrivalExtrasBaseline TEXT DEFAULT NULL,
      arrivalSasDoneAt TEXT, departureSasDoneAt TEXT,
      checkInReady INTEGER DEFAULT 0, checkInDone INTEGER DEFAULT 0, checkOutDone INTEGER DEFAULT 0,
      extinguisherSealOkAtArrival INTEGER, extinguisherSealOkAtDeparture INTEGER,
      breakfastTime TEXT,
      breakfastCoffee INTEGER NOT NULL DEFAULT 0, breakfastTea INTEGER NOT NULL DEFAULT 0,
      breakfastChocolate INTEGER NOT NULL DEFAULT 0, breakfastMilk INTEGER NOT NULL DEFAULT 0,
      breakfastPastries INTEGER NOT NULL DEFAULT 0, breakfastCereals INTEGER NOT NULL DEFAULT 0,
      breakfastBread REAL NOT NULL DEFAULT 0, breakfastNotifiedDate TEXT,
      breakfastNote TEXT, departureHandoverNote TEXT,
      updatedAt TEXT
    );
    CREATE TABLE reservation_custom_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, description TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0, sortOrder INTEGER NOT NULL DEFAULT 0,
      inComplement INTEGER NOT NULL DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL,
      sasArrivalOrigin INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE options (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, autoOptionType TEXT, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay');
    CREATE TABLE reservation_options (
      reservationId INTEGER NOT NULL, optionId INTEGER NOT NULL,
      quantity REAL DEFAULT 1, unitPrice REAL NOT NULL DEFAULT 0, billedUnits REAL NOT NULL DEFAULT 0,
      priceType TEXT NOT NULL DEFAULT 'per_stay', totalPrice REAL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0,
      inComplement INTEGER NOT NULL DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL,
      sasArrivalOrigin INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (reservationId, optionId)
    );
    CREATE TABLE reservation_resources (
      reservationId INTEGER NOT NULL, resourceId INTEGER NOT NULL, quantity INTEGER NOT NULL DEFAULT 1,
      unitPrice REAL NOT NULL DEFAULT 0, billedUnits REAL NOT NULL DEFAULT 0, priceType TEXT NOT NULL DEFAULT 'per_stay',
      totalPrice REAL NOT NULL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0, inComplement INTEGER NOT NULL DEFAULT 0,
      acompteContribTtc REAL, soldeContribTtc REAL, PRIMARY KEY (reservationId, resourceId)
    );
    CREATE TABLE reservation_nights (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, date TEXT);
    CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE linen_priced_items (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, category TEXT NOT NULL DEFAULT 'bed', sortOrder INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE repair_amounts (id INTEGER PRIMARY KEY AUTOINCREMENT, repairKey TEXT, label TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, sortOrder INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, defaultCautionAmount REAL DEFAULT 0);
  `);
  db.prepare('INSERT INTO properties (id, defaultCautionAmount) VALUES (7, 500)').run();
  db.prepare("INSERT INTO reservations (id, propertyId, startDate, endDate, adults, complementAmount) VALUES (1, 7, ?, '2026-07-15', 2, 30)")
    .run(startDate);
  db.prepare("INSERT INTO options (id, title, price) VALUES (9, 'Petit-déjeuner', 12)").run();
  db.prepare("INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, totalPrice) VALUES (1, 9, 1, 12, 1, 12)").run();
  return db;
}

const baselineOf = (db) => db.prepare('SELECT arrivalExtrasBaseline FROM reservations WHERE id = 1').get().arrivalExtrasBaseline;
const eosOf = (db) => db.prepare('SELECT endOfStayComplementAmount AS amount, endOfStayComplementDetail AS detail FROM reservations WHERE id = 1').get();

test('readExtraLines: options + ressources + lignes personnalisées, une offerte vaut 0', () => {
  const db = makeDb();
  db.prepare("INSERT INTO reservation_resources (reservationId, resourceId, totalPrice) VALUES (1, 3, 30)").run();
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, offered) VALUES (1, 'Ménage', 60, 0)").run();
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, offered) VALUES (1, 'Cadeau', 20, 1)").run();
  const lines = createReservationsModel(db).readExtraLines(1);
  assert.deepEqual(lines.map((l) => l.totalPrice), [12, 30, 60, 0]);
});

test('capture — séjour non commencé → aucune base (comportement inchangé)', () => {
  const db = makeDb({ startDate: '2026-08-01' });
  assert.equal(createReservationsModel(db).captureArrivalExtrasBaselineIfDue(1, TODAY), null);
  assert.equal(baselineOf(db), null);
});

test('capture — séjour commencé → la base fige les extras du moment', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.captureArrivalExtrasBaselineIfDue(1, TODAY);
  assert.deepEqual(JSON.parse(baselineOf(db)), { 'opt:9': 12 });
});

test('capture — idempotente : une base existante n\'est jamais réécrite', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.captureArrivalExtrasBaselineIfDue(1, TODAY);
  // Le client prend un 2e petit-déjeuner : la base ne doit PAS l'avaler.
  db.prepare('UPDATE reservation_options SET quantity = 2, totalPrice = 24 WHERE reservationId = 1').run();
  model.captureArrivalExtrasBaselineIfDue(1, TODAY);
  assert.deepEqual(JSON.parse(baselineOf(db)), { 'opt:9': 12 });
});

test('sync — les lignes vendues en cours de séjour alimentent le complément de fin de séjour', () => {
  const db = makeDb();
  createReservationsModel(db).syncMidStayComplement(1, [
    { label: 'Petit-déjeuner', qty: 1, unitPrice: 12, amount: 12, source: MID_STAY_SOURCE, key: 'opt:9' },
  ]);
  const eos = eosOf(db);
  assert.equal(eos.amount, 12);
  assert.deepEqual(JSON.parse(eos.detail).map((l) => l.label), ['Petit-déjeuner']);
});

test('sync — les lignes du SAS de départ sont préservées et le total recalculé', () => {
  const db = makeDb();
  db.prepare("UPDATE reservations SET endOfStayComplementAmount = 60, endOfStayComplementDetail = ? WHERE id = 1")
    .run(JSON.stringify([{ label: 'Ménage de fin de séjour', amount: 60 }]));
  const model = createReservationsModel(db);
  model.syncMidStayComplement(1, [{ label: 'Petit-déjeuner', amount: 12, qty: 1, unitPrice: 12, source: MID_STAY_SOURCE, key: 'opt:9' }]);
  assert.equal(eosOf(db).amount, 72);

  // La prestation est retirée de la fiche → elle disparaît, le ménage reste.
  model.syncMidStayComplement(1, []);
  const eos = eosOf(db);
  assert.equal(eos.amount, 60);
  assert.deepEqual(JSON.parse(eos.detail).map((l) => l.label), ['Ménage de fin de séjour']);
});

test('sync — gelé dès que le complément de fin de séjour est encaissé (§3.5)', () => {
  for (const settled of ['endOfStayComplementPaid', 'endOfStayComplementPaidCash']) {
    const db = makeDb();
    db.prepare(`UPDATE reservations SET endOfStayComplementAmount = 12, ${settled} = 1, endOfStayComplementDetail = ? WHERE id = 1`)
      .run(JSON.stringify([{ label: 'Petit-déjeuner', amount: 12, source: MID_STAY_SOURCE, key: 'opt:9' }]));
    createReservationsModel(db).syncMidStayComplement(1, [
      { label: 'Petit-déjeuner', amount: 24, qty: 2, unitPrice: 12, source: MID_STAY_SOURCE, key: 'opt:9' },
    ]);
    assert.equal(eosOf(db).amount, 12, `${settled}: un montant encaissé n'est jamais re-tarifé`);
  }
});

test('SAS d\'arrivée — ses propres lignes rejoignent la base (jamais du « vendu en cours de séjour »)', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.captureArrivalExtrasBaselineIfDue(1, TODAY); // base capturée AVANT le SAS
  model.commitArrivalSas(1, { complementItems: [{ label: 'Taie d\'oreiller', amount: 5 }] });
  assert.deepEqual(JSON.parse(baselineOf(db)), { 'opt:9': 12, 'custom:taie d\'oreiller': 5 });
  assert.equal(db.prepare('SELECT complementAmount FROM reservations WHERE id = 1').get().complementAmount, 35);
});

test('SAS d\'arrivée re-commité — la base suit le nouveau montant, sans avaler les ventes du séjour', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.captureArrivalExtrasBaselineIfDue(1, TODAY);
  model.commitArrivalSas(1, { complementItems: [{ label: 'Taie d\'oreiller', amount: 5 }] });
  // Le client prend un 2e petit-déjeuner pendant le séjour…
  db.prepare('UPDATE reservation_options SET quantity = 2, totalPrice = 24 WHERE reservationId = 1').run();
  // …puis l'opérateur ré-ouvre le SAS d'arrivée pour corriger le linge.
  model.commitArrivalSas(1, { complementItems: [{ label: 'Taie d\'oreiller', amount: 5 }, { label: 'Drap', amount: 9 }] });
  assert.deepEqual(
    JSON.parse(baselineOf(db)),
    { 'opt:9': 12, 'custom:taie d\'oreiller': 5, 'custom:drap': 9 },
    'le petit-déjeuner vendu pendant le séjour reste hors base',
  );
});

test('base absente (résa antérieure à la spec) — le SAS ne crée pas de base', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, { complementItems: [{ label: 'Taie d\'oreiller', amount: 5 }] });
  assert.equal(baselineOf(db), null, 'la capture reste paresseuse : à la prochaine sauvegarde de fiche');
});
