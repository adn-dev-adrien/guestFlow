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

  // specs/guest-email-texts-made-simple.md §5 — the arrival facts of a property (rule 1, the code and
  // the Wi-Fi password encrypted, rule 2) and the « traduit automatiquement » marks (rule 19), keyed
  // by the text keys of models/emailTextsModel.js. An empty table means no paragraph: no backfill.
  db.exec(`
    CREATE TABLE IF NOT EXISTS property_arrival_facts (
      propertyId            INTEGER PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
      address               TEXT NOT NULL DEFAULT '',
      mapUrl                TEXT NOT NULL DEFAULT '',
      accessFr              TEXT NOT NULL DEFAULT '',
      accessEn              TEXT NOT NULL DEFAULT '',
      accessCodeEncrypted   TEXT NOT NULL DEFAULT '',
      wifiName              TEXT NOT NULL DEFAULT '',
      wifiPasswordEncrypted TEXT NOT NULL DEFAULT '',
      updatedAt             TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS stay_text_flags (
      key            TEXT    NOT NULL,
      language       TEXT    NOT NULL,
      autoTranslated INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (key, language)
    );
  `);

  // Rule 6 — « article jamais confirmé ». A property that exists when the column appears was saved
  // through its form, so its article counts as chosen; only a later property created without one
  // (the start assistant's step 2) is left to confirm.
  const propertyCols = db.prepare('PRAGMA table_info(properties)').all().map((c) => c.name);
  if (propertyCols.length && !propertyCols.includes('nameArticleConfirmed')) {
    db.exec('ALTER TABLE properties ADD COLUMN nameArticleConfirmed INTEGER NOT NULL DEFAULT 0');
    db.exec('UPDATE properties SET nameArticleConfirmed = 1');
  }

  // specs/guest-email-texts-made-simple.md rule 27 — what the start assistant could not know about a
  // property (`caution`, `cleaning`, `towels`, comma-separated) is left out of the emails until the
  // owner answers. Every property that exists when the column appears keeps its emails as they are.
  // `cleaningIncluded` / `towelsProvided`: the owner's answer, NULL leaving it to the options.
  if (propertyCols.length) {
    addColumns('properties', [
      ['pendingFacts', "TEXT NOT NULL DEFAULT ''"],
      ['cleaningIncluded', 'INTEGER'],
      ['towelsProvided', 'INTEGER'],
      // 2026-10-18 — the bed linen, answered like the towels.
      ['bedLinenProvided', 'INTEGER'],
    ]);
  }
  // Rule 33 — the pool season belongs to the property that has the pool. The season set once for
  // the whole instance is copied onto every property when the columns appear, so no email moves.
  if (propertyCols.length && !propertyCols.includes('poolSeasonStart')) {
    addColumns('properties', [
      ['poolSeasonStart', "TEXT NOT NULL DEFAULT ''"],
      ['poolSeasonEnd', "TEXT NOT NULL DEFAULT ''"],
    ]);
    const appCols = db.prepare('PRAGMA table_info(app_settings)').all().map((c) => c.name);
    if (appCols.includes('poolSeasonStart') && appCols.includes('poolSeasonEnd')) {
      const season = db.prepare('SELECT poolSeasonStart AS s, poolSeasonEnd AS e FROM app_settings ORDER BY id LIMIT 1').get();
      if (season && season.s && season.e) {
        db.prepare('UPDATE properties SET poolSeasonStart = ?, poolSeasonEnd = ?').run(season.s, season.e);
      }
    }
  }
  // Rule 28 — the property the start assistant created, so its step 2 edits it instead of adding one.
  addColumns('app_settings', [['onboardingPropertyId', 'INTEGER']]);
}

module.exports = { applyGuestEmailSequenceSchema };
