const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { migrateClientPhonesToSingle } = require('../utils/clientPhoneMigration');

// Legacy schema: clients still have the multi-number `phoneNumbers` JSON column.
const LEGACY_DDL = `
  CREATE TABLE clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lastName TEXT NOT NULL,
    firstName TEXT NOT NULL,
    phone TEXT DEFAULT '',
    phoneNumbers TEXT DEFAULT '[]'
  );
`;

function legacyDb() {
  const db = new Database(':memory:');
  db.exec(LEGACY_DDL);
  return db;
}

test('keeps the first listed number, discards the rest, drops the column', () => {
  const db = legacyDb();
  db.prepare('INSERT INTO clients (lastName, firstName, phone, phoneNumbers) VALUES (?, ?, ?, ?)')
    .run('a', 'b', '', JSON.stringify(['0611111111', '0622222222']));

  const ran = migrateClientPhonesToSingle(db);
  assert.equal(ran, true);

  const cols = db.prepare('PRAGMA table_info(clients)').all().map((c) => c.name);
  assert.equal(cols.includes('phoneNumbers'), false);

  const row = db.prepare('SELECT phone FROM clients WHERE id = 1').get();
  assert.equal(row.phone, '0611111111');
});

test('keeps the existing phone when phoneNumbers is empty', () => {
  const db = legacyDb();
  db.prepare('INSERT INTO clients (lastName, firstName, phone, phoneNumbers) VALUES (?, ?, ?, ?)')
    .run('a', 'b', '0699999999', '[]');

  migrateClientPhonesToSingle(db);
  const row = db.prepare('SELECT phone FROM clients WHERE id = 1').get();
  assert.equal(row.phone, '0699999999');
});

test('idempotent: a second run is a no-op (column already gone)', () => {
  const db = legacyDb();
  db.prepare('INSERT INTO clients (lastName, firstName, phone, phoneNumbers) VALUES (?, ?, ?, ?)')
    .run('a', 'b', '', JSON.stringify(['0611111111']));

  assert.equal(migrateClientPhonesToSingle(db), true);
  assert.equal(migrateClientPhonesToSingle(db), false);
  const row = db.prepare('SELECT phone FROM clients WHERE id = 1').get();
  assert.equal(row.phone, '0611111111');
});
