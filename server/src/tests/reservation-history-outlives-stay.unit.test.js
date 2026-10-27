// specs/ical-cancellation-approval.md rules 11 and 14 (2026-10-27 spec review) — approving an iCal
// cancellation deletes the stay, and its history (the « Suppression iCal approuvée » row first) must
// survive: `reservation_history` no longer cascades with `reservations`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-history-outlives-')), 'g.db');
const db = require('../database');
const icalCancellationModel = require('../models/icalCancellationModel');
const { keepHistoryBeyondReservation, historyCascadesWithReservation } = require('../utils/reservationHistoryKeepMigration');

test('the booted schema keeps no foreign key from reservation_history to reservations', () => {
  assert.equal(historyCascadesWithReservation(db), false);
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'reservation_history'").all().map((i) => i.name);
  assert.ok(indexes.includes('idx_reservation_history_reservationId'));
  assert.ok(db.prepare("SELECT 1 FROM migrations WHERE name = 'reservation_history_outlives_reservation_v1'").get());
});

test('approving an iCal cancellation keeps every history row of the deleted stay', () => {
  const pid = db.prepare("INSERT INTO properties (name, maxGuests) VALUES ('Gîte', 6)").run().lastInsertRowid;
  const cid = db.prepare("INSERT INTO clients (firstName, lastName) VALUES ('Jean', 'Dupont')").run().lastInsertRowid;
  const sid = db.prepare(`INSERT INTO ical_sources (propertyId, name, url, platformKey, platformLabel)
    VALUES (?, 'Airbnb', 'https://example.test/a.ics', 'airbnb', 'Airbnb')`).run(pid).lastInsertRowid;
  const rid = db.prepare(`INSERT INTO reservations (clientId, kind, propertyId, startDate, endDate, platform, sourceType)
    VALUES (?, 'reservation', ?, '2027-07-10', '2027-07-13', 'Airbnb', 'ical')`).run(cid, pid).lastInsertRowid;
  db.prepare("INSERT INTO reservation_history (reservationId, eventType, changedFields) VALUES (?, 'create', '[]')").run(rid);
  const alertId = db.prepare('INSERT INTO ical_cancellation_alerts (reservationId, sourceId, eventUid) VALUES (?, ?, ?)')
    .run(rid, sid, 'E1').lastInsertRowid;

  const result = icalCancellationModel.buildModel(db).approve(alertId);

  assert.equal(result.outcome, 'approved');
  assert.equal(db.prepare('SELECT 1 FROM reservations WHERE id = ?').get(rid), undefined);
  const history = db.prepare('SELECT eventType, changedFields FROM reservation_history WHERE reservationId = ? ORDER BY id').all(rid);
  assert.deepEqual(history.map((h) => h.eventType), ['create', 'delete']);
  assert.match(history[1].changedFields, /Suppression iCal approuvée/);
});

test('the migration rebuilds an old cascading table with every row, id and counter, then is a no-op', () => {
  const old = new Database(':memory:');
  old.pragma('foreign_keys = ON');
  old.exec(`
    CREATE TABLE reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, note TEXT);
    CREATE TABLE reservation_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reservationId INTEGER NOT NULL,
      eventType TEXT NOT NULL DEFAULT 'update',
      changedFields TEXT NOT NULL DEFAULT '[]',
      createdAt TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_reservation_history_reservationId ON reservation_history(reservationId);
    INSERT INTO reservations (id) VALUES (1), (2);
    INSERT INTO reservation_history (id, reservationId, eventType, changedFields, createdAt) VALUES
      (5, 1, 'create', '[]', '2026-01-01 10:00:00'), (9, 2, 'update', '[{"field":"x"}]', '2026-02-01 10:00:00');
  `);
  // Before: deleting a stay erases its history.
  assert.equal(historyCascadesWithReservation(old), true);

  assert.equal(keepHistoryBeyondReservation(old), 2);
  assert.equal(historyCascadesWithReservation(old), false);
  assert.deepEqual(old.prepare('SELECT id, reservationId, eventType, createdAt FROM reservation_history ORDER BY id').all().map((r) => [r.id, r.reservationId, r.eventType]),
    [[5, 1, 'create'], [9, 2, 'update']]);
  assert.equal(old.prepare("SELECT createdAt FROM reservation_history WHERE id = 5").get().createdAt, '2026-01-01 10:00:00');
  assert.equal(old.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'reservation_history'").get().seq, 9);
  assert.ok(old.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_reservation_history_reservationId'").get());

  old.prepare('DELETE FROM reservations WHERE id = 1').run();
  assert.equal(old.prepare('SELECT COUNT(*) AS n FROM reservation_history WHERE reservationId = 1').get().n, 1);
  assert.equal(keepHistoryBeyondReservation(old), null, 'second run leaves the table alone');
  assert.equal(old.prepare('INSERT INTO reservation_history (reservationId) VALUES (2)').run().lastInsertRowid, 10);
});
