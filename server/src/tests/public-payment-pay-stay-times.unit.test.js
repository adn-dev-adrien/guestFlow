// specs/public-online-payment.md rule 17 (audit R24 public finding 1) — before any link, `pay` judges the devis's own
// arrival and departure times against the neighbouring stays as the back office does: a neighbour booked since the
// request on the arrival or the departure day, with the times now clashing, is 409 STAY_TIMES_UNAVAILABLE in the
// visitor's language, and the provider is never called. It used to be paid in full, then converted with a conflict.

const { db, inDays, freshProperty, addStay } = require('./datesTakenFixture');
const test = require('node:test');
const assert = require('node:assert/strict');
const paymentProviders = require('../utils/paymentProviders');
const { pay } = require('../controllers/public/publicPaymentController');

function propertyWithSeason() {
  const propertyId = freshProperty();
  db.prepare('UPDATE properties SET cleaningHours = 3, maxGuests = 6 WHERE id = ?').run(propertyId);
  db.prepare(`INSERT INTO pricing_rules (propertyId, label, pricePerNight, dateRanges, minNights) VALUES (?, 'Saison', 100, ?, 1)`)
    .run(propertyId, JSON.stringify([{ startDate: inDays(1), endDate: inDays(300) }]));
  return propertyId;
}

function publicDevis(propertyId, start, end, checkInTime, checkOutTime) {
  const id = addStay({ propertyId, kind: 'devis', start, end, checkInTime, checkOutTime, extra: { requestOrigin: 'public', publicToken: 'tok', devisStatus: 'draft' } });
  return id;
}

let created = 0;
const provider = {
  id: 'qonto', label: 'Qonto', errorCode: 'QONTO_API_ERROR', isReady: () => true,
  async createLink() { created += 1; return { id: `pl_times_${created}`, url: `https://pay.example.test/times/${created}`, status: 'open' }; },
  async getPayment() { return { paid: false }; },
  async getLinkStatus() { return 'open'; },
  async cancelLink() {},
  async deactivateLink() {},
};

async function callPay(devisId, lang) {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  const original = paymentProviders.declared;
  paymentProviders.declared = () => provider;
  try {
    await pay({ params: { id: String(devisId) }, body: { token: 'tok', lang }, query: { lang }, headers: {}, get: () => undefined }, res);
  } finally { paymentProviders.declared = original; }
  return res;
}

const CLASHES = [
  ['an arrival at 12:00 after a 10:00 departure', (p) => { addStay({ propertyId: p, start: inDays(53), end: inDays(60) }); return publicDevis(p, inDays(60), inDays(64), '12:00', '10:00'); }],
  ['an arrival at 10:00 on a departure day', (p) => { addStay({ propertyId: p, start: inDays(53), end: inDays(60) }); return publicDevis(p, inDays(60), inDays(64), '10:00', '10:00'); }],
  ['a departure at 14:00 before a 16:00 arrival', (p) => { addStay({ propertyId: p, start: inDays(64), end: inDays(70) }); return publicDevis(p, inDays(60), inDays(64), '16:00', '14:00'); }],
  ['a departure at 18:00 on an arrival day', (p) => { addStay({ propertyId: p, start: inDays(64), end: inDays(70) }); return publicDevis(p, inDays(60), inDays(64), '16:00', '18:00'); }],
];

for (const [what, seed] of CLASHES) {
  test(`rule 17 — ${what}: refused before any link`, async () => {
    const devisId = seed(propertyWithSeason());
    const before = created;
    const res = await callPay(devisId, 'fr');
    assert.equal(res.statusCode, 409, JSON.stringify(res.body));
    assert.equal(res.body.error.code, 'STAY_TIMES_UNAVAILABLE');
    assert.equal(res.body.error.message, 'Horaires indisponibles à ces dates : modifier l’heure d’arrivée ou de départ.');
    assert.equal(created, before, 'the provider is never called');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payment_links WHERE reservationId = ?').get(devisId).n, 0);
  });
}

test('rule 17 — the English site reads its sentence', async () => {
  const devisId = CLASHES[0][1](propertyWithSeason());
  const res = await callPay(devisId, 'en');
  assert.equal(res.body.error.message, 'These times are not available on these dates: change the check-in or check-out time.');
});

test('rule 17 — the same stay at 16:00 after a 10:00 departure goes on to the provider', async () => {
  const p = propertyWithSeason();
  addStay({ propertyId: p, start: inDays(53), end: inDays(60) });
  const devisId = publicDevis(p, inDays(60), inDays(64), '16:00', '10:00');
  const before = created;
  const res = await callPay(devisId, 'fr');
  assert.notEqual(res.body && res.body.error && res.body.error.code, 'STAY_TIMES_UNAVAILABLE', JSON.stringify(res.body));
  assert.equal(created, before + 1, 'a link is asked for');
});
