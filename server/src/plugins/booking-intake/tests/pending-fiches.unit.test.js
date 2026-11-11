// specs/booking-extranet-intake.md rules 21–24 — « À compléter »: the Booking stays the iCal import created
// and nobody filled, computed on read.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { listPending } = require('../pendingFiches');
const { TABLE_SQL } = require('../intakesModel');

function build(rows) {
  const db = new Database(':memory:');
  db.exec(TABLE_SQL);
  db.exec(`CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, platformKey TEXT, isActive INTEGER);
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, propertyId INTEGER, kind TEXT, startDate TEXT, endDate TEXT, platform TEXT,
      sourceType TEXT, sourcePlatformKey TEXT, sourceIcalSourceId INTEGER, platformGrossAmount REAL);
    INSERT INTO properties VALUES (1, 'La Granja'), (2, 'L''Estiva');
    INSERT INTO ical_sources VALUES (1, 'booking', 1), (2, 'lodgify', 1), (3, 'gitedefrance', 1), (4, 'airbnb', 1);`);
  const sourceIdOf = { booking: 1, lodgify: 2, gitedefrance: 3, airbnb: 4 };
  const insert = db.prepare(`INSERT INTO reservations (id, propertyId, kind, startDate, endDate, platform, sourceType, sourcePlatformKey, sourceIcalSourceId, platformGrossAmount)
    VALUES (@id, @propertyId, @kind, @startDate, @endDate, @platform, @sourceType, @sourcePlatformKey, @sourceIcalSourceId, @platformGrossAmount)`);
  rows.forEach((r, i) => {
    const row = {
      id: 100 + i, propertyId: 1, kind: 'reservation', startDate: '2026-11-06', endDate: '2026-11-08', platform: 'Lodgify',
      sourceType: 'ical', sourcePlatformKey: 'lodgify', platformGrossAmount: null, ...r,
    };
    insert.run({ ...row, sourceIcalSourceId: sourceIdOf[row.sourcePlatformKey] || null });
  });
  return db;
}

const run = (db, overrides = {}) => listPending({
  db, hotelIds: { 1: '14407976' }, today: '2026-10-16', ...overrides,
});

test('specs/booking-extranet-intake.md rule 21: Booking and Lodgify sources are counted, other sources are not', () => {
  const db = build([
    { sourcePlatformKey: 'booking', platform: 'Booking' },
    { sourcePlatformKey: 'lodgify', platform: 'Lodgify' },
    { sourcePlatformKey: 'gitedefrance', platform: 'GitesDeFrance' },
    { sourcePlatformKey: 'airbnb', platform: 'Airbnb' },
  ]);
  assert.deepEqual(run(db).map((i) => i.reservationId), [100, 101]);
});

test('specs/booking-extranet-intake.md rule 21 (amended 2026-10-18): the sources are read from the calendars — a stopped Lodgify relay no longer counts, Booking’s own feed always does', () => {
  const db = build([
    { sourcePlatformKey: 'booking', platform: 'Booking' },
    { sourcePlatformKey: 'lodgify', platform: 'Booking' },
  ]);
  assert.deepEqual(run(db).map((i) => i.reservationId), [100, 101]);
  db.prepare("UPDATE ical_sources SET isActive = 0 WHERE platformKey IN ('lodgify', 'booking')").run();
  assert.deepEqual(run(db).map((i) => i.reservationId), [100]);
});

test('specs/booking-extranet-intake.md rule 21: a Lodgify-feed stay labelled Airbnb is not a Booking stay', () => {
  const db = build([{ platform: 'Airbnb' }, { platform: 'Booking' }]);
  assert.deepEqual(run(db).map((i) => i.reservationId), [101]);
});

test('specs/booking-extranet-intake.md rule 21: filled, cancelled, past, unmapped and other-property stays are excluded', () => {
  const db = build([
    { platformGrossAmount: 721.82 },
    { kind: 'cancelled' },
    { startDate: '2026-10-10', endDate: '2026-10-12' },
    { propertyId: 2 },
    { startDate: '2026-10-16', endDate: '2026-10-18' },
  ]);
  assert.deepEqual(run(db).map((i) => i.reservationId), [104], 'only the stay arriving today is still to fill');
});

test('specs/booking-extranet-intake.md rule 21: nothing is listed until a property is mapped to an establishment', () => {
  assert.deepEqual(run(build([{}]), { hotelIds: {} }), []);
  assert.deepEqual(run(build([{}]), { hotelIds: { 1: '' } }), []);
});

test('specs/booking-extranet-intake.md rule 22: each line links to the extranet list filtered on the arrival date', () => {
  const [item] = run(build([{}]));
  assert.equal(item.propertyName, 'La Granja');
  assert.deepEqual([item.startDate, item.endDate], ['2026-11-06', '2026-11-08']);
  assert.equal(item.extranetUrl,
    'https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/search_reservations.html?hotel_id=14407976&date_type=arrival&date_from=2026-11-06&date_to=2026-11-06');
});

test('specs/booking-extranet-intake.md rule 23: « Pas une réservation Booking » removes the line; filling the fiche removes it too', () => {
  const db = build([{}, {}]);
  db.prepare('INSERT INTO booking_dismissals (reservationId) VALUES (100)').run();
  assert.deepEqual(run(db).map((i) => i.reservationId), [101]);
  db.prepare('UPDATE reservations SET platformGrossAmount = 721.82 WHERE id = 101').run();
  assert.deepEqual(run(db), []);
});

test('specs/booking-extranet-intake.md rule 24: arrival within 7 days is urgent, later is not', () => {
  const db = build([{ startDate: '2026-10-23', endDate: '2026-10-25' }, { startDate: '2026-10-24', endDate: '2026-10-26' }]);
  const [soon, later] = run(db);
  assert.deepEqual([soon.urgent, soon.daysToArrival], [true, 7]);
  assert.deepEqual([later.urgent, later.daysToArrival], [false, 8]);
});
