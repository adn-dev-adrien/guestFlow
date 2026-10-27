require('./isolatedDb');
// specs/public-api.md rule 14 (2026-10-27 audit) — the quote and the booking request accept exactly
// the options the public catalogue lists: never an internal-only one (displayToClient = 0), an offered
// default, or one sold at a negative price.
const test = require('node:test');
const assert = require('node:assert/strict');

require('../../../utils/reservationHelpers').getTodayIsoDate = () => '2027-01-01';
const db = require('../../../database');
require('../settings').termsSettings = () => ({ requireTermsAcceptance: false });
const bookingCtl = require('../controllers/publicBookingRequestController');
const quoteCtl = require('../controllers/publicQuoteController');
const catalogCtl = require('../controllers/publicCatalogController');

const pid = db.prepare("INSERT INTO properties (name, maxGuests) VALUES ('Gîte', 6)").run().lastInsertRowid;
db.prepare(`INSERT INTO pricing_rules (propertyId, label, pricePerNight, dateRanges, minNights) VALUES (?, 'An', 100, ?, 1)`)
  .run(pid, JSON.stringify([{ startDate: '2027-01-01', endDate: '2027-12-31' }]));
function option(title, price, extra = {}) {
  const id = db.prepare("INSERT INTO options (title, priceType, price, displayToClient) VALUES (?, 'per_stay', ?, ?)")
    .run(title, price, extra.displayToClient ?? 1).lastInsertRowid;
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, ?)').run(pid, id);
  if (extra.offered) db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (?, ?, 1)').run(pid, id);
  return Number(id);
}
const visible = option('Ménage', 80);
const internal = option('Tapis de bain (interne)', 5, { displayToClient: 0 });
const offered = option('Linge offert', 15, { offered: true });
const negative = option('Remise fidélité', -200);

function res() {
  return { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
const stay = { propertyId: pid, startDate: '2027-07-03', endDate: '2027-07-05', adults: 2 };
const guest = { firstName: 'Ana', lastName: 'Bel', email: 'ana@example.fr', phone: '+33612345678' };

test('the catalogue lists the visible option only', () => {
  const r = res();
  catalogCtl.listOptions({ params: { id: pid }, query: {}, headers: {} }, r);
  const ids = [...r.body.data.ungrouped, ...r.body.data.groups.flatMap((g) => g.options)].map((o) => o.optionId ?? o.id);
  assert.deepEqual(ids, [visible]);
});

for (const [label, id] of [['internal-only', internal], ['offered default', offered], ['negative-priced', negative]]) {
  test(`the ${label} option → quote 422 optionUnavailable, booking request 422, nothing persisted`, async () => {
    const q = res();
    await quoteCtl.quote({ body: { ...stay, options: [{ optionId: id, quantity: 1 }] }, headers: {}, query: {} }, q);
    assert.equal(q.statusCode, 422);
    assert.equal(q.body.error.code, 'VALIDATION_FAILED');
    const before = db.prepare('SELECT COUNT(*) AS n FROM reservations').get().n;
    const b = res();
    bookingCtl.create({ body: { ...stay, guest, options: [{ optionId: id, quantity: 1 }] }, headers: {}, query: {} }, b);
    assert.equal(b.statusCode, 422);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservations').get().n, before);
  });
}

test('the catalogue option is accepted and priced', async () => {
  const q = res();
  await quoteCtl.quote({ body: { ...stay, options: [{ optionId: visible, quantity: 1 }] }, headers: {}, query: {} }, q);
  assert.equal(q.statusCode, 200);
  assert.equal(q.body.data.options.find((o) => o.optionId === visible).total, 80);
});
