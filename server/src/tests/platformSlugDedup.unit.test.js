const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runPlatformSlugDedup } = require('../utils/platformSlugDedupMigration');

// Bug 2026-06-22: duplicate platform rows for the same slug (e.g. « Lodgify » + « lodgify ») make the
// per-platform tourist-tax write hit one row while the read reflects the other → the change "doesn't
// apply". runPlatformSlugDedup merges them into one canonical row (every boot, idempotent), preserving
// the operator's customised settings, and re-points iCal sources + reservations to the canonical name.

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE platforms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      commissionAccountNumber TEXT,
      hasVatOnCommission INTEGER NOT NULL DEFAULT 0,
      commissionPercent REAL NOT NULL DEFAULT 0,
      color TEXT,
      collectsTouristTax INTEGER NOT NULL DEFAULT 1,
      touristTaxRemittedByPlatform INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE ical_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, platformLabel TEXT);
    CREATE TABLE reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT);
  `);
  return db;
}

test('merges two case-duplicate rows into a single canonical row', () => {
  const db = freshDb();
  db.prepare("INSERT INTO platforms (id, name) VALUES (3, 'Lodgify'), (28780, 'lodgify')").run();
  const { mergedCount } = runPlatformSlugDedup(db);
  assert.equal(mergedCount, 1);
  const rows = db.prepare('SELECT id, name FROM platforms').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Lodgify');
  assert.equal(rows[0].id, 3); // lowest id survives
});

test("preserves the operator's customised tourist-tax mode even when it landed on the duplicate", () => {
  const db = freshDb();
  // Winner (id 3) at default 'platform' (1,1); the duplicate (id 28780) carries the operator's change to 'owner' (0,0).
  db.prepare("INSERT INTO platforms (id, name, collectsTouristTax, touristTaxRemittedByPlatform) VALUES (3, 'Lodgify', 1, 1), (28780, 'lodgify', 0, 0)").run();
  runPlatformSlugDedup(db);
  const row = db.prepare('SELECT name, collectsTouristTax c, touristTaxRemittedByPlatform r FROM platforms').get();
  assert.equal(row.name, 'Lodgify');
  assert.equal(row.c, 0); // the customised 'owner' mode is kept, not the winner's default
  assert.equal(row.r, 0);
});

test('preserves a customised colour / commission account from the duplicate', () => {
  const db = freshDb();
  db.prepare("INSERT INTO platforms (id, name, color, commissionAccountNumber) VALUES (3, 'Lodgify', NULL, NULL), (28780, 'lodgify', '#abcdef', '62260999')").run();
  runPlatformSlugDedup(db);
  const row = db.prepare('SELECT color, commissionAccountNumber FROM platforms').get();
  assert.equal(row.color, '#abcdef');
  assert.equal(row.commissionAccountNumber, '62260999');
});

test('re-points iCal sources + reservations to the canonical name', () => {
  const db = freshDb();
  db.prepare("INSERT INTO platforms (id, name) VALUES (3, 'Lodgify'), (28780, 'lodgify')").run();
  db.prepare("INSERT INTO ical_sources (platformLabel) VALUES ('lodgify'), ('Lodgify')").run();
  db.prepare("INSERT INTO reservations (platform) VALUES ('lodgify'), ('Lodgify'), ('direct')").run();
  runPlatformSlugDedup(db);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM ical_sources WHERE platformLabel = 'lodgify'").get().c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM ical_sources WHERE platformLabel = 'Lodgify'").get().c, 2);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM reservations WHERE platform = 'lodgify'").get().c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM reservations WHERE platform = 'Lodgify'").get().c, 2);
});

test('is idempotent — a second run on clean data is a no-op', () => {
  const db = freshDb();
  db.prepare("INSERT INTO platforms (id, name) VALUES (3, 'Lodgify'), (28780, 'lodgify')").run();
  runPlatformSlugDedup(db);
  const second = runPlatformSlugDedup(db);
  assert.equal(second.mergedCount, 0);
  assert.equal(second.renamedCount, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM platforms').get().c, 1);
});

test('renames a lone non-canonical row to its canonical form', () => {
  const db = freshDb();
  db.prepare("INSERT INTO platforms (id, name) VALUES (5, 'lodgify')").run();
  const { mergedCount, renamedCount } = runPlatformSlugDedup(db);
  assert.equal(mergedCount, 0);
  assert.equal(renamedCount, 1);
  assert.equal(db.prepare('SELECT name FROM platforms').get().name, 'Lodgify');
});

test('leaves distinct slugs alone (no over-merge of a typo platform)', () => {
  const db = freshDb();
  // « Logify » (typo) and « Lodgify » are DIFFERENT slugs → must not be merged.
  db.prepare("INSERT INTO platforms (id, name) VALUES (3, 'Lodgify'), (2785, 'Logify')").run();
  const { mergedCount } = runPlatformSlugDedup(db);
  assert.equal(mergedCount, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM platforms').get().c, 2);
});
