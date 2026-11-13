// specs/wordpress-plugin.md rule 36 (2026-11-12) — the guard against selling taken dates is the server's: the public
// `pay` re-checks the devis's nights and times before anything else, so a visitor holding a quote on nights booked
// since (or a site that let them through) never gets a payment link. The provider is never called, no link is stored.

process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database');
const paymentProviders = require('../utils/paymentProviders');
const { pay } = require('../controllers/public/publicPaymentController');

const pid = Number(db.prepare("INSERT INTO properties (name, maxGuests, defaultCheckIn, defaultCheckOut, cleaningHours) VALUES ('Gite', 6, '15:00', '10:00', 3)").run().lastInsertRowid);
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

function provider() {
  const calls = [];
  return {
    calls,
    id: 'qonto', label: 'Qonto', errorCode: 'QONTO_API_ERROR', isReady: () => true,
    async createLink() { calls.push('createLink'); return { id: `link_${seq}`, url: `https://pay.example.test/${seq}`, status: 'open' }; },
    async getPayment() { return { paid: false }; },
    async getLinkStatus() { return 'open'; },
    async cancelLink() {},
    async deactivateLink() {},
  };
}

async function callPay(devisId, fake) {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  const original = paymentProviders.declared;
  paymentProviders.declared = () => fake;
  try {
    await pay({ params: { id: String(devisId) }, body: { token: 'tok', lang: 'fr' }, query: { lang: 'fr' }, headers: {}, get: () => undefined }, res);
  } finally { paymentProviders.declared = original; }
  return res;
}

const stayOf = (id) => db.prepare('SELECT startDate, endDate FROM reservations WHERE id = ?').get(id);
const linksOf = (id) => db.prepare('SELECT COUNT(*) AS n FROM payment_links WHERE reservationId = ?').get(id).n;
function book(startDate, endDate, times = {}) {
  db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, checkInTime, checkOutTime, adults, finalPrice, platform)
    VALUES ('reservation', ?, 2, ?, ?, ?, ?, 2, 400, 'direct')`).run(pid, startDate, endDate, times.checkIn || null, times.checkOut || null);
}
const dayBefore = (iso) => new Date(Date.parse(`${iso}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);

test('free nights: the link is minted (the guard below is not vacuous)', async () => {
  const id = freshDevis();
  const fake = provider();
  const res = await callPay(id, fake);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(fake.calls, ['createLink']);
  assert.equal(linksOf(id), 1);
});

test('nights booked since the quote: 409 DATES_UNAVAILABLE, the provider is not called, no link stored', async () => {
  const id = freshDevis();
  const { startDate, endDate } = stayOf(id);
  book(startDate, endDate);
  const fake = provider();
  const res = await callPay(id, fake);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'DATES_UNAVAILABLE');
  assert.equal(res.body.error.message, 'Ces dates ne sont plus disponibles.');
  assert.deepEqual(fake.calls, []);
  assert.equal(linksOf(id), 0);
});

test('one night of the stay taken is enough to refuse', async () => {
  const id = freshDevis();
  const { endDate } = stayOf(id);
  book(dayBefore(endDate), endDate);
  const fake = provider();
  const res = await callPay(id, fake);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'DATES_UNAVAILABLE');
  assert.deepEqual(fake.calls, []);
  assert.equal(linksOf(id), 0);
});

test('free nights but a neighbour leaving too late for the arrival: 409 STAY_TIMES_UNAVAILABLE, no link', async () => {
  const id = freshDevis();
  const { startDate } = stayOf(id);
  book(dayBefore(dayBefore(startDate)), startDate, { checkOut: '14:00' });
  const fake = provider();
  const res = await callPay(id, fake);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'STAY_TIMES_UNAVAILABLE');
  assert.deepEqual(fake.calls, []);
  assert.equal(linksOf(id), 0);
});
