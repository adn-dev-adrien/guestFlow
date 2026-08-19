const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const laundryExtraTripsModel = require('../models/laundryExtraTripsModel');

// specs/laundry-extra-trip.md §5 + §7 — model coverage for `laundry_extra_trips`.

const DDL = `
  CREATE TABLE IF NOT EXISTS laundry_extra_trips (
    tripDate     TEXT PRIMARY KEY NOT NULL CHECK (length(tripDate) = 10),
    pickUpAll    INTEGER NOT NULL DEFAULT 1,
    singleBeds   INTEGER NOT NULL DEFAULT 0,
    doubleBeds   INTEGER NOT NULL DEFAULT 0,
    babyBeds     INTEGER NOT NULL DEFAULT 0,
    largeTowels  INTEGER NOT NULL DEFAULT 0,
    mediumTowels INTEGER NOT NULL DEFAULT 0,
    smallTowels  INTEGER NOT NULL DEFAULT 0,
    bathMats     INTEGER NOT NULL DEFAULT 0,
    createdAt    TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt    TEXT NOT NULL DEFAULT (datetime('now'))
  )
`;

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  return laundryExtraTripsModel.create(db);
}

const ZEROS = { singleBeds: 0, doubleBeds: 0, babyBeds: 0, largeTowels: 0, mediumTowels: 0, smallTowels: 0, bathMats: 0 };

test('listAll is empty by default; count is 0', () => {
  const m = freshModel();
  assert.deepEqual(m.listAll(), []);
  assert.equal(m.count(), 0);
});

test('set with pickUpAll (default) stores the trip with zero counts', () => {
  const m = freshModel();
  const trip = m.set('2026-08-20', {});
  assert.deepEqual(trip, { date: '2026-08-20', pickUpAll: true, pickUp: ZEROS });
  assert.deepEqual(m.get('2026-08-20'), trip);
  assert.deepEqual(m.listAll(), [trip]);
});

test('pickUpAll true ignores any counts sent alongside (stored as 0)', () => {
  const m = freshModel();
  m.set('2026-08-20', { pickUpAll: true, pickUp: { singleBeds: 4, bathMats: 2 } });
  assert.deepEqual(m.get('2026-08-20').pickUp, ZEROS);
});

test('partial pick-up stores the seven counts, rounded and clamped at 0', () => {
  const m = freshModel();
  const trip = m.set('2026-08-20', {
    pickUpAll: false,
    pickUp: { singleBeds: 2.6, doubleBeds: -3, babyBeds: '1', largeTowels: 5, smallTowels: null, bathMats: 1 },
  });
  assert.equal(trip.pickUpAll, false);
  assert.deepEqual(trip.pickUp, { singleBeds: 3, doubleBeds: 0, babyBeds: 1, largeTowels: 5, mediumTowels: 0, smallTowels: 0, bathMats: 1 });
  assert.deepEqual(m.get('2026-08-20'), trip);
});

test('set upserts: a second set on the same date replaces the mode + counts', () => {
  const m = freshModel();
  m.set('2026-08-20', { pickUpAll: false, pickUp: { singleBeds: 2 } });
  m.set('2026-08-20', { pickUpAll: true });
  assert.equal(m.count(), 1);
  assert.deepEqual(m.get('2026-08-20'), { date: '2026-08-20', pickUpAll: true, pickUp: ZEROS });
});

test('listAll is sorted ASC by date', () => {
  const m = freshModel();
  m.set('2026-09-03', {});
  m.set('2026-08-20', {});
  assert.deepEqual(m.listAll().map((t) => t.date), ['2026-08-20', '2026-09-03']);
});

test('remove is idempotent and returns whether a row went away', () => {
  const m = freshModel();
  m.set('2026-08-20', {});
  assert.equal(m.remove('2026-08-20'), true);
  assert.equal(m.remove('2026-08-20'), false);
  assert.equal(m.get('2026-08-20'), null);
  assert.equal(m.count(), 0);
});

test('malformed dates are rejected at the model boundary', () => {
  const m = freshModel();
  assert.throws(() => m.set('2026/08/20', {}));
  assert.throws(() => m.get('nope'));
  assert.throws(() => m.remove(''));
});
