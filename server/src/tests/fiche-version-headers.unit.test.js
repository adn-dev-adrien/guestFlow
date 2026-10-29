// specs/reservation-fiche-concurrency.md rule 4 — a write on a stay answers with its version before and
// after, so the open fiche can tell its own writes from a foreign one.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { ficheVersionHeaders, BEFORE, AFTER } = require('../middleware/ficheVersionHeaders');

function fresh() {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE reservations (id INTEGER PRIMARY KEY, updatedAt TEXT); INSERT INTO reservations VALUES (7, '2099-01-01 10:00:00')");
  return db;
}

function run(db, { method = 'PATCH', id = '7', write = () => {} } = {}) {
  const headers = {};
  const res = { headersSent: false, set(k, v) { headers[k] = v; }, json(body) { this.body = body; return this; } };
  let called = false;
  ficheVersionHeaders(db)({ method, params: { id } }, res, () => { called = true; });
  assert.ok(called, 'always continues');
  write();
  res.json({ ok: true });
  return headers;
}

test('rule 4 — a write carries the version before the handler and the one when the answer leaves', () => {
  const db = fresh();
  const headers = run(db, { write: () => db.prepare("UPDATE reservations SET updatedAt = '2099-01-01 10:05:00' WHERE id = 7").run() });
  assert.equal(headers[BEFORE], '2099-01-01 10:00:00');
  assert.equal(headers[AFTER], '2099-01-01 10:05:00');
});

test('rule 4 — a read, a non-numeric id and an unknown stay carry no version', () => {
  const db = fresh();
  assert.deepEqual(run(db, { method: 'GET' }), {});
  assert.deepEqual(run(db, { id: 'suggest-beds' }), {});
  assert.deepEqual(run(db, { id: '999' }), {});
});
