// specs/reservation-fiche-concurrency.md rule 10 — the fiche's version pair is this request's own writes,
// never a snapshot around the handler: a foreign write landing during a provider await is not adopted.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const Database = require('better-sqlite3');

const { ficheVersionHeaders, BEFORE, AFTER } = require('../middleware/ficheVersionHeaders');

async function serve(handler) {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE reservations (id INTEGER PRIMARY KEY, updatedAt TEXT, note TEXT); INSERT INTO reservations VALUES (1, 'v0', ''), (2, 'w0', '')");
  const app = express();
  const router = express.Router();
  router.use('/:id', ficheVersionHeaders(db));
  router.put('/:id', (req, res) => handler(db, req, res));
  app.use('/api/reservations', router);
  const server = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  return { db, base: `http://127.0.0.1:${server.address().port}/api/reservations`, close: () => server.close() };
}

const set = (db, id, at, note = '') => db.prepare('UPDATE reservations SET updatedAt = ?, note = ? WHERE id = ?').run(at, note, id);
const deferred = () => { let resolve; const promise = new Promise((ok) => { resolve = ok; }); return { promise, resolve }; };

test('rule 10 — a foreign write during an awaited provider call is not adopted: the next save is refused', async () => {
  const ownWritten = deferred();
  const foreignWritten = deferred();
  const { db, base, close } = await serve(async (d, req, res) => { set(d, 1, 'v1'); ownWritten.resolve(); await foreignWritten.promise; res.json({}); });
  const pending = fetch(`${base}/1`, { method: 'PUT' });
  await ownWritten.promise;
  set(db, 1, 'v2', 'intake fill');
  foreignWritten.resolve();
  const res = await pending;
  close();
  assert.equal(res.headers.get(BEFORE), 'v0');
  assert.equal(res.headers.get(AFTER), 'v1');
  assert.equal(db.prepare('SELECT updatedAt FROM reservations WHERE id = 1').get().updatedAt, 'v2');
});

test('rule 10 — an own write followed by an await with no foreign write still carries its pair', async () => {
  const { base, close } = await serve(async (d, req, res) => { set(d, 1, 'v1'); await Promise.resolve(); res.json({}); });
  const res = await fetch(`${base}/1`, { method: 'PUT' });
  close();
  assert.equal(res.headers.get(BEFORE), 'v0');
  assert.equal(res.headers.get(AFTER), 'v1');
});

test('rule 10 — a write to another stay is not this stay\'s version', async () => {
  const { base, close } = await serve(async (d, req, res) => { set(d, 2, 'w1'); res.json({}); });
  const res = await fetch(`${base}/1`, { method: 'PUT' });
  close();
  assert.equal(res.headers.get(BEFORE), null);
});
