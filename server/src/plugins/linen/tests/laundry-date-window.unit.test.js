// specs/reservations-backend-mvc.md rule 13 (past reading of 2026-11-02) on the laundry writes — a skip, a manual
// addition and an extra trip are entered on a day from today − 5 years to today + 5 years (400
// DATE_OUTSIDE_WINDOW, nothing written); a date already stored is edited whatever its day.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const skipsModelFactory = require('../skipsModel');
const skipsControllerFactory = require('../skipsController');
const extraTripsModelFactory = require('../extraTripsModel');
const manualAdditionsModelFactory = require('../manualAdditionsModel');
const manualAdditionsControllerFactory = require('../manualAdditionsController');
const extraTripsControllerFactory = require('../extraTripsController');
const { fakeScheduleModel } = require('./laundry-schedule-fixtures');
const { horizonStart, horizonEnd, PAST_HORIZON_MESSAGE, HORIZON_MESSAGE } = require('../../../utils/stayDates');
const { addDaysToIsoDate } = require('../../../utils/devisHelpers');

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

const SKIPS_DDL = `
  CREATE TABLE IF NOT EXISTS laundry_trip_skips (
    tripDate TEXT PRIMARY KEY NOT NULL CHECK (length(tripDate) = 10),
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  )
`;

const S = horizonStart();
const H = horizonEnd();
const before = addDaysToIsoDate(S, -1);
const after = addDaysToIsoDate(H, 1);
const weekday = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
// A laundry weekday none of the four dates falls on, so an extra trip is allowed on each of them.
const LAUNDRY_DAY = [0, 1, 2, 3, 4, 5, 6].find((d) => ![S, H, before, after].map(weekday).includes(d));

function fresh() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.exec(SKIPS_DDL);
  const trips = extraTripsModelFactory.create(db);
  const manual = manualAdditionsModelFactory.create(db);
  const skips = skipsModelFactory.create(db);
  return {
    db, trips, manual, skips,
    skipsCtrl: skipsControllerFactory.create(skips),
    manualCtrl: manualAdditionsControllerFactory.create(manual),
    tripsCtrl: extraTripsControllerFactory.create({
      extraTripsModel: trips, manualAdditionsModel: manual, scheduleModel: fakeScheduleModel(LAUNDRY_DAY),
      laundryModel: {}, skipsModel: skips,
    }),
  };
}

function res() {
  return { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

const refusal = (error) => ({ error, code: 'DATE_OUTSIDE_WINDOW' });

test('a skip is added from today − 5 years to today + 5 years, refused one day outside, and an existing skip is re-added', () => {
  const { skipsCtrl, skips, db } = fresh();
  for (const [date, error] of [[before, PAST_HORIZON_MESSAGE], [after, HORIZON_MESSAGE]]) {
    const r = res();
    skipsCtrl.addSkip({ body: { date } }, r);
    assert.equal(r.statusCode, 400);
    assert.deepEqual(r.body, refusal(error));
  }
  assert.deepEqual(skips.listAll(), []);
  for (const date of [S, H]) {
    const r = res();
    skipsCtrl.addSkip({ body: { date } }, r);
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  }
  db.prepare('INSERT INTO laundry_trip_skips (tripDate) VALUES (?)').run(before);
  const again = res();
  skipsCtrl.addSkip({ body: { date: before } }, again);
  assert.equal(again.statusCode, 200);
  const removed = res();
  skipsCtrl.removeSkip({ params: { date: before } }, removed);
  assert.equal(removed.statusCode, 200);
});

test('a manual addition is set from today − 5 years to today + 5 years, refused outside; a stored one is edited', () => {
  const { manualCtrl, manual, db } = fresh();
  for (const [date, error] of [[before, PAST_HORIZON_MESSAGE], [after, HORIZON_MESSAGE]]) {
    const r = res();
    manualCtrl.setAddition({ params: { date }, body: { singleBeds: 2 } }, r);
    assert.equal(r.statusCode, 400);
    assert.deepEqual(r.body, refusal(error));
  }
  assert.deepEqual(manual.listAll(), {});
  for (const date of [S, H]) {
    const r = res();
    manualCtrl.setAddition({ params: { date }, body: { singleBeds: 2 } }, r);
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  }
  db.prepare('INSERT INTO laundry_trip_manual_additions (tripDate, singleBeds) VALUES (?, 1)').run(before);
  const edited = res();
  manualCtrl.setAddition({ params: { date: before }, body: { singleBeds: 3 } }, edited);
  assert.equal(edited.statusCode, 200);
  assert.equal(manual.listAll()[before].singleBeds, 3);
});

test('an extra trip is set from today − 5 years to today + 5 years, refused outside; a stored one is edited', () => {
  const { tripsCtrl, trips, db } = fresh();
  for (const [date, error] of [[before, PAST_HORIZON_MESSAGE], [after, HORIZON_MESSAGE]]) {
    const r = res();
    tripsCtrl.set({ params: { date }, body: { pickUpAll: true } }, r);
    assert.equal(r.statusCode, 400);
    assert.deepEqual(r.body, refusal(error));
  }
  assert.deepEqual(trips.listAll(), []);
  for (const date of [S, H]) {
    const r = res();
    tripsCtrl.set({ params: { date }, body: { pickUpAll: true } }, r);
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  }
  db.prepare('INSERT INTO laundry_extra_trips (tripDate, pickUpAll) VALUES (?, 1)').run(before);
  const edited = res();
  tripsCtrl.set({ params: { date: before }, body: { pickUpAll: false, pickUp: { singleBeds: 1 } } }, edited);
  assert.equal(edited.statusCode, 200, JSON.stringify(edited.body));
});
