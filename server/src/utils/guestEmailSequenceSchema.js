/**
 * Schema of the guest email sequence (specs/guest-email-sequence.md §5) — the send ledger and the
 * columns its emails read. Idempotent and additive: applied at boot by database.js, and by the test
 * fixtures on a fresh schema.sql database, so both always run the same DDL.
 */

function applyGuestEmailSequenceSchema(db) {
  // The ledger is NOT email_log: email_log is purged 3 days after arrival, the ledger never is, and
  // its UNIQUE dedupKey is what makes a second send impossible (rules 11-12).
  db.exec(`
    CREATE TABLE IF NOT EXISTS guest_email_sends (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      dedupKey       TEXT    NOT NULL UNIQUE,
      stableKey      TEXT    NOT NULL,
      reservationId  INTEGER,
      clientId       INTEGER,
      seasonKey      TEXT,
      status         TEXT    NOT NULL,
      claimedAt      TEXT    NOT NULL DEFAULT (datetime('now')),
      sentAt         TEXT,
      recipientEmail TEXT    NOT NULL DEFAULT '',
      errorMessage   TEXT    NOT NULL DEFAULT '',
      emailLogId     INTEGER,
      CHECK (status IN ('claimed', 'sent', 'failed', 'skipped'))
    );
    CREATE INDEX IF NOT EXISTS idx_guest_email_sends_client ON guest_email_sends(clientId, sentAt);
  `);

  const addColumns = (table, columns) => {
    const existing = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (existing.length === 0) return;
    for (const [name, definition] of columns) {
      if (!existing.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
  };
  addColumns('clients', [
    ['postStayEmailsDisabled', 'INTEGER NOT NULL DEFAULT 0'],
    ['marketingUnsubscribedAt', 'TEXT'],
    ['emailPreferencesToken', 'TEXT'],
  ]);
  addColumns('reservations', [
    ['lostItems', "TEXT NOT NULL DEFAULT ''"],
  ]);
  addColumns('properties', [
    ['emailHook', "TEXT NOT NULL DEFAULT ''"],
    ['emailHookEn', "TEXT NOT NULL DEFAULT ''"],
    ['parkingDistanceMeters', 'INTEGER NOT NULL DEFAULT 0'],
    ['hasWifi', 'INTEGER NOT NULL DEFAULT 1'],
    ['hasFilterCoffeeMaker', 'INTEGER NOT NULL DEFAULT 0'],
  ]);
  addColumns('app_settings', [
    ['guestSequenceStartDate', 'TEXT'],
    ['googleReviewUrl', "TEXT DEFAULT ''"],
    ['instagramUrl', "TEXT DEFAULT ''"],
    ['poolSeasonStart', "TEXT DEFAULT '06-15'"],
    ['poolSeasonEnd', "TEXT DEFAULT '08-31'"],
  ]);
}

module.exports = { applyGuestEmailSequenceSchema };
