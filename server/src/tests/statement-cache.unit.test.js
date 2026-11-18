// specs/pricing-components.md rule 48 (reading of 2026-11-18, loop t19) — one compiled statement per SQL text and database
// handle: `db.prepare(sql)` hands back the statement it already compiled, the cache empties when the schema changes, a text
// that fails to compile is never kept, the cache is bounded, the stay-write trail still sees each UPDATE once, and no
// module of src/ sets a statement mode a cached statement would share with another caller.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const statementCache = require('../utils/statementCache');
const stayWriteTrail = require('../utils/stayWriteTrail');

function fresh() {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE reservations (id INTEGER PRIMARY KEY, updatedAt TEXT); INSERT INTO reservations VALUES (1, 'v0'), (2, 'w0')");
  stayWriteTrail.install(db);
  statementCache.install(db);
  return db;
}

test('rule 48 — the same text gives the same compiled statement, another text another one; install is idempotent', () => {
  const db = fresh();
  const sql = 'SELECT * FROM reservations WHERE id = ?';
  const first = db.prepare(sql);
  statementCache.install(db);
  assert.equal(db.prepare(sql), first);
  assert.notEqual(db.prepare('SELECT id FROM reservations WHERE id = ?'), first);
  assert.deepEqual(db.prepare(sql).get(2), { id: 2, updatedAt: 'w0' });
});

test('rule 48 — a schema change empties the cache: a dropped table throws at prepare, an added column is read', () => {
  const db = fresh();
  db.exec('CREATE TABLE extra (id INTEGER PRIMARY KEY)');
  const read = 'SELECT * FROM extra';
  db.prepare(read);
  db.exec('DROP TABLE extra');
  assert.throws(() => db.prepare(read), /no such table/);
  const all = 'SELECT * FROM reservations WHERE id = 1';
  const before = db.prepare(all);
  db.exec('ALTER TABLE reservations ADD COLUMN note TEXT');
  const after = db.prepare(all);
  assert.notEqual(after, before);
  assert.deepEqual(after.get(), { id: 1, updatedAt: 'v0', note: null });
});

test('rule 48 — a text that fails to compile is not kept: it fails again, then compiles once the table exists', () => {
  const db = fresh();
  const sql = 'SELECT * FROM later';
  assert.throws(() => db.prepare(sql), /no such table/);
  assert.throws(() => db.prepare(sql), /no such table/);
  db.exec('CREATE TABLE later (id INTEGER)');
  assert.deepEqual(db.prepare(sql).all(), []);
});

test('rule 48 — the cache is bounded: the least recently used text is compiled again', () => {
  const db = fresh();
  const first = db.prepare('SELECT 0 AS n');
  for (let i = 1; i <= statementCache.LIMIT; i += 1) db.prepare(`SELECT ${i} AS n`);
  assert.notEqual(db.prepare('SELECT 0 AS n'), first, 'the oldest text was dropped');
  const recent = db.prepare(`SELECT ${statementCache.LIMIT} AS n`);
  assert.equal(db.prepare(`SELECT ${statementCache.LIMIT} AS n`), recent);
});

test('reservation-fiche-concurrency rule 8 still holds through the cache: each UPDATE of a stay is trailed once', () => {
  const db = fresh();
  const sql = 'UPDATE reservations SET updatedAt = ? WHERE id = ?';
  assert.equal(db.prepare(sql).run, db.prepare(sql).run, 'the trail wraps the cached statement once');
  const moved = stayWriteTrail.collect((store) => {
    db.prepare(sql).run('v1', 1);
    db.prepare(sql).run('v2', 1);
    return [...store.moved.values()];
  });
  assert.deepEqual(moved, [{ id: 1, before: 'v0', after: 'v2', broken: false }]);
});

test('rule 48 — the application database is cached, and no module of src/ sets a statement mode or iterates', () => {
  const db = require('../database');
  assert.equal(db.__statementCache, true);
  const SRC = path.join(__dirname, '..');
  const offenders = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'tests' || entry.name === 'apps') return;
      walk(full);
    } else if (entry.name.endsWith('.js') && full !== path.join(SRC, 'utils', 'statementCache.js')) {
      fs.readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
        if (/\.(pluck|expand|safeIntegers|iterate)\(|\.raw\((true|false)?\)|prepare\([^)]*\)\s*\.bind\(/.test(line)) offenders.push(`${path.relative(SRC, full)}:${i + 1}`);
      });
    }
  });
  walk(SRC);
  assert.deepEqual(offenders, []);
});
