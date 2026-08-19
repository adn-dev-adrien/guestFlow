const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const laundryExtraTripsModel = require('../models/laundryExtraTripsModel');
const laundryManualAdditionsModel = require('../models/laundryManualAdditionsModel');
const laundryExtraTripsController = require('../controllers/laundryExtraTripsController');

// specs/laundry-extra-trip.md §4.3 + §7 — endpoint-shape coverage for the extra-trip handlers,
// driven via mock req/res. Role enforcement is owned by `enforceRoleAccess` (its own suite); here
// we only check the handlers' validation + payloads.

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
  );
  CREATE TABLE IF NOT EXISTS laundry_trip_manual_additions (
    tripDate     TEXT PRIMARY KEY NOT NULL CHECK (length(tripDate) = 10),
    singleBeds   INTEGER NOT NULL DEFAULT 0,
    doubleBeds   INTEGER NOT NULL DEFAULT 0,
    babyBeds     INTEGER NOT NULL DEFAULT 0,
    largeTowels  INTEGER NOT NULL DEFAULT 0,
    mediumTowels INTEGER NOT NULL DEFAULT 0,
    smallTowels  INTEGER NOT NULL DEFAULT 0,
    updatedAt    TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

const ZERO_BLOCK = { singleBeds: 0, doubleBeds: 0, babyBeds: 0, largeTowels: 0, mediumTowels: 0, smallTowels: 0, bathMats: 0 };

// Fake laundry model: every window returns a fixed block, so the preview exercises the ledger
// wiring without reservation SQL (the ledger itself is pinned by laundry-trip-ledger.unit.test.js).
function fakeLaundryModel(block = { singleBeds: 2, doubleBeds: 1, babyBeds: 0 }) {
  return {
    dropOffForWindow: () => ({ ...block }),
    dropOffBathroomForWindow: () => ({ largeTowels: 3, mediumTowels: 0, smallTowels: 3 }),
    dropOffBathMatForWindow: () => ({ bathMats: 0 }),
  };
}

function freshController({ laundryWeekday = 2, skipped = [] } = {}) {
  const db = new Database(':memory:');
  db.exec(DDL);
  const trips = laundryExtraTripsModel.create(db);
  const manual = laundryManualAdditionsModel.create(db);
  const ctrl = laundryExtraTripsController.create({
    extraTripsModel: trips,
    manualAdditionsModel: manual,
    settingsModel: { read: () => ({ laundryWeekday }) },
    laundryModel: fakeLaundryModel(),
    skipsModel: { listAll: () => [...skipped] },
  });
  return { ctrl, trips, manual };
}

function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

// 2026-08-20 is a Thursday; 2026-08-18 is a Tuesday (laundry weekday 2).

test('GET /extra-trips returns the persisted list', () => {
  const { ctrl, trips } = freshController();
  trips.set('2026-08-20', {});
  const res = makeRes();
  ctrl.list({}, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { trips: [{ date: '2026-08-20', pickUpAll: true, pickUp: ZERO_BLOCK }] });
});

test('PUT /extra-trips/:date with pickUpAll upserts and returns the trip', () => {
  const { ctrl, trips } = freshController();
  const res = makeRes();
  ctrl.set({ params: { date: '2026-08-20' }, body: { pickUpAll: true } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, trip: { date: '2026-08-20', pickUpAll: true, pickUp: ZERO_BLOCK } });
  assert.equal(trips.count(), 1);
});

test('PUT /extra-trips/:date partial stores the counts', () => {
  const { ctrl } = freshController();
  const res = makeRes();
  ctrl.set({ params: { date: '2026-08-20' }, body: { pickUpAll: false, pickUp: { singleBeds: 2, largeTowels: 4 } } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.trip.pickUpAll, false);
  assert.deepEqual(res.body.trip.pickUp, { ...ZERO_BLOCK, singleBeds: 2, largeTowels: 4 });
});

test('PUT partial without pickUp counts → 400 INVALID_PICKUP', () => {
  const { ctrl, trips } = freshController();
  const res = makeRes();
  ctrl.set({ params: { date: '2026-08-20' }, body: { pickUpAll: false } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'INVALID_PICKUP');
  assert.equal(trips.count(), 0);
});

test('PUT on the regular laundry day → 400 EXTRA_TRIP_ON_LAUNDRY_DAY (rule 2)', () => {
  const { ctrl, trips } = freshController({ laundryWeekday: 2 });
  const res = makeRes();
  ctrl.set({ params: { date: '2026-08-18' }, body: { pickUpAll: true } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'EXTRA_TRIP_ON_LAUNDRY_DAY');
  assert.equal(trips.count(), 0);
});

test('PUT with a malformed or impossible date → 400 INVALID_DATE', () => {
  const { ctrl } = freshController();
  for (const date of ['2026/08/20', '2026-13-99', 'abc']) {
    const res = makeRes();
    ctrl.set({ params: { date }, body: { pickUpAll: true } }, res);
    assert.equal(res.statusCode, 400, date);
    assert.equal(res.body.code, 'INVALID_DATE');
  }
});

test('DELETE /extra-trips/:date is idempotent and cascades the manual line of that date (rule 6)', () => {
  const { ctrl, trips, manual } = freshController();
  trips.set('2026-08-20', {});
  manual.set('2026-08-20', { singleBeds: 2 });
  manual.set('2026-08-25', { singleBeds: 1 });
  const res = makeRes();
  ctrl.remove({ params: { date: '2026-08-20' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(trips.count(), 0);
  assert.deepEqual(Object.keys(manual.listAll()), ['2026-08-25']);
  // Second delete: still 200.
  const res2 = makeRes();
  ctrl.remove({ params: { date: '2026-08-20' } }, res2);
  assert.equal(res2.statusCode, 200);
});

test('DELETE with a malformed date → 400 INVALID_DATE', () => {
  const { ctrl } = freshController();
  const res = makeRes();
  ctrl.remove({ params: { date: 'nope' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'INVALID_DATE');
});

test('GET /extra-trips/preview returns dropOff + atLaundry for a free date', () => {
  const { ctrl } = freshController();
  const res = makeRes();
  ctrl.preview({ query: { date: '2026-08-20' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.date, '2026-08-20');
  // The fake window returns the same block for every window → dropOff and the pool (= the previous
  // regular trip's drop) read the same.
  const expected = { singleBeds: 2, doubleBeds: 1, babyBeds: 0, largeTowels: 3, mediumTowels: 0, smallTowels: 3, bathMats: 0 };
  assert.deepEqual(res.body.dropOff, expected);
  assert.deepEqual(res.body.atLaundry, expected);
});

test('GET /extra-trips/preview on a laundry day → 400 EXTRA_TRIP_ON_LAUNDRY_DAY; bad date → 400 INVALID_DATE', () => {
  const { ctrl } = freshController();
  const res = makeRes();
  ctrl.preview({ query: { date: '2026-08-18' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'EXTRA_TRIP_ON_LAUNDRY_DAY');
  const res2 = makeRes();
  ctrl.preview({ query: { date: '20260820' } }, res2);
  assert.equal(res2.statusCode, 400);
  assert.equal(res2.body.code, 'INVALID_DATE');
});
