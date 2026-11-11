// specs/plugins-phase-3a-online-payment.md rule 29 — `db.transaction(fn)()` takes the write lock up front (BEGIN IMMEDIATE):
// a read-then-write transaction started while another connection writes waits for it instead of failing at once with
// SQLITE_BUSY_SNAPSHOT. Nested transactions stay savepoints; `.deferred()` keeps its meaning.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');

const { makeImmediateByDefault } = require('../utils/immediateTransactions');
const { install } = require('../utils/stayWriteTrail');
const propertiesModel = require('../models/propertiesModel');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const HOLD_MS = 400;

function fileDb(t, { schema = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-immediate-tx-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'main.db');
  const db = new Database(file);
  t.after(() => db.close());
  db.pragma('journal_mode = WAL');
  if (schema) db.exec(SCHEMA); else db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  return { db, file };
}

function holdWriteLock(file, sql) {
  const code = `
    const Database = require(${JSON.stringify(require.resolve('better-sqlite3'))});
    const db = new Database(${JSON.stringify(file)});
    db.exec('BEGIN IMMEDIATE');
    console.log('locked');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${HOLD_MS});
    db.prepare(${JSON.stringify(sql)}).run();
    db.exec('COMMIT');
  `;
  const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
  return {
    locked: new Promise((resolve) => child.stdout.once('data', resolve)),
    exited: new Promise((resolve) => child.on('exit', resolve)),
  };
}

test('rule 29: a plain transaction is immediate; deferred, immediate and exclusive keep their meaning', (t) => {
  const { db } = fileDb(t);
  makeImmediateByDefault(db);
  makeImmediateByDefault(db); // idempotent
  const seen = [];
  const original = db.exec.bind(db);
  const tx = db.transaction(() => { seen.push(db.inTransaction); });
  tx();
  tx.deferred();
  tx.immediate();
  tx.exclusive();
  assert.deepEqual(seen, [true, true, true, true]);
  assert.equal(typeof tx.default, 'function');
  assert.equal(tx.database, db);
  assert.equal(typeof original, 'function');
});

test('rule 29: nested transactions stay savepoints: the inner one rolls back alone, the outer commits', (t) => {
  const { db } = fileDb(t);
  makeImmediateByDefault(db);
  const inner = db.transaction(() => { db.prepare("INSERT INTO t (v) VALUES ('inner')").run(); throw new Error('inner fails'); });
  const outer = db.transaction(() => {
    db.prepare("INSERT INTO t (v) VALUES ('outer')").run();
    try { inner(); } catch { /* the outer carries on */ }
    return db.inTransaction;
  });
  assert.equal(outer(), true);
  assert.deepEqual(db.prepare('SELECT v FROM t').all().map((r) => r.v), ['outer']);
  assert.equal(db.inTransaction, false);
});

test('rule 29: a read-then-write transaction started while another connection writes waits for it', async (t) => {
  const { db, file } = fileDb(t);
  makeImmediateByDefault(db);
  const writer = holdWriteLock(file, "INSERT INTO t (v) VALUES ('other')");
  await writer.locked;
  const started = Date.now();
  db.transaction(() => {
    const n = db.prepare('SELECT COUNT(*) AS n FROM t').get().n;
    db.prepare('INSERT INTO t (v) VALUES (?)').run(`mine-${n}`);
  })();
  await writer.exited;
  assert.ok(Date.now() - started >= HOLD_MS - 100, 'it waited for the writer');
  assert.deepEqual(db.prepare('SELECT v FROM t ORDER BY id').all().map((r) => r.v), ['other', 'mine-1']);
});

test('rule 29: the stay write trail makes its connection immediate by default', async (t) => {
  const { db, file } = fileDb(t, { schema: true });
  install(db);
  const writer = holdWriteLock(file, "INSERT INTO clients (firstName, lastName) VALUES ('Other', 'Writer')");
  await writer.locked;
  db.transaction(() => {
    db.prepare('SELECT COUNT(*) AS n FROM clients').get();
    db.prepare("INSERT INTO clients (firstName, lastName) VALUES ('Mine', 'Writer')").run();
  })();
  await writer.exited;
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM clients').get().n, 2);
});

test('rule 29: the timed-options seed of a new property (read, then write) waits for a concurrent writer', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-immediate-seed-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'guestflow.db');
  // The application, in its own process, on the real database module.
  const code = `
    const db = require(${JSON.stringify(path.join(__dirname, '..', 'database.js'))});
    const id = Number(db.prepare("INSERT INTO properties (name) VALUES ('Le Gîte')").run().lastInsertRowid);
    db.prepare("DELETE FROM property_options WHERE optionId IN (SELECT id FROM options WHERE autoOptionType IN ('early_check_in', 'late_check_out'))").run();
    db.prepare("DELETE FROM options WHERE autoOptionType IN ('early_check_in', 'late_check_out')").run();
    console.log('ready');
    process.stdin.once('data', () => {
      try { db.ensureDefaultTimedOptionsForProperty(id); console.log('seeded'); } catch (err) { console.log('failed ' + err.code); }
      process.exit(0);
    });
  `;
  const app = spawn(process.execPath, ['-e', code], { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, DB_PATH: file } });
  t.after(() => app.kill());
  let output = '';
  const waitFor = (word) => new Promise((resolve) => {
    const check = () => { if (new RegExp(`^${word}$`, 'm').test(output)) resolve(); };
    app.stdout.on('data', (d) => { output += d; check(); });
    check();
  });
  await waitFor('ready');

  const other = new Database(file);
  t.after(() => other.close());
  other.exec('BEGIN IMMEDIATE');
  app.stdin.write('go\n');
  await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
  other.prepare("INSERT INTO clients (firstName, lastName) VALUES ('Other', 'Writer')").run();
  other.exec('COMMIT');
  await waitFor('seeded').catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.match(output, /seeded/, output);
  assert.doesNotMatch(output, /failed/);
});
