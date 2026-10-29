// specs/plugins-phase-3a-online-payment.md rule 29 (audit R2, F-R2-4) — a read-then-write transaction on a money
// path takes the write lock up front (BEGIN IMMEDIATE), so a writer holding it for a moment makes it
// wait for the busy timeout instead of failing at once with SQLITE_BUSY.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

const reservationsModelModule = require('../models/reservationsModel');
const { recordStayPayment } = require('../utils/stayPaymentRecorder');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const HOLD_MS = 400;

function fileDb(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-immediate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'main.db');
  const db = new Database(file);
  t.after(() => db.close());
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Jean', 'Dupont', 'jean@x.fr')").run();
  const id = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults,
      finalPrice, totalPrice, depositAmount, balanceAmount, platform)
    VALUES ('reservation', 1, 1, '2026-11-10', '2026-11-12', 2, 200, 200, 60, 140, 'direct')`).run().lastInsertRowid);
  return { db, file, id };
}

// A second connection, in another process, holds the write lock for HOLD_MS then commits a change.
function holdWriteLock(file) {
  const code = `
    const Database = require(${JSON.stringify(require.resolve('better-sqlite3'))});
    const db = new Database(${JSON.stringify(file)});
    db.exec('BEGIN IMMEDIATE');
    console.log('locked');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${HOLD_MS});
    db.prepare("UPDATE properties SET name = 'Gîte 2' WHERE id = 1").run();
    db.exec('COMMIT');
  `;
  const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
  const locked = new Promise((resolve) => child.stdout.once('data', resolve));
  const exited = new Promise((resolve) => child.on('exit', resolve));
  return { locked, exited };
}

test('rule 29: recording a stay payment waits for a concurrent writer instead of failing', async (t) => {
  const { db, file, id } = fileDb(t);
  const writer = holdWriteLock(file);
  await writer.locked;

  const started = Date.now();
  const { flipped } = recordStayPayment({ db, reservationsModel: reservationsModelModule.create(db) },
    { reservationId: id, bucket: 'deposit', paidDate: '2026-10-01' });
  await writer.exited;

  assert.deepEqual(flipped, ['deposit']);
  assert.ok(Date.now() - started >= HOLD_MS / 2, 'it waited for the other writer');
  assert.equal(db.prepare('SELECT depositPaid FROM reservations WHERE id = ?').get(id).depositPaid, 1);
});

test('rule 29: the connection waits for the lock (busy timeout is set) while a deferred read-then-write would fail', async (t) => {
  const { db, file } = fileDb(t);
  assert.ok(db.pragma('busy_timeout', { simple: true }) >= 1000);
  const writer = holdWriteLock(file);
  await writer.locked;
  assert.throws(() => db.transaction(() => {
    db.prepare('SELECT * FROM properties').all();
    db.prepare("UPDATE properties SET name = 'x' WHERE id = 1").run();
  })(), /database is locked/);
  await writer.exited;
});
