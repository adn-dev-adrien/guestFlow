const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const laundryExtraTripsModel = require('../extraTripsModel');
const laundryManualAdditionsModel = require('../manualAdditionsModel');
const laundryExtraTripsController = require('../extraTripsController');
const { fakeScheduleModel } = require('./laundry-schedule-fixtures');
const { todayIso } = require('../../../utils/localDate');
const { addDaysToIsoDate } = require('../../../utils/devisHelpers');

// The dates of this suite hang on today (specs/server-test-isolation.md rule 6), on fixed weekdays: a
// Thursday free of laundry, the Tuesday before it (laundry weekday 2), and the Tuesday after.
const THURSDAY = (() => {
  const from = addDaysToIsoDate(todayIso(), -75);
  return addDaysToIsoDate(from, (4 - new Date(`${from}T00:00:00Z`).getUTCDay() + 7) % 7);
})();
const TUESDAY = addDaysToIsoDate(THURSDAY, -2);
const NEXT_TUESDAY = addDaysToIsoDate(THURSDAY, 5);

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
    bathMats     INTEGER NOT NULL DEFAULT 0,
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
    scheduleModel: fakeScheduleModel(laundryWeekday),
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


test('GET /extra-trips returns the persisted list', () => {
  const { ctrl, trips } = freshController();
  trips.set(THURSDAY, {});
  const res = makeRes();
  ctrl.list({}, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { trips: [{ date: THURSDAY, pickUpAll: true, pickUp: ZERO_BLOCK }] });
});

test('PUT /extra-trips/:date with pickUpAll upserts and returns the trip', () => {
  const { ctrl, trips } = freshController();
  const res = makeRes();
  ctrl.set({ params: { date: THURSDAY }, body: { pickUpAll: true } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, trip: { date: THURSDAY, pickUpAll: true, pickUp: ZERO_BLOCK } });
  assert.equal(trips.count(), 1);
});

test('PUT /extra-trips/:date partial stores the counts', () => {
  const { ctrl } = freshController();
  const res = makeRes();
  ctrl.set({ params: { date: THURSDAY }, body: { pickUpAll: false, pickUp: { singleBeds: 2, largeTowels: 4 } } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.trip.pickUpAll, false);
  assert.deepEqual(res.body.trip.pickUp, { ...ZERO_BLOCK, singleBeds: 2, largeTowels: 4 });
});

test('PUT partial without pickUp counts → 400 INVALID_PICKUP', () => {
  const { ctrl, trips } = freshController();
  const res = makeRes();
  ctrl.set({ params: { date: THURSDAY }, body: { pickUpAll: false } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'INVALID_PICKUP');
  assert.equal(trips.count(), 0);
});

test('PUT on the regular laundry day → 400 EXTRA_TRIP_ON_LAUNDRY_DAY (rule 2)', () => {
  const { ctrl, trips } = freshController({ laundryWeekday: 2 });
  const res = makeRes();
  ctrl.set({ params: { date: TUESDAY }, body: { pickUpAll: true } }, res);
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
  trips.set(THURSDAY, {});
  manual.set(THURSDAY, { singleBeds: 2 });
  manual.set(NEXT_TUESDAY, { singleBeds: 1 });
  const res = makeRes();
  ctrl.remove({ params: { date: THURSDAY } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(trips.count(), 0);
  assert.deepEqual(Object.keys(manual.listAll()), [NEXT_TUESDAY]);
  // Second delete: still 200.
  const res2 = makeRes();
  ctrl.remove({ params: { date: THURSDAY } }, res2);
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
  ctrl.preview({ query: { date: THURSDAY } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.date, THURSDAY);
  // The fake window returns the same block for every window → dropOff and the pool (= the previous
  // regular trip's drop) read the same.
  const expected = { singleBeds: 2, doubleBeds: 1, babyBeds: 0, largeTowels: 3, mediumTowels: 0, smallTowels: 3, bathMats: 0 };
  assert.deepEqual(res.body.dropOff, expected);
  assert.deepEqual(res.body.atLaundry, expected);
});

test('GET /extra-trips/preview on a laundry day → 400 EXTRA_TRIP_ON_LAUNDRY_DAY; bad date → 400 INVALID_DATE', () => {
  const { ctrl } = freshController();
  const res = makeRes();
  ctrl.preview({ query: { date: TUESDAY } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'EXTRA_TRIP_ON_LAUNDRY_DAY');
  const res2 = makeRes();
  ctrl.preview({ query: { date: '20260820' } }, res2); // date-literal-ok: refused for its compact form, whatever today is
  assert.equal(res2.statusCode, 400);
  assert.equal(res2.body.code, 'INVALID_DATE');
});
