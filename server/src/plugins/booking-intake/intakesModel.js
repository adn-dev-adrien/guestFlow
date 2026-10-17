/**
 * The plugin's tables (specs/booking-extranet-intake.md §5): one row per page the userscript sent, and
 * the stays the operator said are not Booking's. `parsed` keeps the parsed fields of an applied or
 * proposed intake as JSON — never the raw page.
 */

const TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS booking_intakes (
    id                  INTEGER PRIMARY KEY,
    resId               TEXT NOT NULL,
    hotelId             TEXT NOT NULL,
    reservationId       INTEGER,
    status              TEXT NOT NULL,
    error               TEXT,
    parsed              TEXT,
    guestMessagePending INTEGER NOT NULL DEFAULT 0,
    dismissedAt         TEXT,
    createdAt           TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_booking_intakes_resId ON booking_intakes(resId);
  CREATE INDEX IF NOT EXISTS idx_booking_intakes_reservation ON booking_intakes(reservationId);

  CREATE TABLE IF NOT EXISTS booking_dismissals (
    reservationId INTEGER PRIMARY KEY,
    createdAt     TEXT DEFAULT CURRENT_TIMESTAMP
  );
`;

function hydrate(row) {
  if (!row) return null;
  return { ...row, parsed: row.parsed ? JSON.parse(row.parsed) : null, guestMessagePending: Boolean(row.guestMessagePending) };
}

function buildModel(db) {
  return {
    insert({ resId, hotelId, reservationId = null, status, error = null, parsed = null, guestMessagePending = false }) {
      const r = db.prepare(`INSERT INTO booking_intakes (resId, hotelId, reservationId, status, error, parsed, guestMessagePending)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(String(resId), String(hotelId), reservationId, status, error,
        parsed ? JSON.stringify(parsed) : null, guestMessagePending ? 1 : 0);
      return Number(r.lastInsertRowid);
    },
    get(id) {
      return hydrate(db.prepare('SELECT * FROM booking_intakes WHERE id = ?').get(Number(id)));
    },
    setStatus(id, status, error = null) {
      db.prepare('UPDATE booking_intakes SET status = ?, error = ? WHERE id = ?').run(status, error, Number(id));
    },
    // The intake a fiche shows: the latest applied or proposed one, unless the operator hid it.
    latestForReservation(reservationId) {
      return hydrate(db.prepare(`SELECT * FROM booking_intakes WHERE reservationId = ? AND dismissedAt IS NULL
        AND status IN ('applied', 'proposed') ORDER BY id DESC LIMIT 1`).get(Number(reservationId)));
    },
    // A later view of the same page tells whether the guest wrote since: the banner follows it.
    setGuestMessagePending(reservationId, pending) {
      db.prepare(`UPDATE booking_intakes SET guestMessagePending = ? WHERE id = (
        SELECT id FROM booking_intakes WHERE reservationId = ? AND status IN ('applied', 'proposed')
        ORDER BY id DESC LIMIT 1)`).run(pending ? 1 : 0, Number(reservationId));
    },
    dismiss(id) {
      db.prepare("UPDATE booking_intakes SET dismissedAt = datetime('now') WHERE id = ?").run(Number(id));
    },
    list(limit = 10) {
      return db.prepare('SELECT * FROM booking_intakes ORDER BY id DESC LIMIT ?').all(Math.min(Math.max(Number(limit) || 10, 1), 50))
        .map(hydrate);
    },
    count() {
      return db.prepare('SELECT COUNT(*) AS n FROM booking_intakes').get().n;
    },
    dismissFiche(reservationId) {
      db.prepare('INSERT OR IGNORE INTO booking_dismissals (reservationId) VALUES (?)').run(Number(reservationId));
    },
  };
}

module.exports = { buildModel, TABLE_SQL };
