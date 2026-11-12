// specs/self-update-and-releases.md §3.B rule 57 — the schema floor: stored in the database, only ever raised, read by the updater, which refuses
// a target below it with a short impersonal French message and stages nothing.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { readSchemaFloor, raiseSchemaFloor, isBelowSchemaFloor, BELOW_FLOOR_MESSAGE } = require('../utils/schemaFloor');
const controller = require('../controllers/systemController');

const fresh = () => {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE migrations (name TEXT PRIMARY KEY, ran_at TEXT NOT NULL DEFAULT (datetime('now')))");
  return db;
};

test('rule 57: no floor until a migration raises one', () => {
  const db = fresh();
  assert.equal(readSchemaFloor(db), null);
  assert.equal(isBelowSchemaFloor(db, '1.0.0'), false);
  assert.equal(readSchemaFloor(new Database(':memory:')), null, 'a database with no migrations table has no floor');
});

test('rule 57: the floor only goes up, and the greatest version wins', () => {
  const db = fresh();
  assert.equal(raiseSchemaFloor(db, '4.1.0'), true);
  assert.equal(raiseSchemaFloor(db, '4.1.0'), false);
  assert.equal(raiseSchemaFloor(db, '4.0.5'), false, 'a lower floor is ignored');
  assert.equal(readSchemaFloor(db), '4.1.0');
  assert.equal(raiseSchemaFloor(db, '4.10.0'), true, 'compared as numbers, not text');
  assert.equal(readSchemaFloor(db), '4.10.0');
  assert.throws(() => raiseSchemaFloor(db, 'v4'), /SCHEMA_FLOOR_INVALID/);
});

test('rule 57: the updater answers 422 BELOW_SCHEMA_FLOOR for a target below the floor, before anything else', async () => {
  const database = require('../database');
  raiseSchemaFloor(database, '99.0.0');
  try {
    let status; let body;
    const res = { status(code) { status = code; return this; }, json(payload) { body = payload; return this; } };
    await controller.startUpdate({ body: { targetVersion: '98.9.9' } }, res);
    assert.equal(status, 422);
    assert.equal(body.error, 'BELOW_SCHEMA_FLOOR');
    assert.equal(body.message, BELOW_FLOOR_MESSAGE);
    assert.doesNotMatch(body.message, /\b(tu|vous|votre|ton)\b/i, 'impersonal');
  } finally {
    database.prepare("DELETE FROM migrations WHERE name = 'schema_floor:99.0.0'").run();
  }
});
