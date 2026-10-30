// specs/reservation-fiche-concurrency.md rule 8 — a write that reaches stays from outside
// /api/reservations/:id (bank reconciliation, payment poll) answers with the stays THIS request wrote, and
// never with a foreign write that landed while the handler awaited.
const { listenLocal } = require('./listenLocal');
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const Database = require('better-sqlite3');

const { stayVersionsTrail, HEADER } = require('../middleware/stayVersionsTrail');

function fresh() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE reservations (id INTEGER PRIMARY KEY, updatedAt TEXT);
    INSERT INTO reservations VALUES (1, 'v0'), (2, 'w0'), (3, 'x0')`);
  return db;
}

async function serve(db, routes) {
  const app = express();
  app.use('/api/payments', stayVersionsTrail(db));
  routes(app);
  const server = await listenLocal(app);
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => { server.closeAllConnections(); server.close(); } };
}

const set = (db, id, at) => db.prepare('UPDATE reservations SET updatedAt = ? WHERE id = ?').run(at, id);

test('rule 8 — the stays this request wrote are listed with their version before and after', async () => {
  const db = fresh();
  const { base, close } = await serve(db, (app) => app.post('/api/payments/links', (req, res) => { set(db, 1, 'v1'); set(db, 3, 'x1'); set(db, 1, 'v2'); res.json({}); }));
  const res = await fetch(`${base}/api/payments/links`, { method: 'POST' });
  close();
  assert.deepEqual(JSON.parse(res.headers.get(HEADER)), [{ id: 1, before: 'v0', after: 'v2' }, { id: 3, before: 'x0', after: 'x1' }]);
});

test('rule 8 — a foreign write during an awaiting handler is not reported as this request\'s own', async () => {
  const db = fresh();
  const { base, close } = await serve(db, (app) => {
    app.post('/api/payments/poll', async (req, res) => { await new Promise((r) => setTimeout(r, 200)); set(db, 2, 'w1'); res.json({}); });
    app.put('/api/reservations/1', (req, res) => { set(db, 1, 'v1'); res.json({}); });
  });
  const pending = fetch(`${base}/api/payments/poll`, { method: 'POST' });
  await new Promise((r) => setTimeout(r, 60));
  await fetch(`${base}/api/reservations/1`, { method: 'PUT' });
  const res = await pending;
  close();
  assert.deepEqual(JSON.parse(res.headers.get(HEADER)), [{ id: 2, before: 'w0', after: 'w1' }]);
});

test('rule 8 — a write that moved no stay, and a read, carry no header', async () => {
  const db = fresh();
  const { base, close } = await serve(db, (app) => {
    app.post('/api/payments/noop', (req, res) => res.json({}));
    app.get('/api/payments/read', (req, res) => { set(db, 1, 'v9'); res.json({}); });
  });
  assert.equal((await fetch(`${base}/api/payments/noop`, { method: 'POST' })).headers.get(HEADER), null);
  assert.equal((await fetch(`${base}/api/payments/read`)).headers.get(HEADER), null);
  close();
});

test('rule 8 — two writes of one request with a foreign write between them drop the stay (broken chain)', async () => {
  const db = fresh();
  const { base, close } = await serve(db, (app) => {
    app.post('/api/payments/emails', async (req, res) => { set(db, 1, 'v1'); await new Promise((r) => setTimeout(r, 200)); set(db, 1, 'v3'); set(db, 2, 'w1'); res.json({}); });
    app.put('/api/reservations/1', (req, res) => { set(db, 1, 'v2'); res.json({}); });
  });
  const pending = fetch(`${base}/api/payments/emails`, { method: 'POST' });
  await new Promise((r) => setTimeout(r, 60));
  await fetch(`${base}/api/reservations/1`, { method: 'PUT' });
  const res = await pending;
  close();
  assert.deepEqual(JSON.parse(res.headers.get(HEADER)), [{ id: 2, before: 'w0', after: 'w1' }]);
});

test('rule 8 — a write rolled back with its transaction is never reported, a committed one is', async () => {
  const db = fresh();
  const { base, close } = await serve(db, (app) => app.post('/api/payments/tx', (req, res) => {
    try { db.transaction(() => { set(db, 1, 'v1'); throw new Error('boom'); })(); } catch { /* rolled back */ }
    db.transaction(() => { set(db, 2, 'w1'); })();
    res.json({});
  }));
  const res = await fetch(`${base}/api/payments/tx`, { method: 'POST' });
  close();
  assert.deepEqual(JSON.parse(res.headers.get(HEADER)), [{ id: 2, before: 'w0', after: 'w1' }]);
});

test('rule 8 — a row left by a commit the wrapper did not see is never attributed to the next request', async () => {
  const db = fresh();
  const { base, close } = await serve(db, (app) => app.post('/api/payments/links', (req, res) => { set(db, 2, 'w1'); res.json({}); }));
  db.prepare('BEGIN').run();
  set(db, 1, 'v1'); // inside a manual transaction: not drained
  db.prepare('COMMIT').run(); // the wrapper does not see the commit: the row stays behind
  const res = await fetch(`${base}/api/payments/links`, { method: 'POST' });
  close();
  assert.deepEqual(JSON.parse(res.headers.get(HEADER)), [{ id: 2, before: 'w0', after: 'w1' }]);
});
