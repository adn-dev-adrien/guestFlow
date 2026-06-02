const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const laundryModel = require('../models/laundryModel');

// In-memory DB tests for the bed-linen aggregation (specs/weekly-bed-linen-tracking.md §3.1–3.3).

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL DEFAULT 'reservation',
      startDate TEXT NOT NULL,
      endDate TEXT NOT NULL,
      singleBeds INTEGER,
      doubleBeds INTEGER,
      babyBeds INTEGER
    );
    CREATE TABLE options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      countsAsBedLinen INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE reservation_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reservationId INTEGER NOT NULL,
      optionId INTEGER NOT NULL,
      quantity INTEGER DEFAULT 1,
      offered INTEGER DEFAULT 0
    );
  `);
  return db;
}

function makeOption(db, { title = 'Linge de lit', countsAsBedLinen = 1 } = {}) {
  const result = db.prepare('INSERT INTO options (title, countsAsBedLinen) VALUES (?, ?)').run(title, countsAsBedLinen);
  return Number(result.lastInsertRowid);
}

function makeReservation(db, {
  kind = 'reservation', startDate, endDate,
  singleBeds = 0, doubleBeds = 0, babyBeds = 0,
} = {}) {
  const result = db.prepare(
    'INSERT INTO reservations (kind, startDate, endDate, singleBeds, doubleBeds, babyBeds) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(kind, startDate, endDate, singleBeds, doubleBeds, babyBeds);
  return Number(result.lastInsertRowid);
}

function linkOption(db, reservationId, optionId, { quantity = 1, offered = 0 } = {}) {
  db.prepare(
    'INSERT INTO reservation_options (reservationId, optionId, quantity, offered) VALUES (?, ?, ?, ?)'
  ).run(reservationId, optionId, quantity, offered);
}

// --- Rule 1: linen-flagged option required ---

test('dropOffForWindow: reservation WITH the linen option contributes its bed counts', () => {
  const db = makeDb();
  const opt = makeOption(db);
  const r = makeReservation(db, { startDate: '2026-05-30', endDate: '2026-06-02', singleBeds: 2, doubleBeds: 1, babyBeds: 1 });
  linkOption(db, r, opt);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(
    model.dropOffForWindow('2026-05-26', '2026-06-02'),
    { singleBeds: 2, doubleBeds: 1, babyBeds: 1 }
  );
});

test('dropOffForWindow: reservation WITHOUT a linen-flagged option contributes nothing', () => {
  const db = makeDb();
  const optNonLinen = makeOption(db, { countsAsBedLinen: 0 });
  const r = makeReservation(db, { startDate: '2026-05-30', endDate: '2026-06-02', singleBeds: 2, doubleBeds: 1 });
  linkOption(db, r, optNonLinen);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffForWindow('2026-05-26', '2026-06-02'), { singleBeds: 0, doubleBeds: 0, babyBeds: 0 });
});

test('dropOffForWindow: reservation with NO options at all contributes nothing', () => {
  const db = makeDb();
  makeReservation(db, { startDate: '2026-05-30', endDate: '2026-06-02', singleBeds: 5, doubleBeds: 5 });
  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffForWindow('2026-05-26', '2026-06-02'), { singleBeds: 0, doubleBeds: 0, babyBeds: 0 });
});

// --- Rule 2: offered flag ignored ---

test('dropOffForWindow: offered=true on the linen option still contributes', () => {
  const db = makeDb();
  const opt = makeOption(db);
  const r = makeReservation(db, { startDate: '2026-05-30', endDate: '2026-06-02', singleBeds: 2, doubleBeds: 1 });
  linkOption(db, r, opt, { offered: 1 });

  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffForWindow('2026-05-26', '2026-06-02'), { singleBeds: 2, doubleBeds: 1, babyBeds: 0 });
});

// --- Rule 3: quantity ignored ---

test('dropOffForWindow: quantity on the linen option does NOT multiply bed counts', () => {
  const db = makeDb();
  const opt = makeOption(db);
  const r = makeReservation(db, { startDate: '2026-05-30', endDate: '2026-06-02', singleBeds: 2, doubleBeds: 1 });
  linkOption(db, r, opt, { quantity: 5 });

  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffForWindow('2026-05-26', '2026-06-02'), { singleBeds: 2, doubleBeds: 1, babyBeds: 0 });
});

// --- Rule 4: multiple linen options on one reservation count once ---

test('dropOffForWindow: reservation with TWO linen-flagged options counts the beds ONCE', () => {
  const db = makeDb();
  const optA = makeOption(db, { title: 'Linge de lit Standard' });
  const optB = makeOption(db, { title: 'Linge de lit Premium' });
  const r = makeReservation(db, { startDate: '2026-05-30', endDate: '2026-06-02', singleBeds: 2, doubleBeds: 1, babyBeds: 1 });
  linkOption(db, r, optA);
  linkOption(db, r, optB);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffForWindow('2026-05-26', '2026-06-02'), { singleBeds: 2, doubleBeds: 1, babyBeds: 1 });
});

// --- Rule 5: kind = 'devis' excluded ---

test('dropOffForWindow: kind=devis excluded even with linen option', () => {
  const db = makeDb();
  const opt = makeOption(db);
  const r = makeReservation(db, { kind: 'devis', startDate: '2026-05-30', endDate: '2026-06-02', singleBeds: 2, doubleBeds: 1 });
  linkOption(db, r, opt);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffForWindow('2026-05-26', '2026-06-02'), { singleBeds: 0, doubleBeds: 0, babyBeds: 0 });
});

// --- Rule 8: half-open window ---

test('dropOffForWindow: endDate exactly on the START bound is EXCLUDED (left-exclusive)', () => {
  const db = makeDb();
  const opt = makeOption(db);
  // Check-out on 2026-05-26 — the previous laundry day — joins the PREVIOUS batch.
  const r = makeReservation(db, { startDate: '2026-05-22', endDate: '2026-05-26', singleBeds: 2 });
  linkOption(db, r, opt);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffForWindow('2026-05-26', '2026-06-02'), { singleBeds: 0, doubleBeds: 0, babyBeds: 0 });
});

test('dropOffForWindow: endDate exactly on the END bound is INCLUDED (right-inclusive)', () => {
  const db = makeDb();
  const opt = makeOption(db);
  // Check-out on the laundry day itself → counts in the same day's drop-off.
  const r = makeReservation(db, { startDate: '2026-06-01', endDate: '2026-06-02', singleBeds: 1, doubleBeds: 2 });
  linkOption(db, r, opt);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffForWindow('2026-05-26', '2026-06-02'), { singleBeds: 1, doubleBeds: 2, babyBeds: 0 });
});

// --- Edge cases ---

test('dropOffForWindow: reservation with all bed counts = 0 (or NULL) contributes zeros, does not crash', () => {
  const db = makeDb();
  const opt = makeOption(db);
  const r1 = makeReservation(db, { startDate: '2026-05-30', endDate: '2026-06-02' }); // all zero
  // NULL singleBeds via raw insert
  const r2 = Number(db.prepare(
    "INSERT INTO reservations (kind, startDate, endDate, singleBeds, doubleBeds, babyBeds) VALUES ('reservation', '2026-05-31', '2026-06-01', NULL, NULL, NULL)"
  ).run().lastInsertRowid);
  linkOption(db, r1, opt);
  linkOption(db, r2, opt);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffForWindow('2026-05-26', '2026-06-02'), { singleBeds: 0, doubleBeds: 0, babyBeds: 0 });
});

test('dropOffForWindow: empty DB returns zeros', () => {
  const db = makeDb();
  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffForWindow('2026-05-26', '2026-06-02'), { singleBeds: 0, doubleBeds: 0, babyBeds: 0 });
});

test('dropOffForWindow: aggregates across multiple qualifying reservations', () => {
  const db = makeDb();
  const opt = makeOption(db);
  // Three reservations, all checking out in the window.
  const r1 = makeReservation(db, { startDate: '2026-05-28', endDate: '2026-05-30', singleBeds: 2, doubleBeds: 1 });
  const r2 = makeReservation(db, { startDate: '2026-05-30', endDate: '2026-06-01', singleBeds: 1, babyBeds: 1 });
  const r3 = makeReservation(db, { startDate: '2026-06-01', endDate: '2026-06-02', doubleBeds: 2 });
  linkOption(db, r1, opt);
  linkOption(db, r2, opt);
  linkOption(db, r3, opt);

  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffForWindow('2026-05-26', '2026-06-02'), { singleBeds: 3, doubleBeds: 3, babyBeds: 1 });
});
