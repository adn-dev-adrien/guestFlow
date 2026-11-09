// specs/reservations-backend-mvc.md rule 25 (audit R30-RES-L1) — a devis id on a stay write answers what
// GET /reservations/:id answers, 404 « Réservation non trouvée », and nothing is written: an open draft is
// never marked paid nor re-saved through the stay pipeline, a converted quote keeps its frozen figures.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const { listenLocal } = require('./listenLocal');
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate: addDaysIso } = require('../utils/devisHelpers');

const db = require('../database');

const start = addDaysIso(todayIso(), 60);
const end = addDaysIso(todayIso(), 63);
db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Granja')").run();
db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Camille', 'Martin', 'camille@example.com')").run();
const row = (id, kind, devisStatus) => db.prepare(`INSERT INTO reservations (id, kind, devisStatus, clientId, propertyId, startDate, endDate, platform, adults, finalPrice, totalPrice, reservationNumber)
  VALUES (?, ?, ?, 1, 1, ?, ?, 'direct', 2, 300, 300, ?)`).run(id, kind, devisStatus, start, end, kind === 'devis' ? null : `R${id}`);
row(1, 'devis', 'draft');
row(2, 'devis', 'converted');
row(3, 'reservation', null);

const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: 1, roles: ['admin'] }; next(); });
app.use('/api/reservations', require('../routes/reservations'));
let server;
let base;
test.before(async () => {
  server = await listenLocal(app);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.closeAllConnections(); server.close(); });

const call = async (method, path, body) => {
  const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(10_000), method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const snapshot = () => JSON.stringify(db.prepare('SELECT * FROM reservations WHERE kind = ? ORDER BY id').all('devis'))
  + JSON.stringify(db.prepare('SELECT COUNT(*) c FROM reservation_history').get());

const save = { propertyId: 1, clientId: 1, startDate: start, endDate: end, adults: 4, platform: 'direct' };
const PATHS = [
  ['PUT', (id) => `/api/reservations/${id}`, save],
  ['PATCH', (id) => `/api/reservations/${id}/payment`, { balancePaid: true }],
  ['PATCH', (id) => `/api/reservations/${id}/payment`, { complementDeferredToCheckout: true }],
  ['POST', (id) => `/api/reservations/${id}/arrival-payment`, { mode: 'card', date: todayIso() }],
  ['DELETE', (id) => `/api/reservations/${id}/installments`],
  ['POST', (id) => `/api/reservations/${id}/platform-penalties/preview`, { amount: 10 }],
  ['POST', (id) => `/api/reservations/${id}/platform-penalties`, { amount: 10, date: todayIso() }],
  ['DELETE', (id) => `/api/reservations/${id}/platform-penalties/1`],
];

test('rule 25 — an open draft devis id on a stay write: 404 « Réservation non trouvée », nothing written', async () => {
  const before = snapshot();
  for (const [method, path, body] of PATHS) {
    const res = await call(method, path(1), body);
    assert.equal(res.status, 404, `${method} ${path(1)} → ${res.status} ${JSON.stringify(res.body)}`);
    assert.equal(res.body.error, 'Réservation non trouvée', `${method} ${path(1)}`);
  }
  assert.equal(snapshot(), before);
});

test('rule 25 — a converted devis keeps its frozen party: the stay save answers 404, not 200', async () => {
  const before = snapshot();
  for (const [method, path, body] of PATHS) {
    const res = await call(method, path(2), body);
    assert.equal(res.status, 404, `${method} ${path(2)} → ${res.status}`);
  }
  assert.equal(db.prepare('SELECT adults FROM reservations WHERE id = 2').get().adults, 2);
  assert.equal(snapshot(), before);
});

test('rule 25 — the read answers the same 404, and a stay id is not refused by the guard', async () => {
  assert.equal((await call('GET', '/api/reservations/1')).status, 404);
  const res = await call('PATCH', '/api/reservations/3/payment', { complementDeferredToCheckout: true });
  assert.notEqual(res.status, 404, JSON.stringify(res.body));
  const unknown = await call('PATCH', '/api/reservations/999/payment', { balancePaid: true });
  assert.equal(unknown.status, 404);
});
