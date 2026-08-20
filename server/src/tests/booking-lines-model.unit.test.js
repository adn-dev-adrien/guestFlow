/**
 * specs/devis-extras-parity-and-price-lock.md §4.1 — the single writer of a booking's line graph.
 *
 * `reservationsModel` and `devisModel` both go through this store, which is what stops a new line
 * column from landing on one side and being forgotten on the other. Two things are pinned here: it
 * writes every column when the schema has them, and it degrades (rather than throws) when it doesn't —
 * the minimal schemas the older unit tests build must keep working.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const bookingLinesModel = require('../models/bookingLinesModel');

const FULL_DDL = `
  CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, displayToClient INTEGER DEFAULT 1,
    countsAsBedLinen INTEGER DEFAULT 0, countsAsBathroomLinen INTEGER DEFAULT 0, countsAsBathMat INTEGER DEFAULT 0);
  CREATE TABLE reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, tariffSnapshot TEXT);
  CREATE TABLE reservation_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, optionId INTEGER, quantity REAL, unitPrice REAL,
    billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER DEFAULT 0,
    inComplement INTEGER DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL,
    cardOccurrences TEXT, cardPersons REAL, sasArrivalOrigin INTEGER DEFAULT 0
  );
  CREATE TABLE reservation_custom_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, description TEXT, amount REAL,
    offered INTEGER DEFAULT 0, sortOrder INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0,
    acompteContribTtc REAL, soldeContribTtc REAL
  );
  CREATE TABLE reservation_resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, resourceId INTEGER, quantity REAL, unitPrice REAL,
    billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER DEFAULT 0,
    inComplement INTEGER DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL, sessions TEXT
  );
  CREATE TABLE reservation_nights (reservationId INTEGER, date TEXT, seasonLabel TEXT, pricingMode TEXT, price REAL);
`;

// What the pre-fusion unit tests build: no routing, no occurrences, no sessions.
const MINIMAL_DDL = `
  CREATE TABLE reservations (id INTEGER PRIMARY KEY AUTOINCREMENT);
  CREATE TABLE reservation_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, optionId INTEGER, quantity REAL, unitPrice REAL, billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER DEFAULT 0);
  CREATE TABLE reservation_custom_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, description TEXT, amount REAL, offered INTEGER DEFAULT 0, sortOrder INTEGER DEFAULT 0);
  CREATE TABLE reservation_resources (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, resourceId INTEGER, quantity REAL, unitPrice REAL, billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER DEFAULT 0);
  CREATE TABLE reservation_nights (reservationId INTEGER, date TEXT, seasonLabel TEXT, pricingMode TEXT, price REAL);
`;

const OCCURRENCES = [{ date: '2027-03-09', time: '08:30', checked: true }];
const SESSIONS = [{ date: '2027-03-09', start: '18:00', end: '20:00' }];

const OPTION_LINES = [
  {
    optionId: 6, quantity: 3, unitPrice: 8, billedUnits: 6, priceType: 'per_person_per_night',
    totalPrice: 48, offered: false, cardOccurrences: OCCURRENCES, inComplement: 0,
  },
  { isCustom: true, title: 'Panier gourmand', originalTotalPrice: 25, offered: false, inComplement: 1 },
];
const RESOURCE_LINES = [
  { resourceId: 2, quantity: 1, unitPrice: 30, billedUnits: 2, priceType: 'per_hour', totalPrice: 60, sessions: SESSIONS },
];
const NIGHTS = [{ date: '2027-03-08', seasonLabel: 'Standard', pricingMode: 'fixed', price: 100 }];

function fresh(ddl) {
  const db = new Database(':memory:');
  db.exec(ddl);
  db.prepare('INSERT INTO reservations DEFAULT VALUES').run();
  db.prepare('INSERT INTO reservations DEFAULT VALUES').run();
  return { db, store: bookingLinesModel.buildModel(db) };
}

test('writes every line column when the schema has them', () => {
  const { db, store } = fresh(FULL_DDL);
  store.replaceOptions(1, OPTION_LINES);
  store.replaceCustomOptions(1, OPTION_LINES);
  store.replaceResources(1, RESOURCE_LINES);
  store.replaceNights(1, NIGHTS);

  const option = db.prepare('SELECT * FROM reservation_options WHERE reservationId = 1').get();
  assert.equal(option.totalPrice, 48);
  assert.deepEqual(JSON.parse(option.cardOccurrences), OCCURRENCES);

  const custom = db.prepare('SELECT * FROM reservation_custom_options WHERE reservationId = 1').get();
  assert.equal(custom.description, 'Panier gourmand');
  assert.equal(custom.amount, 25);
  assert.equal(custom.inComplement, 1);

  const resource = db.prepare('SELECT * FROM reservation_resources WHERE reservationId = 1').get();
  assert.equal(resource.totalPrice, 60);
  assert.deepEqual(JSON.parse(resource.sessions), SESSIONS);

  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservation_nights WHERE reservationId = 1').get().c, 1);
});

test('degrades on a minimal schema instead of throwing', () => {
  const { db, store } = fresh(MINIMAL_DDL);
  store.replaceOptions(1, OPTION_LINES);
  store.replaceCustomOptions(1, OPTION_LINES);
  store.replaceResources(1, RESOURCE_LINES);

  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservation_options WHERE reservationId = 1').get().c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservation_resources WHERE reservationId = 1').get().c, 1);
  // …and the snapshot still answers, reading the absent routing as « not in Complément ».
  const snapshot = store.getPricingSnapshot(1);
  assert.equal(snapshot.lockedOptionLines[0].inComplement, 0);
  assert.equal(snapshot.lockedResourceLines[0].acompteContribTtc, null);
});

test('a line in Complément never carries acompte/solde contributions', () => {
  const { db, store } = fresh(FULL_DDL);
  store.replaceOptions(1, [{ optionId: 6, quantity: 1, totalPrice: 10, inComplement: 1, acompteContribTtc: 4, soldeContribTtc: 6 }]);

  const option = db.prepare('SELECT * FROM reservation_options WHERE reservationId = 1').get();
  assert.equal(option.inComplement, 1);
  assert.equal(option.acompteContribTtc, null);
  assert.equal(option.soldeContribTtc, null);
});

test('replaceOptions carries the SAS-origin marker across a re-save', () => {
  const { db, store } = fresh(FULL_DDL);
  store.replaceOptions(1, [{ optionId: 6, quantity: 1, totalPrice: 10 }]);
  db.prepare('UPDATE reservation_options SET sasArrivalOrigin = 1 WHERE reservationId = 1').run();

  store.replaceOptions(1, [{ optionId: 6, quantity: 2, totalPrice: 20 }]);

  const option = db.prepare('SELECT * FROM reservation_options WHERE reservationId = 1').get();
  assert.equal(option.totalPrice, 20);
  assert.equal(option.sasArrivalOrigin, 1);
});

test('an internal linen option is never materialised as a line', () => {
  const { db, store } = fresh(FULL_DDL);
  db.prepare("INSERT INTO options (id, title, displayToClient, countsAsBathMat) VALUES (9, 'Tapis de bain', 0, 1)").run();

  store.replaceOptions(1, [{ optionId: 9, quantity: 1, totalPrice: 5 }, { optionId: 6, quantity: 1, totalPrice: 10 }]);

  const ids = db.prepare('SELECT optionId FROM reservation_options WHERE reservationId = 1').all().map((r) => r.optionId);
  assert.deepEqual(ids, [6]);
});

test('copyLineGraph copies the whole graph, occurrences and sessions included', () => {
  const { db, store } = fresh(FULL_DDL);
  store.replaceOptions(1, OPTION_LINES);
  store.replaceCustomOptions(1, OPTION_LINES);
  store.replaceResources(1, RESOURCE_LINES);
  store.replaceNights(1, NIGHTS);

  store.copyLineGraph(1, 2);

  const option = db.prepare('SELECT * FROM reservation_options WHERE reservationId = 2').get();
  assert.equal(option.totalPrice, 48);
  assert.deepEqual(JSON.parse(option.cardOccurrences), OCCURRENCES);
  const custom = db.prepare('SELECT * FROM reservation_custom_options WHERE reservationId = 2').get();
  assert.equal(custom.amount, 25);
  assert.equal(custom.inComplement, 1);
  const resource = db.prepare('SELECT * FROM reservation_resources WHERE reservationId = 2').get();
  assert.deepEqual(JSON.parse(resource.sessions), SESSIONS);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservation_nights WHERE reservationId = 2').get().c, 1);
});

test('getPricingSnapshot returns the engine-shaped locked lines', () => {
  const { db, store } = fresh(FULL_DDL);
  store.replaceOptions(1, OPTION_LINES);
  store.replaceResources(1, RESOURCE_LINES);
  store.replaceNights(1, NIGHTS);
  db.prepare(`UPDATE reservations SET tariffSnapshot = '{"recipeId":"lodge-2026"}' WHERE id = 1`).run();

  const snapshot = store.getPricingSnapshot(1);
  assert.equal(snapshot.lockedOptionLines[0].unitPrice, 8);
  assert.equal(snapshot.lockedResourceLines[0].unitPrice, 30);
  assert.equal(snapshot.lockedNightlyBreakdown[0].price, 100);
  assert.deepEqual(snapshot.lockedTariff, { recipeId: 'lodge-2026' });
});

// specs/card-option-served-persons.md §5 — the served count of a card option is money: a writer that
// forgets it silently re-bills the whole party at the next save.

test('cardPersons is written and survives a re-save of the fiche', () => {
  const { db, store } = fresh(FULL_DDL);
  store.replaceOptions(1, [{ ...OPTION_LINES[0], cardPersons: 2, billedUnits: 2, totalPrice: 16 }]);
  assert.equal(db.prepare('SELECT cardPersons FROM reservation_options WHERE reservationId = 1').get().cardPersons, 2);

  // A fiche save is a DELETE + INSERT: the engine echoes the count back on the line it re-prices.
  store.replaceOptions(1, [{ ...OPTION_LINES[0], cardPersons: 2, billedUnits: 2, totalPrice: 16 }]);
  assert.equal(db.prepare('SELECT cardPersons FROM reservation_options WHERE reservationId = 1').get().cardPersons, 2);
});

test('a line that follows the party stores cardPersons = NULL', () => {
  const { db, store } = fresh(FULL_DDL);
  store.replaceOptions(1, OPTION_LINES);
  assert.equal(db.prepare('SELECT cardPersons FROM reservation_options WHERE reservationId = 1').get().cardPersons, null);
});

test('copyLineGraph carries cardPersons (devis → réservation)', () => {
  const { db, store } = fresh(FULL_DDL);
  store.replaceOptions(1, [{ ...OPTION_LINES[0], cardPersons: 3 }]);
  store.copyLineGraph(1, 2);
  assert.equal(db.prepare('SELECT cardPersons FROM reservation_options WHERE reservationId = 2').get().cardPersons, 3);
});

test('cardPersons degrades on a minimal schema instead of throwing', () => {
  const { db, store } = fresh(MINIMAL_DDL);
  store.replaceOptions(1, [{ ...OPTION_LINES[0], cardPersons: 2 }]);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservation_options WHERE reservationId = 1').get().c, 1);
});
