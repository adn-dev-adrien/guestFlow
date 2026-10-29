// specs/reservation-fiche-concurrency.md rule 6 — a write that reaches stays from outside
// /api/reservations/:id (bank reconciliation, payment poll) answers with the stays it moved.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { stayVersionsTrail, HEADER } = require('../middleware/stayVersionsTrail');

function fresh() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE reservations (id INTEGER PRIMARY KEY, updatedAt TEXT);
    INSERT INTO reservations VALUES (1, '2099-01-01 10:00:00'), (2, '2099-01-01 10:00:00'), (3, '2099-01-01 10:00:00')`);
  return db;
}

function run(db, { method = 'POST', write = () => {} } = {}) {
  const headers = {};
  const res = { headersSent: false, set(k, v) { headers[k] = v; }, json(body) { this.body = body; return this; } };
  let called = false;
  stayVersionsTrail(db)({ method }, res, () => { called = true; });
  assert.ok(called, 'always continues');
  write();
  res.json({ ok: true });
  return headers;
}

const bump = (db, id, at) => db.prepare('UPDATE reservations SET updatedAt = ? WHERE id = ?').run(at, id);

test('rule 6 — the stays a write moved are listed with their version before and after', () => {
  const db = fresh();
  const headers = run(db, { write: () => { bump(db, 1, '2099-01-01 10:05:00'); bump(db, 3, '2099-01-01 10:06:00'); } });
  assert.deepEqual(JSON.parse(headers[HEADER]), [
    { id: 1, before: '2099-01-01 10:00:00', after: '2099-01-01 10:05:00' },
    { id: 3, before: '2099-01-01 10:00:00', after: '2099-01-01 10:06:00' },
  ]);
});

test('rule 6 — a write that moved no stay, and a read, carry no header', () => {
  const db = fresh();
  assert.deepEqual(run(db), {});
  assert.deepEqual(run(db, { method: 'GET', write: () => bump(db, 1, '2099-01-02 00:00:00') }), {});
});
