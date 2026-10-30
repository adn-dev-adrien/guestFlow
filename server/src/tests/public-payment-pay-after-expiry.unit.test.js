// specs/payment-link-lifecycle.md rule 29 — `pay` keeps its contract: a guest who comes back after the
// 36 hours and clicks « Payer » gets a fresh link, after the checks `pay` already makes; the lapsed one
// is never handed out again.

process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database');
const paymentProviders = require('../utils/paymentProviders');
const paymentLinksModel = require('../models/paymentLinksModel');
const { pay } = require('../controllers/public/publicPaymentController');

const HOUR = 60 * 60 * 1000;
const pid = Number(db.prepare("INSERT INTO properties (name, maxGuests) VALUES ('Gite', 6)").run().lastInsertRowid);
db.prepare(`INSERT INTO pricing_rules (propertyId, label, pricePerNight, dateRanges, minNights)
  VALUES (?, 'Saison', 100, ?, 1)`).run(pid, JSON.stringify([{ startDate: '2027-01-01', endDate: '2027-12-31' }]));
db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Test', 'Client', 'client@example.test')").run();
const links = paymentLinksModel.buildModel(db);

const devisId = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, finalPrice, depositAmount, balanceAmount, devisStatus, requestOrigin, publicToken)
  VALUES ('devis', ?, 1, '2027-05-10', '2027-05-14', 2, 400, 0, 400, 'draft', 'public', 'tok')`).run(pid).lastInsertRowid);

function provider() {
  const created = [];
  return {
    created,
    id: 'qonto',
    label: 'Qonto',
    errorCode: 'QONTO_API_ERROR',
    isReady: () => true,
    async createLink({ amountCents }) {
      created.push(amountCents);
      return { id: `new_${created.length}`, url: `https://pay.example.test/new/${created.length}`, status: 'open', expiresAt: '0001-01-01T00:00:00Z' };
    },
    async getPayment() { return { paid: false }; },
    async getLinkStatus() { return 'expired'; },
    async cancelLink() {},
  };
}

async function callPay(fake) {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  const original = paymentProviders.declared;
  paymentProviders.declared = () => fake;
  try {
    await pay({ params: { id: String(devisId) }, body: { token: 'tok' }, headers: {}, get: () => undefined }, res);
  } finally { paymentProviders.declared = original; }
  return res;
}

test('rule 29 — after the lapse, « Payer » mints a fresh link with its own 36 hours', async () => {
  const lapsed = links.create({ reservationId: devisId, type: 'full', amountCents: 40000, provider: 'qonto', providerLinkId: 'old', url: 'https://pay.example.test/old', status: 'open' });
  db.prepare("UPDATE payment_links SET status = 'expired', cancelReason = 'validity', expiresAt = ? WHERE id = ?")
    .run(new Date(Date.now() - 2 * HOUR).toISOString(), lapsed.id);
  const fake = provider();
  const res = await callPay(fake);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const data = res.body.data || res.body;
  assert.equal(data.paymentUrl, 'https://pay.example.test/new/1');
  assert.notEqual(data.paymentUrl, 'https://pay.example.test/old');
  const fresh = links.findOpenForReservation(devisId, data.paymentMode === 'deposit' ? 'deposit' : 'full');
  assert.ok(fresh, 'a new open link');
  const leftMs = Date.parse(fresh.expiresAt) - Date.now();
  assert.ok(leftMs > 35 * HOUR && leftMs <= 36 * HOUR, 'valid 36 h from now');
  assert.equal(links.findById(lapsed.id).status, 'expired', 'the lapsed link stays lapsed');
});

test('rule 29 — a second click within the 36 hours reuses that fresh link', async () => {
  const fake = provider();
  const res = await callPay(fake);
  assert.equal(res.statusCode, 200);
  assert.equal(fake.created.length, 0, 'no new link');
  assert.equal((res.body.data || res.body).paymentUrl, 'https://pay.example.test/new/1');
});
