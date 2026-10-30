// specs/payment-link-lifecycle.md rule 30 — the public /status sees a lapsed link: it reads the devis's
// latest `expired` link (at most once per 5 minutes, while its last look is pending or it lapsed less than
// 24 h ago) and books it if paid; a lapsed, unpaid link with none open answers the new value `expired`.

process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database');
const paymentProviders = require('../utils/paymentProviders');
const paymentLinksModel = require('../models/paymentLinksModel');
const { status } = require('../controllers/public/publicPaymentController');

const HOUR = 60 * 60 * 1000;
db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Test', 'Client', 'client@example.test')").run();
const links = paymentLinksModel.buildModel(db);

let seq = 0;
// Each devis on its own month, so converting one never conflicts with another.
function mkDevis() {
  seq += 1;
  const token = `tok${seq}`;
  const id = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, finalPrice, depositAmount, balanceAmount, devisStatus, requestOrigin, publicToken)
    VALUES ('devis', 1, 1, ?, ?, 1, 455.36, 100, 355.36, 'draft', 'public', ?)`).run(`2027-0${(seq % 9) + 1}-10`, `2027-0${(seq % 9) + 1}-14`, token).lastInsertRowid);
  return { id, token };
}

function lapsedLink(devisId, { lapsedHoursAgo = 2, lastLookAt = null, reason = 'validity', type = 'full' } = {}) {
  const row = links.create({ reservationId: devisId, type, amountCents: 45536, provider: 'qonto', providerLinkId: `L${devisId}-${seq}`, url: 'https://pay.example.test/x', status: 'open' });
  db.prepare("UPDATE payment_links SET status = 'expired', cancelReason = ?, expiresAt = ?, lastLookAt = ? WHERE id = ?")
    .run(reason, new Date(Date.now() - lapsedHoursAgo * HOUR).toISOString(), lastLookAt, row.id);
  return links.findById(row.id);
}

async function call(devis, provider) {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  const original = paymentProviders.declared;
  paymentProviders.declared = () => provider;
  try {
    await status({ params: { id: String(devis.id) }, query: { token: devis.token }, headers: {}, get: () => undefined }, res);
  } finally { paymentProviders.declared = original; }
  return (res.body && res.body.data) || res.body;
}

function provider({ paid = false } = {}) {
  const calls = [];
  return {
    calls,
    id: 'qonto',
    async getPayment(linkId) { calls.push(linkId); return paid ? { paid: true, paymentId: `p${linkId}`, paidAt: new Date().toISOString() } : { paid: false }; },
    async getLinkStatus() { return 'expired'; },
    async cancelLink() {},
  };
}

test('rule 30 — the latest link lapsed, unpaid, none open: /status answers expired', async () => {
  const devis = mkDevis();
  lapsedLink(devis.id);
  const fake = provider();
  const answer = await call(devis, fake);
  assert.equal(answer.status, 'expired');
  assert.equal(fake.calls.length, 1, 'read once: it lapsed less than 24 h ago');
});

test('rule 30 — a lapsed link paid at the provider is booked and the page confirms', async () => {
  const devis = mkDevis();
  const link = lapsedLink(devis.id);
  const answer = await call(devis, provider({ paid: true }));
  assert.equal(answer.status, 'confirmed');
  assert.equal(links.findById(link.id).status, 'paid');
  assert.ok(db.prepare('SELECT convertedReservationId FROM reservations WHERE id = ?').get(devis.id).convertedReservationId);
});

test('rule 30 — the lapsed link is read at most once per 5 minutes while the guest waits', async () => {
  const devis = mkDevis();
  lapsedLink(devis.id);
  const fake = provider();
  for (let i = 0; i < 4; i += 1) assert.equal((await call(devis, fake)).status, 'expired');
  assert.equal(fake.calls.length, 1);
});

test('rule 30 — lapsed more than 24 h ago with no last look pending: no provider call, still expired', async () => {
  const devis = mkDevis();
  lapsedLink(devis.id, { lapsedHoursAgo: 30 });
  const fake = provider();
  assert.equal((await call(devis, fake)).status, 'expired');
  assert.equal(fake.calls.length, 0);
});

test('rule 30 — a pending last look keeps the read alive past 24 h', async () => {
  const devis = mkDevis();
  lapsedLink(devis.id, { lapsedHoursAgo: 30, lastLookAt: new Date(Date.now() + HOUR).toISOString() });
  const fake = provider();
  await call(devis, fake);
  assert.equal(fake.calls.length, 1);
});

test('rule 30 — a stay-started lapse is read the same way', async () => {
  const devis = mkDevis();
  lapsedLink(devis.id, { reason: 'stay-started' });
  const fake = provider();
  assert.equal((await call(devis, fake)).status, 'expired');
  assert.equal(fake.calls.length, 1);
});

test('rule 30 — an open link wins: a fresh link after the lapse keeps the page pending', async () => {
  const devis = mkDevis();
  lapsedLink(devis.id);
  links.create({ reservationId: devis.id, type: 'full', amountCents: 45536, provider: 'qonto', providerLinkId: `O${devis.id}`, url: 'u', status: 'open' });
  assert.equal((await call(devis, provider())).status, 'pending');
});

test('rule 30 — a withdrawn latest link is not an expiry', async () => {
  const devis = mkDevis();
  lapsedLink(devis.id);
  const withdrawn = links.create({ reservationId: devis.id, type: 'full', amountCents: 45536, provider: 'qonto', providerLinkId: `W${devis.id}`, url: 'u', status: 'open' });
  links.cancel(withdrawn.id);
  assert.equal((await call(devis, provider())).status, 'pending');
});

test('rule 30 — a devis that never had a link stays pending', async () => {
  const devis = mkDevis();
  assert.equal((await call(devis, provider())).status, 'pending');
});
