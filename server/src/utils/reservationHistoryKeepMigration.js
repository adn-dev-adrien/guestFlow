/**
 * The stay's history outlives the stay (specs/ical-cancellation-approval.md rules 11 and 14).
 *
 * `reservation_history.reservationId` used to be declared `REFERENCES reservations(id) ON DELETE CASCADE`,
 * so approving an iCal cancellation — which writes the « Suppression iCal approuvée » row and then
 * deletes the stay — erased that very row together with every earlier entry. SQLite cannot drop a
 * foreign key in place, so the table is rebuilt without it (create new, copy every row with its id,
 * swap, restore the index and the AUTOINCREMENT counter) inside one transaction.
 *
 * Idempotent: a table whose DDL no longer references `reservations` is left untouched. Reservation ids
 * are AUTOINCREMENT, so an orphan history row can never be picked up by a later stay.
 */

const HISTORY_DDL = `
  CREATE TABLE reservation_history__new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservationId INTEGER NOT NULL,
    eventType TEXT NOT NULL DEFAULT 'update',
    changedFields TEXT NOT NULL DEFAULT '[]',
    createdAt TEXT DEFAULT (datetime('now'))
  )`;

const tableSql = (db, table) => {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  return row ? row.sql : null;
};

const columnsOf = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

/** True when `reservation_history` still carries a foreign key on `reservations`. */
function historyCascadesWithReservation(db) {
  const sql = tableSql(db, 'reservation_history');
  return Boolean(sql) && /REFERENCES\s+reservations/i.test(sql);
}

/**
 * Rebuild `reservation_history` without its foreign key. Returns the number of rows carried over, or
 * `null` when there was nothing to do.
 */
function keepHistoryBeyondReservation(db) {
  if (!historyCascadesWithReservation(db)) return null;
  let copied = 0;
  db.transaction(() => {
    const oldColumns = columnsOf(db, 'reservation_history');
    db.exec(HISTORY_DDL);
    const shared = columnsOf(db, 'reservation_history__new').filter((c) => oldColumns.includes(c)).map((c) => `"${c}"`).join(', ');
    copied = db.prepare(`INSERT INTO reservation_history__new (${shared}) SELECT ${shared} FROM reservation_history`).run().changes;
    const seq = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'reservation_history'").get();
    db.exec('DROP TABLE reservation_history');
    db.exec('ALTER TABLE reservation_history__new RENAME TO reservation_history');
    db.exec('CREATE INDEX IF NOT EXISTS idx_reservation_history_reservationId ON reservation_history(reservationId)');
    if (seq) {
      // CAST: a JS number is bound as a REAL, and `seq` has no column affinity to turn it back.
      const updated = db.prepare("UPDATE sqlite_sequence SET seq = CAST(? AS INTEGER) WHERE name = 'reservation_history'").run(seq.seq);
      if (updated.changes === 0) db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('reservation_history', CAST(? AS INTEGER))").run(seq.seq);
    }
  })();
  return copied;
}

module.exports = { keepHistoryBeyondReservation, historyCascadesWithReservation };
