// Cleaning ("Ménage") option tagger — specs/j1-arrival-reminder-email.md §4.1.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { ensureCleaningOptionTagged } = require('../utils/cleaningOptionSeed');

const SILENT = { log() {} };

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      autoOptionType TEXT
    );
  `);
  return db;
}

test('promotes an untyped "Ménage" option to autoOptionType=cleaning', () => {
  const db = freshDb();
  db.prepare("INSERT INTO options (title, autoOptionType) VALUES ('Ménage', NULL)").run();
  const r = ensureCleaningOptionTagged(db, { logger: SILENT });
  assert.equal(r.action, 'tagged');
  assert.equal(db.prepare("SELECT autoOptionType FROM options WHERE title='Ménage'").get().autoOptionType, 'cleaning');
});

test('matches the accent-less "Menage" title too', () => {
  const db = freshDb();
  db.prepare("INSERT INTO options (title, autoOptionType) VALUES ('Menage', '')").run();
  ensureCleaningOptionTagged(db, { logger: SILENT });
  assert.equal(db.prepare("SELECT autoOptionType FROM options WHERE title='Menage'").get().autoOptionType, 'cleaning');
});

test('idempotent: a second run is a no-op once everything is tagged', () => {
  const db = freshDb();
  db.prepare("INSERT INTO options (title, autoOptionType) VALUES ('Ménage', NULL)").run();
  ensureCleaningOptionTagged(db, { logger: SILENT });
  const r2 = ensureCleaningOptionTagged(db, { logger: SILENT });
  assert.equal(r2.action, 'noop-no-match');
});

test('tags a duplicate "Ménage" created after a first one was already tagged', () => {
  const db = freshDb();
  db.prepare("INSERT INTO options (title, autoOptionType) VALUES ('Ménage', 'cleaning')").run();
  db.prepare("INSERT INTO options (title, autoOptionType) VALUES ('Ménage', '')").run();
  const r = ensureCleaningOptionTagged(db, { logger: SILENT });
  assert.equal(r.action, 'tagged');
  assert.equal(r.count, 1);
  const untyped = db.prepare("SELECT COUNT(*) AS n FROM options WHERE title='Ménage' AND (autoOptionType IS NULL OR autoOptionType='')").get().n;
  assert.equal(untyped, 0);
});

test('leaves an already-typed Ménage untouched (does not overwrite)', () => {
  const db = freshDb();
  db.prepare("INSERT INTO options (title, autoOptionType) VALUES ('Ménage', 'breakfast')").run();
  const r = ensureCleaningOptionTagged(db, { logger: SILENT });
  // No cleaning row, no untyped match → noop.
  assert.equal(r.action, 'noop-no-match');
  assert.equal(db.prepare("SELECT autoOptionType FROM options WHERE title='Ménage'").get().autoOptionType, 'breakfast');
});

test('does not touch non-matching titles', () => {
  const db = freshDb();
  db.prepare("INSERT INTO options (title, autoOptionType) VALUES ('Petit déjeuner', NULL)").run();
  const r = ensureCleaningOptionTagged(db, { logger: SILENT });
  assert.equal(r.action, 'noop-no-match');
  assert.equal(db.prepare("SELECT autoOptionType FROM options WHERE title='Petit déjeuner'").get().autoOptionType, null);
});
