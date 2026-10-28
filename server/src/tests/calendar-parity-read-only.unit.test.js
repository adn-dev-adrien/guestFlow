// specs/calendar-property-parity.md rules 22, 25 — a duplicate set aside takes no write: every route that writes
// to a stay (the fiche save, a payment mark, the check-in and check-out, an arrival payment, a refund, an
// installment, a payment link, an e-mail) answers 409 RESERVATION_SUPERSEDED, and nothing is written.
// A cancelled stay keeps the writes its history needs (specs/payment-schedule-and-cancellation.md rule 25):
// the fiche, the payment marks, the SAS, the arrival payment and the payment links stay refused, a refund and
// the cancellation e-mails stay possible.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const db = require('../database');
const sasController = require('../plugins/sas/controller');

db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Granja')").run();
db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Camille', 'Martin', 'camille@example.com')").run();
const stay = (id, kind) => db.prepare(`INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate, platform, adults, finalPrice, totalPrice, reservationNumber)
  VALUES (?, ?, 1, 1, '2099-04-13', '2099-04-17', 'direct', 2, 300, 300, ?)`).run(id, kind, `2099${id}`);
stay(1, 'superseded');
stay(2, 'cancelled');
stay(3, 'reservation');
const TEMPLATE_ID = db.prepare('SELECT id FROM email_templates ORDER BY id LIMIT 1').get().id;

const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: 1, roles: ['admin'] }; next(); });
app.use('/api/reservations', require('../routes/reservations'));
app.use('/api/payments', require('../routes/payments'));
app.use('/api/emails', require('../routes/emails'));
app.use('/api/dashboard', require('../routes/dashboard'));
// The SAS routes belong to a plugin: its controller is mounted here the way the plugin registers it.
for (const [suffix, handler] of [['arrival', 'commitArrival'], ['arrival/preview', 'previewArrival'], ['departure', 'commitDeparture'], ['departure/preview', 'previewDeparture']]) {
  app.post(`/api/reservations/:id/sas/${suffix}`, (req, res) => sasController[handler](req, res));
}
let server;
let base;
test.before(async () => {
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const call = async (method, path, body) => {
  const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const writes = () => JSON.stringify(db.prepare('SELECT id, checkInDone, checkOutDone, arrivalSasDoneAt, departureSasDoneAt, balancePaid, depositPaid, updatedAt FROM reservations ORDER BY id').all());

const PATHS = [
  ['PUT', (id) => `/api/reservations/${id}`, { startDate: '2099-04-13', endDate: '2099-04-17' }],
  ['PATCH', (id) => `/api/reservations/${id}/payment`, { balancePaid: true }],
  ['POST', (id) => `/api/reservations/${id}/sas/arrival`, {}],
  ['POST', (id) => `/api/reservations/${id}/sas/arrival/preview`, {}],
  ['POST', (id) => `/api/reservations/${id}/sas/departure`, {}],
  ['POST', (id) => `/api/reservations/${id}/sas/departure/preview`, {}],
  ['POST', (id) => `/api/reservations/${id}/arrival-payment`, { mode: 'card', date: '2099-04-13' }],
  ['POST', (id) => `/api/reservations/${id}/refunds`, { totalTtc: 10, refundDate: '2099-04-20' }],
  ['PUT', (id) => `/api/reservations/${id}/installments`, { count: 2 }],
  ['DELETE', (id) => `/api/reservations/${id}/installments`],
  ['POST', (id) => `/api/reservations/${id}/installments/1/payment`, { paidDate: '2099-04-01', method: 'card' }],
  ['POST', (id) => `/api/reservations/${id}/cancel`, { reason: 'x' }],
  ['POST', (id) => `/api/payments/reservations/${id}/payment-links`, { type: 'deposit' }],
  ['POST', (id) => `/api/payments/reservations/${id}/payment-emails`, { type: 'deposit' }],
  ['POST', () => '/api/emails/send', { reservationId: 1, templateId: TEMPLATE_ID }],
  ['POST', () => '/api/emails/queue', { reservationId: 1, templateId: TEMPLATE_ID }],
  ['POST', () => `/api/emails/pending/${TEMPLATE_ID}/1/mark-sent`],
  ['POST', () => `/api/emails/pending/${TEMPLATE_ID}/1/acknowledge`],
  ['POST', (id) => `/api/dashboard/payment-deadlines/${id}/snooze`, { days: 7 }],
  ['POST', (id) => `/api/dashboard/payment-deadlines/${id}/remind`, { type: 'balance' }],
];

test('rule 25 — every write on a duplicate set aside answers 409 RESERVATION_SUPERSEDED and writes nothing', async () => {
  const before = writes();
  for (const [method, path, body] of PATHS) {
    const res = await call(method, path(1), body);
    assert.equal(res.status, 409, `${method} ${path(1)} → ${res.status} ${JSON.stringify(res.body)}`);
    assert.equal(res.body.code, 'RESERVATION_SUPERSEDED', `${method} ${path(1)}`);
  }
  assert.equal(writes(), before);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM email_log').get().c, 0, 'no e-mail left');
});

test('rule 22 — the same writes on a live stay are not refused by the guard', async () => {
  for (const [method, path, body] of PATHS.slice(0, 2)) {
    const res = await call(method, path(3), body);
    assert.notEqual(res.body.code, 'RESERVATION_SUPERSEDED');
  }
  const sas = await call('POST', '/api/reservations/3/sas/arrival', {});
  assert.notEqual(sas.body.code, 'RESERVATION_SUPERSEDED', 'a live stay is not refused by the SAS');
});

test('rule 25 — a cancelled stay stays read-only for the fiche, the payment marks, the SAS, the arrival payment and the links', async () => {
  const closed = [0, 1, 2, 3, 4, 5, 6, 12, 13, 19];
  for (const i of closed) {
    const [method, path, body] = PATHS[i];
    const res = await call(method, path(2), body);
    assert.equal(res.status, 409, `${method} ${path(2)} → ${res.status}`);
    assert.equal(res.body.code, 'RESERVATION_CANCELLED', `${method} ${path(2)}`);
  }
});

test('rule 25 — a cancelled stay keeps the writes its history needs: a refund, and the cancellation e-mail', async () => {
  const refund = await call(...[PATHS[7][0], PATHS[7][1](2), PATHS[7][2]]);
  assert.notEqual(refund.body.code, 'RESERVATION_CANCELLED');
  const queued = await call('POST', '/api/emails/queue', { reservationId: 2, templateId: TEMPLATE_ID });
  assert.notEqual(queued.body.code, 'RESERVATION_CANCELLED');
});

test('rule 25 — the payment service itself refuses a link or a request on a duplicate or a cancelled stay, whoever calls it', async () => {
  const service = require('../utils/paymentRequestService');
  const deps = { database: db, paymentLinksModel: {}, resolveAmountCents: () => 1000, provider: { createLink() { throw new Error('provider must not be called'); } }, sendTemplate() { throw new Error('no mail'); } };
  for (const [id, code] of [[1, 'RESERVATION_SUPERSEDED'], [2, 'RESERVATION_CANCELLED']]) {
    await assert.rejects(() => service.ensurePaymentLink(deps, id, 'balance'), (e) => e.httpStatus === 409 && e.error === code);
    const sent = await service.sendPaymentRequest(deps, id, 'balance');
    assert.equal(sent.httpStatus, 409);
    assert.equal(sent.body.error, code);
  }
});
