require('./isolatedDb');
// specs/tariff-recipes/spec.md item 59 + specs/public-api.md (2026-10-27 audit) — a night no season
// covers is never sold on the site: the engine names it (`unpricedNights`) and the public quote and
// booking request refuse the stay instead of pricing it at the engine's fallback rate.
const test = require('node:test');
const assert = require('node:assert/strict');

require('../../../utils/reservationHelpers').getTodayIsoDate = () => '2027-01-01';
const db = require('../../../database');
require('../settings').termsSettings = () => ({ requireTermsAcceptance: false });
const bookingCtl = require('../controllers/publicBookingRequestController');
const quoteCtl = require('../controllers/publicQuoteController');

// Seasons cover April–August 2027 only.
const pid = db.prepare("INSERT INTO properties (name, maxGuests) VALUES ('Gîte', 6)").run().lastInsertRowid;
db.prepare(`INSERT INTO pricing_rules (propertyId, label, pricePerNight, dateRanges, minNights)
  VALUES (?, 'Printemps', 120, ?, 1), (?, 'Été', 150, ?, 1)`)
  .run(pid, JSON.stringify([{ startDate: '2027-04-01', endDate: '2027-06-30' }]),
    pid, JSON.stringify([{ startDate: '2027-07-01', endDate: '2027-08-31' }]));

const res = () => ({ statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const guest = { firstName: 'Ana', lastName: 'Bel', email: 'ana@example.fr', phone: '+33612345678' };
const body = (startDate, endDate) => ({ propertyId: pid, startDate, endDate, adults: 2 });

function request(startDate, endDate) {
  const r = res();
  bookingCtl.create({ body: { ...body(startDate, endDate), guest }, headers: {}, query: {} }, r);
  return r;
}
async function quote(startDate, endDate) {
  const r = res();
  await quoteCtl.quote({ body: body(startDate, endDate), headers: {}, query: {} }, r);
  return r;
}

test('a stay entirely outside every season is refused, nothing persisted', async () => {
  const before = db.prepare('SELECT COUNT(*) AS n FROM reservations').get().n;
  const r = request('2027-09-05', '2027-09-08');
  assert.notEqual(r.statusCode, 201, JSON.stringify(r.body));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservations').get().n, before);
  const q = await quote('2027-09-05', '2027-09-08');
  assert.ok(q.statusCode >= 400 || q.body.data.available === false, JSON.stringify(q.body));
});

test('a stay partly outside the seasons is refused too', () => {
  assert.notEqual(request('2027-03-30', '2027-04-03').statusCode, 201);
});

test('a stay inside the seasons is still sold', () => {
  assert.equal(request('2027-07-10', '2027-07-13').statusCode, 201);
});
