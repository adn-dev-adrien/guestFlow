require('./isolatedDb');
// Adrien's decision D18 (2026-11-05), specs/public-api.md rule 9 and specs/public-request-abuse-and-grouping.md rule 6
// (readings of 2026-11-05): a booking request refused for its input (422) gives its hit back to the 5-per-hour budget.
// Everything else still spends it, and the broad limit and the proof of work stand. Real router, limiters and controller.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const API_KEY = 'refused-form-budget-key';
process.env.PUBLIC_API_KEY = API_KEY;
process.env.PUBLIC_API_RATELIMIT_MAX = '30';
delete process.env.BOOKING_REQUEST_RATELIMIT_MAX;

const db = require('../../../database');
const settings = require('../settings');

settings.termsSettings = () => ({ requireTermsAcceptance: false });
const requestStore = require('../requestStore');
const challenge = require('../challenge');

const pad = (n) => String(n).padStart(2, '0');
const localDay = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const propertyId = db.prepare("INSERT INTO properties (name, maxGuests) VALUES ('Gîte', 6)").run().lastInsertRowid;
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight, dateRanges, minNights) VALUES (?, 'An', 100, ?, 1)")
  .run(propertyId, JSON.stringify([{ startDate: localDay(0), endDate: localDay(400) }]));

let server;
let baseUrl;
let mail = 0;

before(async () => {
  const express = require('express');
  const app = express();
  app.use(express.json());
  require('../routes').buildPublicMounts().forEach(({ path, router }) => app.use(path, router));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

function post(visitorIp, { guest = {}, ...fields } = {}) {
  mail += 1;
  return fetch(`${baseUrl}/public/v1/booking-requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}`, 'x-guestflow-visitor-ip': visitorIp },
    body: JSON.stringify({
      propertyId,
      startDate: localDay(30 + mail),
      endDate: localDay(33 + mail),
      adults: 2,
      guest: { firstName: 'Zoé', lastName: 'Martin', email: `budget${mail}@example.test`, phone: '0612345678', ...guest },
      ...fields,
    }),
  });
}

test('D18 — five refused forms, then the corrected one is sent', async () => {
  for (let i = 0; i < 5; i += 1) {
    const refused = await post('198.51.100.1', { guest: { firstName: `Jean${i}` } });
    assert.equal(refused.status, 422);
    assert.equal((await refused.json()).error.details[0].reason, 'nameInvalid');
  }
  assert.equal((await post('198.51.100.1')).status, 201);
});

test('D18 — a refused form never lowers what is left', async () => {
  for (let i = 0; i < 8; i += 1) assert.equal((await post('198.51.100.2', { guest: { email: 'nope' } })).status, 422);
  for (let i = 0; i < 5; i += 1) assert.equal((await post('198.51.100.2')).status, 201, `request ${i}`);
  assert.equal((await post('198.51.100.2')).status, 429);
});

test('D18 — the budget still holds: five stored requests, the sixth is refused', async () => {
  for (let i = 0; i < 5; i += 1) assert.equal((await post('198.51.100.3')).status, 201, `request ${i}`);
  const sixth = await post('198.51.100.3');
  assert.equal(sixth.status, 429);
  assert.equal((await sixth.json()).error.code, 'TOO_MANY_REQUESTS');
});

test('D18 — only a 422 gives its hit back: a 409 and a 403 still spend it', async () => {
  for (let i = 0; i < 5; i += 1) assert.equal((await post('198.51.100.4', { adults: 99 })).status, 409, `over capacity ${i}`);
  assert.equal((await post('198.51.100.4')).status, 429);
  for (let i = 0; i < 5; i += 1) assert.equal((await post('198.51.100.5', { challenge: {}, nonce: 'a' })).status, 403, `proof ${i}`);
  assert.equal((await post('198.51.100.5')).status, 429);
});

test('D18 — a refused form still counts for the proof of work', async () => {
  const ipKey = challenge.ipKeyOf('198.51.100.6');
  const before = requestStore.countRecent({ ipKey, windowMs: 3600000, now: Date.now() });
  for (let i = 0; i < 3; i += 1) assert.equal((await post('198.51.100.6', { guest: { firstName: 'Jean2' } })).status, 422);
  assert.equal(requestStore.countRecent({ ipKey, windowMs: 3600000, now: Date.now() }), before + 3);
});

test('D18 — the broad limit still bounds refused forms', async () => {
  for (let i = 0; i < 30; i += 1) assert.equal((await post('198.51.100.7', { guest: { firstName: 'Jean2' } })).status, 422, `try ${i}`);
  const over = await post('198.51.100.7', { guest: { firstName: 'Jean2' } });
  assert.equal(over.status, 429);
  assert.equal((await over.json()).error.code, 'TOO_MANY_REQUESTS');
});
