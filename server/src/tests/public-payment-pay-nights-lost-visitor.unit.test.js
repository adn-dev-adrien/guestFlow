// specs/payment-link-lifecycle.md rule 54, reading of 2026-11-01 (audit R11 public L-1) — the nights taken (rule 11)
// or closed (rule 55) while the provider answers the public `pay` are refused in the visitor's language: 409
// DATES_UNAVAILABLE with the site's « dates no longer available » sentence, the code the pre-check already answers,
// never GuestFlow's operator text « … aucun lien créé ». The fresh link is still stored withdrawn.

process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database');
const paymentProviders = require('../utils/paymentProviders');
const { pay } = require('../controllers/public/publicPaymentController');

const pid = Number(db.prepare("INSERT INTO properties (name, maxGuests) VALUES ('Gite', 6)").run().lastInsertRowid);
db.prepare(`INSERT INTO pricing_rules (propertyId, label, pricePerNight, dateRanges, minNights)
  VALUES (?, 'Saison', 100, ?, 1)`).run(pid, JSON.stringify([{ startDate: '2027-01-01', endDate: '2027-12-31' }])); // date-literal-ok: a whole pricing year far ahead, every devis below falls inside it
db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Test', 'Client', 'client@example.test')").run();
db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (2, 'Autre', 'Client', 'autre@example.test')").run();

let seq = 0;
function freshDevis() {
  seq += 1;
  const month = String(seq + 1).padStart(2, '0');
  return Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, finalPrice, depositAmount, balanceAmount, devisStatus, requestOrigin, publicToken, platform)
    VALUES ('devis', ?, 1, ?, ?, 2, 400, 0, 400, 'draft', 'public', 'tok', 'direct')`).run(pid, `2027-${month}-10`, `2027-${month}-14`).lastInsertRowid); // date-literal-ok: one month of 2027 per devis, inside the pricing year above
}

// The provider answers after `during` ran: what an iCal sync or a closure saved in that second does.
function provider(during) {
  return {
    id: 'qonto', label: 'Qonto', errorCode: 'QONTO_API_ERROR', isReady: () => true,
    async createLink() { await new Promise((r) => setTimeout(r, 5)); during(); return { id: `lost_${seq}`, url: `https://pay.example.test/lost/${seq}`, status: 'open' }; },
    async getPayment() { return { paid: false }; },
    async getLinkStatus() { return 'open'; },
    async cancelLink() {},
    async deactivateLink() {},
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

const stayOf = (id) => db.prepare('SELECT startDate, endDate FROM reservations WHERE id = ?').get(id);
const takeNights = (id) => () => {
  const { startDate, endDate } = stayOf(id);
  db.prepare("INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, finalPrice, platform) VALUES ('reservation', ?, 2, ?, ?, 2, 400, 'Booking')").run(pid, startDate, endDate);
};
const closeNights = (id) => () => {
  const { startDate, endDate } = stayOf(id);
  db.prepare("INSERT INTO establishment_closures (propertyId, label, startDate, endDate) VALUES (?, 'Hiver', ?, ?)").run(pid, startDate, endDate);
};

for (const [lang, sentence] of [
  ['en', 'These dates are no longer available.'],
  ['fr', 'Ces dates ne sont plus disponibles.'],
]) {
  for (const [what, during] of [['taken by a platform stay', takeNights], ['closed', closeNights]]) {
    test(`rule 54 (R11 L-1) — nights ${what} during the provider round trip: the visitor's ${lang} sentence`, async () => {
      const devisId = freshDevis();
      const res = await callPay(devisId, provider(during(devisId)), lang);
      assert.equal(res.statusCode, 409);
      assert.equal(res.body.error.code, 'DATES_UNAVAILABLE');
      assert.equal(res.body.error.message, sentence);
      const links = db.prepare('SELECT status FROM payment_links WHERE reservationId = ?').all(devisId);
      assert.deepEqual(links.map((l) => l.status), ['cancelled']);
    });
  }
}
