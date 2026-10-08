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

  // The wording of the emails as data (specs/plugins-phase-p-productisation.md §5): stay texts,
  // global (propertyId 0) or per property, NULL meaning « never edited » for that language; and the
  // sentences tied to options, with the options they cover.
  db.exec(`
    CREATE TABLE IF NOT EXISTS stay_texts (
      key        TEXT    NOT NULL,
      propertyId INTEGER NOT NULL DEFAULT 0,
      fr         TEXT,
      en         TEXT,
      updatedAt  TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (key, propertyId)
    );
    CREATE TABLE IF NOT EXISTS email_mentions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      section       TEXT    NOT NULL CHECK (section IN ('local', 'extras', 'kids')),
      offerFr       TEXT    NOT NULL DEFAULT '',
      offerEn       TEXT    NOT NULL DEFAULT '',
      bookedFr      TEXT    NOT NULL DEFAULT '',
      bookedEn      TEXT    NOT NULL DEFAULT '',
      priceSource   TEXT    NOT NULL DEFAULT 'min' CHECK (priceSource IN ('min', 'option')),
      priceOptionId INTEGER,
      sortOrder     INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS email_mention_options (
      mentionId INTEGER NOT NULL REFERENCES email_mentions(id) ON DELETE CASCADE,
      optionId  INTEGER NOT NULL REFERENCES options(id) ON DELETE CASCADE,
      PRIMARY KEY (mentionId, optionId)
    );
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
    // Empty = no pool (rule 14). An existing row keeps the season it holds.
    ['poolSeasonStart', "TEXT DEFAULT ''"],
    ['poolSeasonEnd', "TEXT DEFAULT ''"],
    ['bookedConfirmationOrder', "TEXT NOT NULL DEFAULT '[]'"],
  ]);
  addColumns('resources', [
    ['emailBookedText', "TEXT NOT NULL DEFAULT ''"],
    ['emailBookedTextEn', "TEXT NOT NULL DEFAULT ''"],
  ]);
}

module.exports = { applyGuestEmailSequenceSchema };
