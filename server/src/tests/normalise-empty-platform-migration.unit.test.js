const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runNormaliseEmptyPlatformMigration } = require('../utils/normaliseEmptyPlatformMigration');

// specs/bed-config-in-linen-card.md §10 hotfix follow-up #4. Plain :memory: fixture with
// the single table touched. The migration backfills NULL / empty / whitespace platform
// values to 'direct' so the rest of the codebase can trust the column.

const DDL = `
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL DEFAULT 'reservation',
    platform TEXT
  );
`;

function freshDb() {
  const db = new Database(':memory:');
  db.exec(DDL);
  return db;
}

test('NULL platform → coerced to direct', () => {
  const db = freshDb();
  db.prepare("INSERT INTO reservations (id, kind, platform) VALUES (1, 'reservation', NULL)").run();
  const result = runNormaliseEmptyPlatformMigration(db);
  assert.equal(result.normalisedCount, 1);
  assert.equal(db.prepare('SELECT platform FROM reservations WHERE id = 1').get().platform, 'direct');
});

test('empty string platform → coerced to direct', () => {
  const db = freshDb();
  db.prepare("INSERT INTO reservations (id, kind, platform) VALUES (2, 'reservation', '')").run();
  const result = runNormaliseEmptyPlatformMigration(db);
  assert.equal(result.normalisedCount, 1);
  assert.equal(db.prepare('SELECT platform FROM reservations WHERE id = 2').get().platform, 'direct');
});

test('whitespace-only platform → coerced to direct', () => {
  const db = freshDb();
  db.prepare("INSERT INTO reservations (id, kind, platform) VALUES (3, 'reservation', '   ')").run();
  const result = runNormaliseEmptyPlatformMigration(db);
  assert.equal(result.normalisedCount, 1);
  assert.equal(db.prepare('SELECT platform FROM reservations WHERE id = 3').get().platform, 'direct');
});

test('non-empty platform values are left untouched (direct + Airbnb both preserved)', () => {
  const db = freshDb();
  db.prepare("INSERT INTO reservations (id, kind, platform) VALUES (4, 'reservation', 'direct')").run();
  db.prepare("INSERT INTO reservations (id, kind, platform) VALUES (5, 'reservation', 'Airbnb')").run();
  const result = runNormaliseEmptyPlatformMigration(db);
  assert.equal(result.normalisedCount, 0);
  assert.equal(db.prepare('SELECT platform FROM reservations WHERE id = 4').get().platform, 'direct');
  assert.equal(db.prepare('SELECT platform FROM reservations WHERE id = 5').get().platform, 'Airbnb');
});

test('idempotent — a second run touches 0 rows', () => {
  const db = freshDb();
  db.prepare("INSERT INTO reservations (id, kind, platform) VALUES (6, 'reservation', NULL)").run();
  db.prepare("INSERT INTO reservations (id, kind, platform) VALUES (7, 'reservation', '')").run();
  const first = runNormaliseEmptyPlatformMigration(db);
  assert.equal(first.normalisedCount, 2);
  const second = runNormaliseEmptyPlatformMigration(db);
  assert.equal(second.normalisedCount, 0);
});
