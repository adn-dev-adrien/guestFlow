// specs/plugins-phase-3a-online-payment.md rule 33 — the public /status of a converted devis settles a link
// GuestFlow retired but the guest paid anyway, so the double payment is flagged at once.

process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database');
const paymentProviders = require('../utils/paymentProviders');
const paymentLinksModel = require('../models/paymentLinksModel');
const devisModel = require('../models/devisModel');
const { status } = require('../controllers/public/publicPaymentController');

test('rule 33: /status flags the payment of a retired devis link as a double payment', async () => {
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'J', 'D', 'j@x.fr')").run();
  const dv = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, finalPrice, depositAmount, balanceAmount, devisStatus, requestOrigin, publicToken)
    VALUES ('devis', 1, 1, '2027-05-10', '2027-05-14', 1, 455.36, 100, 355.36, 'draft', 'public', 'tok')`).run().lastInsertRowid);
  const links = paymentLinksModel.buildModel(db);
  const F = links.create({ reservationId: dv, type: 'full', amountCents: 45536, provider: 'qonto', providerLinkId: 'F', url: 'u', status: 'open' });
  const rid = devisModel.buildModel(db).convertToReservation(dv).data.reservationId;
  const F2 = links.create({ reservationId: rid, type: 'full', amountCents: 45536, provider: 'qonto', providerLinkId: 'F2', url: 'u2', status: 'open' });
  const fake = { id: 'qonto', async getPayment(pid) { return { paid: true, paymentId: `p${pid}`, paidAt: '2027-04-01T10:00:00Z' }; }, async getLinkStatus() { return 'open'; }, async cancelLink() {} };
  const { processPaidLink } = require('../utils/paymentPollRunner');
  await processPaidLink({ database: db, devisModel: devisModel.buildModel(db), paymentLinksModel: links, link: links.findById(F2.id),
    paidPayment: { paid: true, paymentId: 'pF2', paidAt: '2027-04-01T09:00:00Z' }, emitPluginEvent: () => {} });
  assert.equal(links.findById(F.id).status, 'cancelled');

  const original = paymentProviders.declared;
  paymentProviders.declared = () => fake;
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  try { await status({ params: { id: String(dv) }, query: { token: 'tok' }, headers: {}, get: () => undefined }, res); } finally { paymentProviders.declared = original; }

  assert.equal(links.findById(F.id).status, 'paid');
  const owed = db.prepare("SELECT COUNT(*) n FROM reservation_history WHERE changedFields LIKE '%refundOwed%'").get().n;
  assert.equal(owed, 1);
});
