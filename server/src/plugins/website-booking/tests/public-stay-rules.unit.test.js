require('./isolatedDb');
// specs/tariff-recipes/spec.md §3.4 rule 23 + specs/public-api.md rule 12 (2026-10-27 audit) — the
// public path enforces the maximum stay and the changeover days like the minimum stay: the booking
// request refuses them (409 MAX_NIGHTS / CHANGEOVER), the quote says so first, the calendar offers no
// arrival they refuse, and /pay re-checks them before any money moves.
const test = require('node:test');
const assert = require('node:assert/strict');

require('../../../utils/reservationHelpers').getTodayIsoDate = () => '2027-01-01';
const db = require('../../../database');
require('../settings').termsSettings = () => ({ requireTermsAcceptance: false });
const bookingCtl = require('../controllers/publicBookingRequestController');
const quoteCtl = require('../controllers/publicQuoteController');
const catalogCtl = require('../controllers/publicCatalogController');
const paymentCtl = require('../../../controllers/public/publicPaymentController');

// Season 2027: 2 to 7 nights, arrivals and departures on Saturday only (2027-07-03 is a Saturday).
const pid = db.prepare("INSERT INTO properties (name, maxGuests) VALUES ('Gîte', 6)").run().lastInsertRowid;
db.prepare(`INSERT INTO pricing_rules (propertyId, label, pricePerNight, dateRanges, minNights, maxNights, changeoverArrival, changeoverDeparture)
  VALUES (?, 'Été', 100, ?, 2, 7, 6, 6)`).run(pid, JSON.stringify([{ startDate: '2027-01-01', endDate: '2027-12-31' }]));

function res() {
  return { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
const guest = { firstName: 'Ana', lastName: 'Bel', email: 'ana@example.fr', phone: '+33612345678' };

function request(startDate, endDate, lang) {
  const r = res();
  bookingCtl.create({ body: { propertyId: pid, startDate, endDate, adults: 2, guest, lang }, headers: {}, query: {} }, r);
  return r;
}

async function quote(startDate, endDate, lang) {
  const r = res();
  await quoteCtl.quote({ body: { propertyId: pid, startDate, endDate, adults: 2, lang }, headers: {}, query: {} }, r);
  return r;
}

test('a stay longer than the maximum → 409 MAX_NIGHTS, nothing persisted', () => {
  const before = db.prepare('SELECT COUNT(*) AS n FROM reservations').get().n;
  const r = request('2027-07-03', '2027-07-17');
  assert.equal(r.statusCode, 409);
  assert.equal(r.body.error.code, 'MAX_NIGHTS');
  assert.equal(r.body.error.message, 'Séjour trop long : maximum 7 nuits.');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservations').get().n, before);
});

test('a Tuesday → Thursday stay under Saturday changeovers → 409 CHANGEOVER naming both days', () => {
  const r = request('2027-07-06', '2027-07-08');
  assert.equal(r.statusCode, 409);
  assert.equal(r.body.error.code, 'CHANGEOVER');
  assert.equal(r.body.error.message, 'Arrivée le samedi et départ le samedi uniquement sur cette période.');
  const en = request('2027-07-03', '2027-07-08', 'en');
  assert.equal(en.body.error.code, 'CHANGEOVER');
  assert.equal(en.body.error.message, 'Check-out on Saturday only for these dates.');
});

test('a Saturday → Saturday week passes every rule → 201', () => {
  assert.equal(request('2027-07-10', '2027-07-17').statusCode, 201);
});

test('the quote exposes the maximum, both breaches and the sentence the site prints', async () => {
  const long = (await quote('2027-07-03', '2027-07-17')).body.data;
  assert.equal(long.maxNights, 7);
  assert.equal(long.maxNightsBreached, true);
  assert.equal(long.stayRefusal, 'Séjour trop long : maximum 7 nuits.');
  const tuesday = (await quote('2027-07-06', '2027-07-08', 'en')).body.data;
  assert.equal(tuesday.changeoverBreached, true);
  assert.equal(tuesday.stayRefusal, 'Check-in on Saturday and check-out on Saturday only for these dates.');
  const week = (await quote('2027-08-07', '2027-08-14')).body.data;
  assert.equal(week.maxNightsBreached, false);
  assert.equal(week.changeoverBreached, false);
  assert.equal(week.stayRefusal, null);
});

test('the calendar offers Saturdays only, each with a Saturday departure', () => {
  const r = res();
  catalogCtl.getAvailability({ params: { id: pid }, query: { from: '2027-09-01', to: '2027-09-30' }, headers: {} }, r);
  const arrivals = r.body.data.arrivals;
  assert.ok(arrivals.length > 0);
  for (const a of arrivals) {
    assert.equal(new Date(`${a.date}T00:00:00Z`).getUTCDay(), 6, a.date);
    assert.equal(new Date(`${a.earliestDeparture}T00:00:00Z`).getUTCDay(), 6, a.earliestDeparture);
  }
  assert.deepEqual(arrivals[0], { ...arrivals[0], date: '2027-09-04', earliestDeparture: '2027-09-11' });
});

test('/pay re-checks the rules on the saved devis: a tariff tightened since the request refuses it', async () => {
  const created = request('2027-10-02', '2027-10-09');
  assert.equal(created.statusCode, 201);
  db.prepare('UPDATE pricing_rules SET maxNights = 5 WHERE propertyId = ?').run(pid);
  try {
    const r = res();
    await paymentCtl.pay({
      params: { id: String(created.body.data.requestId) }, body: { token: created.body.data.publicToken }, headers: {}, query: {},
    }, r);
    assert.equal(r.statusCode, 409);
    assert.equal(r.body.error.code, 'MAX_NIGHTS');
  } finally {
    db.prepare('UPDATE pricing_rules SET maxNights = 7 WHERE propertyId = ?').run(pid);
  }
});
