/**
 * specs/gift-vouchers/gift-voucher-campaigns.md rule 37 — the core terms become one document per activity. The CGV tables
 * written before it hold a single document: a one-row draft (`CHECK id = 1`), versions numbered 1..n
 * (`version UNIQUE`) and acceptances that all belong to a reservation. Rebuilt here, every row is kept
 * under the `lodging` activity with its id, so the acceptances still point at the version they accepted.
 * A fresh database gets the same shape from schema.sql. Columns are only ever added (the rollback guard): the draft keeps its `id`, `reservationId` stays.
 */

const REBUILD_DDL = `
  CREATE TABLE terms_draft__rebuild (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity TEXT NOT NULL UNIQUE DEFAULT 'lodging',
      markdownFr TEXT NOT NULL DEFAULT '',
      markdownEn TEXT NOT NULL DEFAULT '',
      updatedAt TEXT
    );
  CREATE TABLE terms_versions__rebuild (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity TEXT NOT NULL DEFAULT 'lodging',
      version INTEGER NOT NULL,
      markdownFr TEXT NOT NULL,
      markdownEn TEXT NOT NULL,
      htmlFr TEXT NOT NULL,
      htmlEn TEXT NOT NULL,
      variablesJson TEXT NOT NULL,
      contentHash TEXT NOT NULL,
      publishedAt TEXT NOT NULL,
      publishedBy INTEGER REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE (activity, version)
    );
  CREATE TABLE terms_acceptances__rebuild (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reservationId INTEGER,
      termsVersionId INTEGER NOT NULL,
      acceptedAt TEXT NOT NULL,
      ip TEXT,
      userAgent TEXT,
      pluginVersion TEXT,
      activity TEXT NOT NULL DEFAULT 'lodging',
      subjectType TEXT NOT NULL DEFAULT 'reservation',
      subjectRef TEXT,
      channel TEXT NOT NULL DEFAULT 'site',
      FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE CASCADE,
      FOREIGN KEY (termsVersionId) REFERENCES terms_versions(id)
    );
`;

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

function needsMigration(db) {
  const exists = (name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
  if (!exists('terms_draft') || !exists('terms_versions') || !exists('terms_acceptances')) return false;
  return !hasColumn(db, 'terms_draft', 'activity')
    || !hasColumn(db, 'terms_versions', 'activity')
    || !hasColumn(db, 'terms_acceptances', 'activity');
}

/** Rebuilds the three tables in one transaction; → true when it ran. Idempotent. */
function migrateTermsPerActivity(db) {
  if (!needsMigration(db)) return false;
  const foreignKeys = db.pragma('foreign_keys', { simple: true });
  const legacy = db.pragma('legacy_alter_table', { simple: true });
  // Both pragmas are no-ops inside a transaction. Off, dropping a parent neither cascades nor fails, and the
  // renames keep the references written by name.
  db.pragma('foreign_keys = OFF');
  db.pragma('legacy_alter_table = ON');
  try {
    db.transaction(() => {
      db.exec(REBUILD_DDL);
      db.exec("INSERT INTO terms_draft__rebuild (id, activity, markdownFr, markdownEn, updatedAt) SELECT id, 'lodging', markdownFr, markdownEn, updatedAt FROM terms_draft");
      db.exec(`INSERT INTO terms_versions__rebuild
          (id, activity, version, markdownFr, markdownEn, htmlFr, htmlEn, variablesJson, contentHash, publishedAt, publishedBy)
        SELECT id, 'lodging', version, markdownFr, markdownEn, htmlFr, htmlEn, variablesJson, contentHash, publishedAt, publishedBy
          FROM terms_versions ORDER BY id`);
      db.exec(`INSERT INTO terms_acceptances__rebuild
          (id, reservationId, termsVersionId, acceptedAt, ip, userAgent, pluginVersion, activity, subjectType, subjectRef, channel)
        SELECT id, reservationId, termsVersionId, acceptedAt, ip, userAgent, pluginVersion, 'lodging', 'reservation', CAST(reservationId AS TEXT), 'site'
          FROM terms_acceptances ORDER BY id`);
      for (const table of ['terms_acceptances', 'terms_versions', 'terms_draft']) {
        db.exec(`DROP TABLE ${table}`);
        db.exec(`ALTER TABLE ${table}__rebuild RENAME TO ${table}`);
      }
      db.exec('CREATE INDEX IF NOT EXISTS idx_terms_acceptances_reservation ON terms_acceptances (reservationId)');
      const problems = db.pragma('foreign_key_check(terms_acceptances)');
      if (problems.length) throw new Error(`TERMS_PER_ACTIVITY_FK: ${problems.length} acceptance(s) lost their version or reservation`);
    })();
  } finally {
    db.pragma(`legacy_alter_table = ${legacy ? 'ON' : 'OFF'}`);
    db.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
  }
  return true;
}

module.exports = { migrateTermsPerActivity };
