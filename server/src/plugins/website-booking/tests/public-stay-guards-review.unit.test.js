require('./isolatedDb');
// Fixed at the 2026-10-27 spec review (specs/public-api.md rules 8, 17-19), on the real controllers and
// database: what a public stay may ask for.
//  - rule 17: an option or resource quantity is bounded by the stay (1e9 was priced and printed);
//  - rule 18: the cot is never a resource line — `babyBeds` drives it, capped at the babies;
//  - rule 19: POST /quote checks the capacity like the booking request (it answered available: true).
const test = require('node:test');
const assert = require('node:assert/strict');

require('../../../utils/reservationHelpers').getTodayIsoDate = () => '2027-01-01';
const db = require('../../../database');
require('../settings').termsSettings = () => ({ requireTermsAcceptance: false });
require('../../../utils/notificationService').notifyNewSiteDevis = async () => {};
const { validateStayInput, maxLineQuantity } = require('../publicInputValidation');
const quoteCtl = require('../controllers/publicQuoteController');
const bookingCtl = require('../controllers/publicBookingRequestController');

const pid = Number(db.prepare("INSERT INTO properties (name, maxGuests, maxBabies) VALUES ('Gîte', 4, 1)").run().lastInsertRowid);
db.prepare(`INSERT INTO pricing_rules (propertyId, label, pricePerNight, dateRanges, minNights) VALUES (?, 'An', 100, ?, 1)`)
  .run(pid, JSON.stringify([{ startDate: '2027-01-01', endDate: '2027-12-31' }]));
const bois = Number(db.prepare("INSERT INTO options (title, priceType, price, displayToClient) VALUES ('Bois', 'per_stay', 10, 1)").run().lastInsertRowid);
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, ?)').run(pid, bois);
const cot = Number(db.prepare("INSERT INTO resources (name, price, priceType) VALUES ('Lit bébé', 0, 'per_stay')").run().lastInsertRowid);
const kayak = Number(db.prepare("INSERT INTO resources (name, price, priceType) VALUES ('Kayak', 15, 'per_stay')").run().lastInsertRowid);

const stay = { propertyId: pid, startDate: '2027-08-10', endDate: '2027-08-12', adults: 2 };
const guest = { firstName: 'Marie', lastName: 'Durand', email: 'marie@example.fr', phone: '+33612345678' };
function res() {
  return { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
async function quote(body) { const r = res(); await quoteCtl.quote({ body, query: {}, headers: {} }, r); return r; }
function request(body) {
  const r = res();
  bookingCtl.create({ body: { ...body, guest }, query: {}, headers: {}, visitor: { ip: '81.250.12.4' } }, r);
  return r;
}

test('rule 17: one unit per guest per hour of the stay, departure day included', () => {
  assert.equal(maxLineQuantity({ persons: 2, nights: 2 }), 144);
  assert.equal(maxLineQuantity({ persons: 0, nights: 0 }), 24);
  const over = validateStayInput({ ...stay, options: [{ optionId: bois, quantity: 1e9 }], resources: [{ resourceId: kayak, quantity: 145 }] }, { todayIso: '2027-01-01' });
  assert.equal(over.ok, false);
  assert.deepEqual(over.errors.map((e) => e.field), ['options[0].quantity', 'resources[0].quantity']);
  assert.equal(validateStayInput({ ...stay, options: [{ optionId: bois, quantity: 144 }] }, { todayIso: '2027-01-01' }).ok, true);
});

test('rule 17: a billion logs is refused 422 by the quote and the booking request, nothing created', async () => {
  const before = db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE kind = 'devis'").get().n;
  const q = await quote({ ...stay, options: [{ optionId: bois, quantity: 1e9 }] });
  assert.equal(q.statusCode, 422);
  assert.equal(q.body.error.details[0].field, 'options[0].quantity');
  const b = request({ ...stay, options: [{ optionId: bois, quantity: 1e9 }] });
  assert.equal(b.statusCode, 422);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE kind = 'devis'").get().n, before);
});

test('rule 18: the cot ordered as a resource is refused on both routes; another resource still passes', async () => {
  const q = await quote({ ...stay, resources: [{ resourceId: cot, quantity: 3 }] });
  assert.equal(q.statusCode, 422);
  assert.equal(q.body.error.code, 'VALIDATION_FAILED');
  assert.equal(request({ ...stay, resources: [{ resourceId: cot, quantity: 3 }] }).statusCode, 422);
  assert.equal((await quote({ ...stay, resources: [{ resourceId: kayak, quantity: 1 }] })).statusCode, 200);
});

test('rule 19: the quote refuses a party over the capacity, like the booking request', async () => {
  const guests = await quote({ ...stay, adults: 5 });
  assert.equal(guests.statusCode, 409);
  assert.equal(guests.body.error.code, 'OVER_CAPACITY');
  const babies = await quote({ ...stay, babies: 2 });
  assert.equal(babies.statusCode, 409);
  const fits = await quote({ ...stay, adults: 4, babies: 1 });
  assert.equal(fits.statusCode, 200);
  assert.equal(fits.body.data.available, true);
});
