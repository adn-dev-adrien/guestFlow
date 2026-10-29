/**
 * The plugin's table: one row per booking mail read (specs/airbnb-mail-intake.md §5).
 * `parsed` holds the fields of rule 5 as JSON, never the raw mail.
 */

const TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS airbnb_intakes (
    id            INTEGER PRIMARY KEY,
    messageId     TEXT NOT NULL UNIQUE,
    receivedAt    TEXT NOT NULL,
    confirmationCode TEXT,
    parsed        TEXT,
    status        TEXT NOT NULL,
    error         TEXT,
    reservationId INTEGER,
    appliedAt     TEXT,
    dismissedAt   TEXT,
    senderVerified INTEGER NOT NULL DEFAULT 0,
    parserVersion TEXT,
    createdAt     TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_airbnb_intakes_reservation ON airbnb_intakes(reservationId);
`;

// Intakes tables created before the sender check have no `senderVerified` column. A mail already applied
// was applied under the old rules and stays trusted; every row still open (pending, proposed) was never
// checked and is `0`, so the next pass proposes it with the warning instead of applying it.
function addSenderVerifiedColumn(db) {
  const has = db.prepare(`PRAGMA table_info(airbnb_intakes)`).all().some((c) => c.name === 'senderVerified');
  if (has) return;
  db.exec('ALTER TABLE airbnb_intakes ADD COLUMN senderVerified INTEGER NOT NULL DEFAULT 0');
  db.exec('UPDATE airbnb_intakes SET senderVerified = 1 WHERE appliedAt IS NOT NULL');
}

// A parse failure is stamped with the plugin version that read it (`parserVersion`), so a later parser fix reads
// the mail again (`has`). Rows from before the stamp have none and are read again once.
function addParserVersionColumn(db) {
  const has = db.prepare(`PRAGMA table_info(airbnb_intakes)`).all().some((c) => c.name === 'parserVersion');
  if (!has) db.exec('ALTER TABLE airbnb_intakes ADD COLUMN parserVersion TEXT');
}

function hydrate(row) {
  if (!row) return null;
  return { ...row, parsed: row.parsed ? JSON.parse(row.parsed) : null, senderVerified: Number(row.senderVerified) !== 0 };
}

function buildModel(db) {
  return {
    // With `parserVersion`: a mail whose parse failed under another version is forgotten, so it is read again —
    // unless the operator dismissed it, which stays final.
    has(messageId, parserVersion = null) {
      const row = db.prepare('SELECT id, status, parsed, parserVersion, dismissedAt FROM airbnb_intakes WHERE messageId = ?').get(messageId);
      if (!row) return false;
      if (parserVersion && !row.dismissedAt && row.parsed == null && ['error', 'ignored'].includes(row.status) && row.parserVersion !== parserVersion) {
        db.prepare('DELETE FROM airbnb_intakes WHERE id = ?').run(row.id);
        return false;
      }
      return true;
    },
    insert({ messageId, receivedAt, confirmationCode = null, parsed = null, status, error = null, senderVerified = true, parserVersion = null }) {
      const r = db.prepare(`INSERT INTO airbnb_intakes (messageId, receivedAt, confirmationCode, parsed, status, error, senderVerified, parserVersion)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(messageId) DO NOTHING`).run(messageId, receivedAt, confirmationCode, parsed ? JSON.stringify(parsed) : null, status, error, senderVerified ? 1 : 0, parserVersion);
      return r.changes ? Number(r.lastInsertRowid) : null;
    },
    get(id) {
      return hydrate(db.prepare('SELECT * FROM airbnb_intakes WHERE id = ?').get(Number(id)));
    },
    // Rows still waiting for a reservation, or for nothing the operator must do.
    listOpen() {
      return db.prepare("SELECT * FROM airbnb_intakes WHERE status = 'pending' ORDER BY receivedAt").all().map(hydrate);
    },
    // A second mail with the same confirmation code changes nothing once the first one was applied (edge case).
    codeAlreadyHandled(confirmationCode, exceptId) {
      return Boolean(db.prepare(`SELECT 1 FROM airbnb_intakes WHERE confirmationCode = ? AND id != ?
        AND senderVerified = 1 AND status IN ('applied', 'proposed')`).get(confirmationCode, Number(exceptId)));
    },
    setStatus(id, { status, error = null, reservationId = undefined, applied = false }) {
      db.prepare(`UPDATE airbnb_intakes SET status = ?, error = ?,
        reservationId = COALESCE(?, reservationId),
        appliedAt = CASE WHEN ? THEN datetime('now') ELSE appliedAt END
        WHERE id = ?`).run(status, error, reservationId === undefined ? null : reservationId, applied ? 1 : 0, Number(id));
    },
    dismiss(id) {
      db.prepare("UPDATE airbnb_intakes SET dismissedAt = datetime('now') WHERE id = ?").run(Number(id));
    },
    // The intake the fiche shows: the latest one tied to the reservation and not dismissed.
    latestForReservation(reservationId) {
      return hydrate(db.prepare(`SELECT * FROM airbnb_intakes WHERE reservationId = ? AND dismissedAt IS NULL
        ORDER BY senderVerified DESC, id DESC LIMIT 1`).get(Number(reservationId)));
    },
    // Dashboard: unreadable mails, bookings still without a fiche after a day, and mails from a sender that
    // could not be verified (rule 22).
    listAttention(nowIso) {
      return db.prepare(`SELECT * FROM airbnb_intakes WHERE dismissedAt IS NULL AND (status = 'error'
        OR (status = 'proposed' AND senderVerified = 0)
        OR (status = 'pending' AND datetime(receivedAt) <= datetime(?, '-1 day'))) ORDER BY receivedAt DESC`).all(nowIso).map(hydrate);
    },
    // Rule 31 — mails that were not intakes are remembered, not counted as read.
    count() {
      return db.prepare("SELECT COUNT(*) AS n FROM airbnb_intakes WHERE status != 'ignored'").get().n;
    },
    // Rule 31 — an ignored mail older than the reader's window can no longer come back: forgotten.
    purgeIgnored(beforeIso) {
      db.prepare("DELETE FROM airbnb_intakes WHERE status = 'ignored' AND dismissedAt IS NULL AND datetime(receivedAt) < datetime(?)").run(beforeIso);
    },
  };
}

module.exports = { buildModel, TABLE_SQL, addSenderVerifiedColumn, addParserVersionColumn };
