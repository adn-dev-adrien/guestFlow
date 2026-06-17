const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildModel } = require('../models/planningOptionCardsModel');

// specs/option-planning-card.md §3.3 + §4.1 — cardsInRange emits one card per stored occurrence
// whose date ∈ [from, to], for showsPlanningCard options on real reservations (devis excluded).

const DDL = `
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL DEFAULT 'reservation',
    propertyId INTEGER, clientId INTEGER,
    startDate TEXT, endDate TEXT, icalOriginalSummary TEXT,
    adults INTEGER DEFAULT 0, children INTEGER DEFAULT 0, teens INTEGER DEFAULT 0, babies INTEGER DEFAULT 0
  );
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT);
  CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
  CREATE TABLE options (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, showsPlanningCard INTEGER DEFAULT 0);
  CREATE TABLE reservation_options (
    reservationId INTEGER NOT NULL, optionId INTEGER NOT NULL,
    cardOccurrences TEXT, PRIMARY KEY (reservationId, optionId)
  );
`;

function freshDb() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Villa')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  db.prepare("INSERT INTO options (id, title, showsPlanningCard) VALUES (10, 'Repas', 1)").run();
  db.prepare("INSERT INTO options (id, title, showsPlanningCard) VALUES (11, 'Ménage', 0)").run();
  return db;
}

function addReservation(db, { id, kind = 'reservation', summary = null } = {}) {
  db.prepare("INSERT INTO reservations (id, kind, propertyId, clientId, startDate, endDate, icalOriginalSummary, adults, children, teens, babies) VALUES (?, ?, 1, 1, '2026-07-10', '2026-07-13', ?, 2, 1, 0, 0)")
    .run(id, kind, summary);
}
function addOption(db, reservationId, optionId, occurrences) {
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, cardOccurrences) VALUES (?, ?, ?)')
    .run(reservationId, optionId, occurrences == null ? null : JSON.stringify(occurrences));
}

test('emits one card per occurrence within the window, with client + property + title', () => {
  const db = freshDb();
  addReservation(db, { id: 1 });
  addOption(db, 1, 10, [
    { date: '2026-07-10', time: '12:00' },
    { date: '2026-07-11', time: '12:00' },
  ]);
  const cards = buildModel(db).cardsInRange({ from: '2026-07-09', to: '2026-07-15' });
  assert.equal(cards['2026-07-10'].items.length, 1);
  assert.equal(cards['2026-07-11'].items.length, 1);
  const item = cards['2026-07-10'].items[0];
  assert.equal(item.clientName, 'Jean Dupont');
  assert.equal(item.propertyName, 'Villa');
  assert.equal(item.title, 'Repas');
  assert.equal(item.time, '12:00');
  assert.equal(item.reservationId, 1);
  // Family composition for the arrival/departure-style card (Adrien 2026-06-17).
  assert.equal(item.adults, 2);
  assert.equal(item.children, 1);
  assert.equal(item.teens, 0);
  db.close();
});

test('occurrences outside the window are excluded', () => {
  const db = freshDb();
  addReservation(db, { id: 1 });
  addOption(db, 1, 10, [
    { date: '2026-07-05', time: '12:00' },
    { date: '2026-07-11', time: '12:00' },
    { date: '2026-07-20', time: '12:00' },
  ]);
  const cards = buildModel(db).cardsInRange({ from: '2026-07-10', to: '2026-07-13' });
  assert.deepEqual(Object.keys(cards), ['2026-07-11']);
  db.close();
});

test('non-card options and devis are excluded', () => {
  const db = freshDb();
  addReservation(db, { id: 1 });
  addReservation(db, { id: 2, kind: 'devis' });
  addOption(db, 1, 11, [{ date: '2026-07-11', time: '12:00' }]); // not a card option
  addOption(db, 2, 10, [{ date: '2026-07-11', time: '12:00' }]); // devis
  const cards = buildModel(db).cardsInRange({ from: '2026-07-09', to: '2026-07-15' });
  assert.deepEqual(cards, {});
  db.close();
});

test('falls back to the iCal summary then a placeholder for the client name', () => {
  const db = freshDb();
  db.prepare("INSERT INTO reservations (id, kind, propertyId, clientId, startDate, endDate, icalOriginalSummary) VALUES (3, 'reservation', 1, 999, '2026-07-10', '2026-07-13', 'Airbnb - John')").run();
  addOption(db, 3, 10, [{ date: '2026-07-11', time: '09:00' }]);
  const cards = buildModel(db).cardsInRange({ from: '2026-07-10', to: '2026-07-13' });
  assert.equal(cards['2026-07-11'].items[0].clientName, 'Airbnb - John');
  db.close();
});

test('same-day occurrences are sorted by time', () => {
  const db = freshDb();
  addReservation(db, { id: 1 });
  addOption(db, 1, 10, [
    { date: '2026-07-11', time: '19:30' },
    { date: '2026-07-11', time: '08:00' },
    { date: '2026-07-11', time: '12:30' },
  ]);
  const items = buildModel(db).cardsInRange({ from: '2026-07-10', to: '2026-07-13' })['2026-07-11'].items;
  assert.deepEqual(items.map((i) => i.time), ['08:00', '12:30', '19:30']);
  db.close();
});

test('null / empty cardOccurrences contribute nothing', () => {
  const db = freshDb();
  addReservation(db, { id: 1 });
  addOption(db, 1, 10, null);
  const cards = buildModel(db).cardsInRange({ from: '2026-07-09', to: '2026-07-15' });
  assert.deepEqual(cards, {});
  db.close();
});

test('setOccurrenceDone flips one occurrence; cardsInRange reflects the done flag', () => {
  const db = freshDb();
  addReservation(db, { id: 1 });
  addOption(db, 1, 10, [
    { date: '2026-07-11', time: '12:00' },
    { date: '2026-07-12', time: '12:00' },
  ]);
  const model = buildModel(db);
  const r = model.setOccurrenceDone({ reservationId: 1, optionId: 10, date: '2026-07-11', time: '12:00', done: true });
  assert.deepEqual(r, { ok: true, done: true });
  const cards = model.cardsInRange({ from: '2026-07-09', to: '2026-07-15' });
  assert.equal(cards['2026-07-11'].items[0].done, true);
  assert.equal(cards['2026-07-12'].items[0].done, false, 'only the matched occurrence flips');
  db.close();
});

test('setOccurrenceDone returns an error for an unknown occurrence', () => {
  const db = freshDb();
  addReservation(db, { id: 1 });
  addOption(db, 1, 10, [{ date: '2026-07-11', time: '12:00' }]);
  const model = buildModel(db);
  assert.equal(model.setOccurrenceDone({ reservationId: 1, optionId: 10, date: '2026-07-30', time: '12:00', done: true }).error, 'OCCURRENCE_NOT_FOUND');
  assert.equal(model.setOccurrenceDone({ reservationId: 999, optionId: 10, date: '2026-07-11', time: '12:00', done: true }).error, 'NOT_FOUND');
  db.close();
});
