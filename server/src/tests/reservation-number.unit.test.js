// Reservation number generation (specs/reservation-number-and-search.md §3). Format: AAAAMM### (no separators).

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  monthPrefix, nextNumberForPrefix, generateReservationNumber, backfillReservationNumbers,
  dehyphenateReservationNumbers,
} = require('../utils/reservationNumber');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL DEFAULT 'reservation',
      reservationNumber TEXT,
      devisNumber TEXT,
      createdAt TEXT,
      updatedAt TEXT
    );
  `);
  return db;
}

test('monthPrefix: slices a stored ISO/SQLite string, formats a Date locally (no separators)', () => {
  assert.equal(monthPrefix('2026-06-18 12:30:00'), '202606');
  assert.equal(monthPrefix('2026-11-02T08:00:00.000Z'), '202611');
  const d = new Date(2026, 0, 5); // local January
  assert.equal(monthPrefix(d), '202601');
});

test('generateReservationNumber: first of the month → AAAAMM001', () => {
  const db = freshDb();
  assert.equal(generateReservationNumber(db, { now: new Date(2026, 5, 1) }), '202606001');
});

test('generateReservationNumber: increments past the current max for the month', () => {
  const db = freshDb();
  db.prepare("INSERT INTO reservations (kind, reservationNumber) VALUES ('reservation', '202606001')").run();
  db.prepare("INSERT INTO reservations (kind, reservationNumber) VALUES ('reservation', '202606002')").run();
  assert.equal(generateReservationNumber(db, { now: new Date(2026, 5, 15) }), '202606003');
});

test('generateReservationNumber: resets the counter on a new month', () => {
  const db = freshDb();
  db.prepare("INSERT INTO reservations (kind, reservationNumber) VALUES ('reservation', '202606009')").run();
  assert.equal(generateReservationNumber(db, { now: new Date(2026, 6, 1) }), '202607001');
});

test('generateReservationNumber: independent from devisNumber', () => {
  const db = freshDb();
  // A devis (still AAAA-MM-### in its own column) must NOT influence the reservation sequence.
  db.prepare("INSERT INTO reservations (kind, devisNumber) VALUES ('devis', '2026-06-005')").run();
  assert.equal(generateReservationNumber(db, { now: new Date(2026, 5, 1) }), '202606001');
});

test('nextNumberForPrefix: handles a >9 counter (zero-padded lexical sort holds)', () => {
  const db = freshDb();
  for (let i = 1; i <= 12; i += 1) {
    db.prepare("INSERT INTO reservations (kind, reservationNumber) VALUES ('reservation', ?)")
      .run(`202606${String(i).padStart(3, '0')}`);
  }
  assert.equal(nextNumberForPrefix(db, '202606'), '202606013');
});

test('backfillReservationNumbers: assigns sequential per-month numbers ordered by createdAt,id', () => {
  const db = freshDb();
  db.prepare("INSERT INTO reservations (kind, createdAt) VALUES ('reservation', '2026-06-10 09:00:00')").run(); // id 1
  db.prepare("INSERT INTO reservations (kind, createdAt) VALUES ('reservation', '2026-06-05 08:00:00')").run(); // id 2 (earlier)
  db.prepare("INSERT INTO reservations (kind, createdAt) VALUES ('reservation', '2026-07-01 10:00:00')").run(); // id 3 (next month)

  const assigned = backfillReservationNumbers(db);
  assert.equal(assigned, 3);

  const byId = (id) => db.prepare('SELECT reservationNumber FROM reservations WHERE id = ?').get(id).reservationNumber;
  assert.equal(byId(2), '202606001'); // earliest createdAt in June → 001
  assert.equal(byId(1), '202606002');
  assert.equal(byId(3), '202607001'); // July resets
});

test('backfillReservationNumbers: leaves already-numbered rows, ignores devis, is idempotent', () => {
  const db = freshDb();
  db.prepare("INSERT INTO reservations (kind, reservationNumber, createdAt) VALUES ('reservation', '202606042', '2026-06-01 00:00:00')").run();
  db.prepare("INSERT INTO reservations (kind, createdAt) VALUES ('reservation', '2026-06-02 00:00:00')").run(); // numberless
  db.prepare("INSERT INTO reservations (kind, devisNumber, createdAt) VALUES ('devis', '2026-06-001', '2026-06-03 00:00:00')").run();

  const first = backfillReservationNumbers(db);
  assert.equal(first, 1, 'only the numberless reservation is filled');
  // Continues the month sequence past the pre-existing 042.
  assert.equal(db.prepare("SELECT reservationNumber FROM reservations WHERE kind='reservation' AND id=2").get().reservationNumber, '202606043');
  // Devis stays untouched.
  assert.equal(db.prepare("SELECT reservationNumber FROM reservations WHERE kind='devis'").get().reservationNumber, null);

  const second = backfillReservationNumbers(db);
  assert.equal(second, 0, 'second run is a no-op');
});

// ── Format migration: drop the hyphens (specs/reservation-number-and-search.md §3) ──

test('dehyphenateReservationNumbers: reformats ONLY original-format numbers, leaves the rest', () => {
  const db = freshDb();
  db.prepare("INSERT INTO reservations (id, kind, reservationNumber) VALUES (1, 'reservation', '2026-06-001')").run(); // original → reformat
  db.prepare("INSERT INTO reservations (id, kind, reservationNumber) VALUES (2, 'reservation', '2026-07-042')").run(); // original → reformat
  db.prepare("INSERT INTO reservations (id, kind, reservationNumber) VALUES (3, 'reservation', 'RES-PERSO-9')").run();  // custom → keep
  db.prepare("INSERT INTO reservations (id, kind, reservationNumber) VALUES (4, 'reservation', '202608005')").run();    // already new format → keep
  db.prepare("INSERT INTO reservations (id, kind, reservationNumber) VALUES (5, 'devis', '2026-06-001')").run();        // devis → untouched

  const n = dehyphenateReservationNumbers(db);
  assert.equal(n, 2);

  const byId = (id) => db.prepare('SELECT reservationNumber FROM reservations WHERE id = ?').get(id).reservationNumber;
  assert.equal(byId(1), '202606001');
  assert.equal(byId(2), '202607042');
  assert.equal(byId(3), 'RES-PERSO-9');
  assert.equal(byId(4), '202608005');
  assert.equal(byId(5), '2026-06-001'); // devis kind never matched

  assert.equal(dehyphenateReservationNumbers(db), 0, 'idempotent — nothing left to reformat');
});

test('dehyphenateReservationNumbers: skips a row whose de-hyphenated value already exists (no collision)', () => {
  const db = freshDb();
  db.prepare("INSERT INTO reservations (id, kind, reservationNumber) VALUES (1, 'reservation', '2026-06-001')").run(); // would become 202606001
  db.prepare("INSERT INTO reservations (id, kind, reservationNumber) VALUES (2, 'reservation', '202606001')").run();   // already taken

  const n = dehyphenateReservationNumbers(db);
  assert.equal(n, 0, 'the hyphenated row is left as-is to avoid a unique collision');
  assert.equal(db.prepare('SELECT reservationNumber FROM reservations WHERE id = 1').get().reservationNumber, '2026-06-001');
});
