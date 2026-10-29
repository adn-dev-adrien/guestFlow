// specs/plugins-phase-3a-online-payment.md rules 36 and 38 — the public /status makes few provider calls
// for a retired link, and answers `confirmed` when its own call converted the devis.

process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database');
const paymentProviders = require('../utils/paymentProviders');
const paymentLinksModel = require('../models/paymentLinksModel');
const devisModel = require('../models/devisModel');
const { status } = require('../controllers/public/publicPaymentController');

db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'J', 'D', 'j@x.fr')").run();
const links = paymentLinksModel.buildModel(db);
const mkDevis = (tok, start = '2027-05-10', end = '2027-05-14') => Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, finalPrice, depositAmount, balanceAmount, devisStatus, requestOrigin, publicToken)
  VALUES ('devis', 1, 1, ?, ?, 1, 455.36, 100, 355.36, 'draft', 'public', ?)`).run(start, end, tok).lastInsertRowid);
const call = async (id, token) => {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await status({ params: { id: String(id) }, query: { token }, headers: {}, get: () => undefined }, res);
  return res;
};
async function withProvider(fake, work) {
  const original = paymentProviders.declared;
  paymentProviders.declared = () => fake;
  try { return await work(); } finally { paymentProviders.declared = original; }
}

test('rule 36: five /status calls with a failing provider make at most one provider call', async () => {
  const dv = mkDevis('tokA');
  const F = links.create({ reservationId: dv, type: 'full', amountCents: 45536, provider: 'qonto', providerLinkId: 'FA', url: 'u', status: 'open' });
  devisModel.buildModel(db).convertToReservation(dv);
  links.cancel(F.id, { remotePending: true });
  let gets = 0;
  const fake = { id: 'qonto', async getPayment() { gets += 1; throw new Error('boom'); }, async getLinkStatus() { throw new Error('boom'); }, async cancelLink() { throw new Error('boom'); } };
  await withProvider(fake, async () => { for (let i = 0; i < 5; i += 1) await call(dv, 'tokA'); });
  assert.ok(gets <= 1, `provider read ${gets} times`);
});

test('rule 38: /status answers confirmed when the retried link converted the devis', async () => {
  const dv = mkDevis('tokB', '2027-09-10', '2027-09-14');
  links.create({ reservationId: dv, type: 'full', amountCents: 45536, provider: 'qonto', providerLinkId: 'FB', url: 'u', status: 'open' });
  const retired = links.retireForAmountChange(dv, 'full', 99999);
  assert.equal(retired.length, 1);
  const fake = { id: 'qonto', async getPayment() { return { paid: true, paymentId: 'pFB', paidAt: '2027-04-01T10:00:00Z' }; }, async getLinkStatus() { return 'open'; }, async cancelLink() {} };
  const res = await withProvider(fake, () => call(dv, 'tokB'));
  assert.equal(res.body.status || (res.body.data && res.body.data.status), 'confirmed');
  assert.ok(db.prepare('SELECT convertedReservationId FROM reservations WHERE id = ?').get(dv).convertedReservationId);
});
