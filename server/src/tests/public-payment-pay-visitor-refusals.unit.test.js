// specs/payment-link-lifecycle.md rule 54 (audit R8 public L-1) — the public `pay` answers the site's visitor
// in the visitor's language. GuestFlow's own refusals on the reuse path (a link older than 12 h is read at
// the provider first, rule 8) are operator sentences: they are mapped to visitor keys, never passed through.

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

let seq = 0;
function freshDevis() {
  seq += 1;
  return Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, finalPrice, depositAmount, balanceAmount, devisStatus, requestOrigin, publicToken)
    VALUES ('devis', ?, 1, ?, ?, 2, 400, 0, 400, 'draft', 'public', 'tok')`).run(pid, `2027-0${seq + 1}-10`, `2027-0${seq + 1}-14`).lastInsertRowid);
}

function provider({ getPayment }) {
  return {
    id: 'qonto', label: 'Qonto', errorCode: 'QONTO_API_ERROR', isReady: () => true,
    async createLink() { return { id: `new_${seq}`, url: `https://pay.example.test/new/${seq}`, status: 'open' }; },
    getPayment,
    async getLinkStatus() { return 'open'; },
    async cancelLink() {},
  };
}

async function callPay(devisId, fake, lang) {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  const original = paymentProviders.declared;
  paymentProviders.declared = () => fake;
  try {
    await pay({ params: { id: String(devisId) }, body: { token: 'tok', lang }, query: { lang }, headers: {}, get: () => undefined }, res);
  } finally { paymentProviders.declared = original; }
  return res;
}

// A first « Payer » minted the link 13 h ago: the re-click reads it at the provider before replacing it.
async function agedLink(devisId) {
  const first = await callPay(devisId, provider({ getPayment: async () => ({ paid: false }) }), 'en');
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  const ago = new Date(Date.now() - 13 * HOUR);
  db.prepare('UPDATE payment_links SET createdAt = ?, expiresAt = ? WHERE reservationId = ?')
    .run(ago.toISOString().replace('T', ' ').slice(0, 19), new Date(ago.getTime() + 36 * HOUR).toISOString(), devisId);
}

const down = provider({ getPayment: async () => { throw new Error('ECONNRESET'); } });
const paid = provider({ getPayment: async () => ({ paid: true, paymentId: 'pp', paidAt: '2027-01-01T10:00:00Z' }) });

for (const [lang, providerError, confirmed] of [
  ['en', 'Payment provider error.', 'This booking is already confirmed.'],
  ['fr', 'Erreur du fournisseur de paiement.', 'Cette réservation est déjà confirmée.'],
]) {
  test(`rule 54 — provider unreachable on the re-click: the visitor's ${lang} provider error, not our operator sentence`, async () => {
    const devisId = freshDevis();
    await agedLink(devisId);
    const res = await callPay(devisId, down, lang);
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.error.code, 'PROVIDER_UNREACHABLE');
    assert.equal(res.body.error.message, providerError);
  });

  test(`rule 54 — the old link was paid meanwhile: the visitor reads « already confirmed » in ${lang}`, async () => {
    const devisId = freshDevis();
    await agedLink(devisId);
    const res = await callPay(devisId, paid, lang);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error.code, 'ALREADY_CONFIRMED');
    assert.equal(res.body.error.message, confirmed);
  });
}

// specs/payment-link-lifecycle.md rule 56 (review of #902, G1) — a payment received on a link withdrawn by hand
// waits for the operator: the visitor reads a sentence of the site in their language, never the operator's text.
for (const [lang, message] of [
  ['en', 'A payment is being checked: please contact the property.'],
  ['fr', 'Un paiement est en cours de vérification : contacter l’établissement.'],
]) {
  test(`rule 56 — an unsettled payment on a withdrawn link: the visitor's ${lang} sentence, nothing minted`, async () => {
    const devisId = freshDevis();
    links.create({
      reservationId: devisId, type: 'full', amountCents: 40000, provider: 'qonto', providerLinkId: `withdrawn_${devisId}`,
      url: 'https://pay.example.test/old', status: 'cancelled',
    });
    db.prepare("UPDATE payment_links SET cancelReason = 'operator', paidAt = ?, providerPaymentId = 'pp_late' WHERE reservationId = ?")
      .run(new Date().toISOString(), devisId);
    const minted = [];
    const fake = { ...provider({ getPayment: async () => ({ paid: false }) }), async createLink() { minted.push(devisId); return { id: 'x', url: 'https://pay.example.test/x', status: 'open' }; } };
    const res = await callPay(devisId, fake, lang);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error.code, 'PAYMENT_UNDER_REVIEW');
    assert.equal(res.body.error.message, message);
    assert.deepEqual(minted, []);
  });
}
