// Reservation number generation (specs/reservation-number-and-search.md §3).

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  monthPrefix, nextNumberForPrefix, generateReservationNumber, backfillReservationNumbers,
} = require('../utils/reservationNumber');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL DEFAULT 'reservation',
      reservationNumber TEXT,
      devisNumber TEXT,
      createdAt TEXT
    );
  `);
  return db;
}

test('monthPrefix: slices a stored ISO/SQLite string, formats a Date locally', () => {
  assert.equal(monthPrefix('2026-06-18 12:30:00'), '2026-06-');
  assert.equal(monthPrefix('2026-11-02T08:00:00.000Z'), '2026-11-');
  const d = new Date(2026, 0, 5); // local January
  assert.equal(monthPrefix(d), '2026-01-');
});

test('generateReservationNumber: first of the month → AAAA-MM-001', () => {
  const db = freshDb();
  assert.equal(generateReservationNumber(db, { now: new Date(2026, 5, 1) }), '2026-06-001');
});

test('generateReservationNumber: increments past the current max for the month', () => {
  const db = freshDb();
  db.prepare("INSERT INTO reservations (kind, reservationNumber) VALUES ('reservation', '2026-06-001')").run();
  db.prepare("INSERT INTO reservations (kind, reservationNumber) VALUES ('reservation', '2026-06-002')").run();
  assert.equal(generateReservationNumber(db, { now: new Date(2026, 5, 15) }), '2026-06-003');
});

test('generateReservationNumber: resets the counter on a new month', () => {
  const db = freshDb();
  db.prepare("INSERT INTO reservations (kind, reservationNumber) VALUES ('reservation', '2026-06-009')").run();
  assert.equal(generateReservationNumber(db, { now: new Date(2026, 6, 1) }), '2026-07-001');
});

test('generateReservationNumber: independent from devisNumber', () => {
  const db = freshDb();
  // A devis carrying the same AAAA-MM scheme must NOT influence the reservation sequence.
  db.prepare("INSERT INTO reservations (kind, devisNumber) VALUES ('devis', '2026-06-005')").run();
  assert.equal(generateReservationNumber(db, { now: new Date(2026, 5, 1) }), '2026-06-001');
});

test('nextNumberForPrefix: handles a >9 counter (zero-padded lexical sort holds)', () => {
  const db = freshDb();
  for (let i = 1; i <= 12; i += 1) {
    db.prepare("INSERT INTO reservations (kind, reservationNumber) VALUES ('reservation', ?)")
      .run(`2026-06-${String(i).padStart(3, '0')}`);
  }
  assert.equal(nextNumberForPrefix(db, '2026-06-'), '2026-06-013');
});

test('backfillReservationNumbers: assigns sequential per-month numbers ordered by createdAt,id', () => {
  const db = freshDb();
  db.prepare("INSERT INTO reservations (kind, createdAt) VALUES ('reservation', '2026-06-10 09:00:00')").run(); // id 1
  db.prepare("INSERT INTO reservations (kind, createdAt) VALUES ('reservation', '2026-06-05 08:00:00')").run(); // id 2 (earlier)
  db.prepare("INSERT INTO reservations (kind, createdAt) VALUES ('reservation', '2026-07-01 10:00:00')").run(); // id 3 (next month)

  const assigned = backfillReservationNumbers(db);
  assert.equal(assigned, 3);

  const byId = (id) => db.prepare('SELECT reservationNumber FROM reservations WHERE id = ?').get(id).reservationNumber;
  assert.equal(byId(2), '2026-06-001'); // earliest createdAt in June → 001
  assert.equal(byId(1), '2026-06-002');
  assert.equal(byId(3), '2026-07-001'); // July resets
});

test('backfillReservationNumbers: leaves already-numbered rows, ignores devis, is idempotent', () => {
  const db = freshDb();
  db.prepare("INSERT INTO reservations (kind, reservationNumber, createdAt) VALUES ('reservation', '2026-06-042', '2026-06-01 00:00:00')").run();
  db.prepare("INSERT INTO reservations (kind, createdAt) VALUES ('reservation', '2026-06-02 00:00:00')").run(); // numberless
  db.prepare("INSERT INTO reservations (kind, devisNumber, createdAt) VALUES ('devis', '2026-06-001', '2026-06-03 00:00:00')").run();

  const first = backfillReservationNumbers(db);
  assert.equal(first, 1, 'only the numberless reservation is filled');
  // Continues the month sequence past the pre-existing 042.
  assert.equal(db.prepare("SELECT reservationNumber FROM reservations WHERE kind='reservation' AND id=2").get().reservationNumber, '2026-06-043');
  // Devis stays untouched.
  assert.equal(db.prepare("SELECT reservationNumber FROM reservations WHERE kind='devis'").get().reservationNumber, null);

  const second = backfillReservationNumbers(db);
  assert.equal(second, 0, 'second run is a no-op');
});
