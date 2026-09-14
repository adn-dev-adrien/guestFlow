/**
 * The outbox of pushes to Portier (specs/gate-access-portier.md §5).
 *
 * Kept apart from the model so database.js can create the table at boot without requiring a module
 * that would require database.js back, and so the unit tests build the very table production runs.
 *
 * `AUTOINCREMENT` is load-bearing: the row id IS the push's revision (§3.1), and Portier ignores any
 * revision not above the last it applied. A plain rowid may be reused once the highest row is purged;
 * an AUTOINCREMENT id never is.
 *
 * Timestamps are ISO 8601 UTC strings (`Date.prototype.toISOString()`), so they compare as text.
 * `sentAt` means Portier answered: `lastError` then records a refusal (a 422), if there was one.
 */

const PORTIER_OUTBOX_SQL = `
  CREATE TABLE IF NOT EXISTS portier_outbox (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    reservationId INTEGER,
    type          TEXT    NOT NULL,
    payload       TEXT    NOT NULL,
    attempts      INTEGER NOT NULL DEFAULT 0,
    nextAttemptAt TEXT,
    lastError     TEXT    NOT NULL DEFAULT '',
    createdAt     TEXT    NOT NULL,
    sentAt        TEXT,
    CHECK (type IN ('stay', 'cancel', 'branding'))
  );
  CREATE INDEX IF NOT EXISTS idx_portier_outbox_pending ON portier_outbox(sentAt, id);
  CREATE INDEX IF NOT EXISTS idx_portier_outbox_reservation ON portier_outbox(reservationId, id);
`;

module.exports = { PORTIER_OUTBOX_SQL };
