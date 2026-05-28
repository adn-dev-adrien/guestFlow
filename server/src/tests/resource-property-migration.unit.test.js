const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { migrateResourcePropertiesFromJson } = require('../utils/resourcePropertyMigration');

const LEGACY_DDL = `
  CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
  CREATE TABLE resources (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, propertyIds TEXT);
  CREATE TABLE resource_properties (
    resourceId INTEGER NOT NULL,
    propertyId INTEGER NOT NULL,
    PRIMARY KEY (resourceId, propertyId),
    FOREIGN KEY (resourceId) REFERENCES resources(id) ON DELETE CASCADE,
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE
  );
`;

function legacyDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(LEGACY_DDL);
  db.prepare('INSERT INTO properties (id, name) VALUES (1, ?)').run('Villa A');
  db.prepare('INSERT INTO properties (id, name) VALUES (2, ?)').run('Villa B');
  return db;
}

test('moves scoped propertyIds to the pivot, leaves global resources with no rows, drops the column', () => {
  const db = legacyDb();
  db.prepare('INSERT INTO resources (name, propertyIds) VALUES (?, ?)').run('Scoped', JSON.stringify([1, 2]));
  db.prepare('INSERT INTO resources (name, propertyIds) VALUES (?, ?)').run('Global', JSON.stringify([]));

  assert.equal(migrateResourcePropertiesFromJson(db), true);

  const cols = db.prepare('PRAGMA table_info(resources)').all().map((c) => c.name);
  assert.equal(cols.includes('propertyIds'), false);

  const scopedRows = db.prepare('SELECT propertyId FROM resource_properties WHERE resourceId = 1 ORDER BY propertyId').all();
  assert.deepEqual(scopedRows.map((r) => r.propertyId), [1, 2]);
  const globalRows = db.prepare('SELECT * FROM resource_properties WHERE resourceId = 2').all();
  assert.equal(globalRows.length, 0);
});

test('skips stale property ids (no matching properties row) to avoid FK violations', () => {
  const db = legacyDb();
  db.prepare('INSERT INTO resources (name, propertyIds) VALUES (?, ?)').run('Stale', JSON.stringify([1, 99]));
  migrateResourcePropertiesFromJson(db);
  const rows = db.prepare('SELECT propertyId FROM resource_properties WHERE resourceId = 1').all();
  assert.deepEqual(rows.map((r) => r.propertyId), [1]);
});

test('idempotent: a second run is a no-op (column already gone)', () => {
  const db = legacyDb();
  db.prepare('INSERT INTO resources (name, propertyIds) VALUES (?, ?)').run('Scoped', JSON.stringify([1]));
  assert.equal(migrateResourcePropertiesFromJson(db), true);
  assert.equal(migrateResourcePropertiesFromJson(db), false);
});
