require('./isolatedDb');
// specs/reservations/platform-stays-always-saveable.md rule 9 — the website's public path is not the fiche's: a stay under the minimum
// is still refused (409 MIN_NIGHTS), and no `forceMinNights` lifts it. Lives in the plugin's folder, which it reads.
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../../database');
const bookingCtl = require('../controllers/publicBookingRequestController');
require('../settings').termsSettings = () => ({ requireTermsAcceptance: false });

const SPEC = 'specs/reservations/platform-stays-always-saveable.md';
const iso = (d, plus = 0) => new Date(d.getTime() + plus * 86400000).toISOString().slice(0, 10);
const rangeOf = (start, end) => JSON.stringify([{ startDate: start, endDate: end }]);
function season(pid, label, min, ranges) {
  db.prepare('INSERT INTO pricing_rules (propertyId, label, pricePerNight, dateRanges, minNights) VALUES (?, ?, 100, ?, ?)').run(pid, label, ranges, min);
}
function reply() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

test(`${SPEC} rule 9 — the public path still refuses a stay under the minimum, with no override`, () => {
  // The public horizon is one year: this stay sits a month ahead, in a season of its own asking for 4 nights.
  const start = new Date(Date.now() + 30 * 86400000);
  const publicProperty = Number(db.prepare("INSERT INTO properties (name, maxGuests) VALUES ('Public', 4)").run().lastInsertRowid);
  season(publicProperty, 'Haute', 4, rangeOf(iso(start, -10), iso(start, 30)));
  const r = reply();
  bookingCtl.create({
    body: { propertyId: publicProperty, startDate: iso(start), endDate: iso(start, 3), adults: 2, forceMinNights: true,
      guest: { firstName: 'Ana', lastName: 'Bel', email: 'ana@example.fr', phone: '+33612345678' } },
    headers: {}, query: {},
  }, r);
  assert.equal(r.statusCode, 409, JSON.stringify(r.body));
  assert.equal(r.body.error.code, 'MIN_NIGHTS');
});
