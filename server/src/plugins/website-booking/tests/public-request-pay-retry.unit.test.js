require('./isolatedDb');
// specs/public-request-abuse-and-grouping.md rule 27 (re-review of PR #805) — a guest who opened the
// payment page, came back, changed the party and pays again must pay the new stay: the payment link
// the guest's own drawer made does not make the quote « touched » for the holder of its token. The
// quote is updated and re-priced, and the update retires the old link (deactivated at the provider after the commit);
// the next payment mints a new one at the new amount.
const test = require('node:test');
const assert = require('node:assert/strict');

require('../../../utils/reservationHelpers').getTodayIsoDate = () => '2027-01-01';
const db = require('../../../database');
require('../settings').termsSettings = () => ({ requireTermsAcceptance: false });
require('../../../utils/notificationService').notifyNewSiteDevis = async () => {};
const bookingCtl = require('../controllers/publicBookingRequestController');
const paymentLinksModel = require('../../../models/paymentLinksModel');
const { ensurePaymentLink } = require('../../../utils/paymentRequestService');

const pid = Number(db.prepare("INSERT INTO properties (name, maxGuests) VALUES ('Gîte', 6)").run().lastInsertRowid);
db.prepare(`INSERT INTO pricing_rules (propertyId, label, pricePerNight, dateRanges, minNights) VALUES (?, 'An', 100, ?, 2)`)
  .run(pid, JSON.stringify([{ startDate: '2027-01-01', endDate: '2027-12-31' }]));
const menage = Number(db.prepare("INSERT INTO options (title, priceType, price, displayToClient) VALUES ('Ménage', 'per_stay', 80, 1)").run().lastInsertRowid);
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, ?)').run(pid, menage);

function res() {
  return { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
function send(body) {
  const r = res();
  bookingCtl.create({ body, headers: {}, query: {}, visitor: { ip: '81.250.12.4' } }, r);
  return r;
}
const stay = { propertyId: pid, startDate: '2027-07-10', endDate: '2027-07-14' };
const guest = { firstName: 'Marie', lastName: 'Durand', email: 'payer@example.fr', phone: '+33612345678' };
const cents = (id) => Math.round(Number(db.prepare('SELECT finalPrice FROM reservations WHERE id = ?').get(id).finalPrice) * 100);

test('rule 27: back from the payment page with a new party, the token holder\'s quote is re-priced and the old link retired', async () => {
  const first = send({ ...stay, adults: 2, guest });
  const { requestId: id, publicToken } = first.body.data;
  const firstCents = cents(id);

  // The drawer's first « Payer »: a link at the first price, opened then abandoned at the provider.
  const calls = [];
  const provider = {
    createLink: async (args) => { calls.push(['create', args.amountCents]); return { id: `p${calls.length}`, url: `https://pay.example/${calls.length}`, status: 'open' }; },
    getPayment: async () => ({ paid: false }),
  };
  const deps = {
    database: db, paymentLinksModel, provider,
    resolveAmountCents: (rid) => cents(rid),
    deactivateLinks: async (links) => { links.forEach((l) => calls.push(['cancel', l.amountCents])); },
  };
  const oldLink = await ensurePaymentLink(deps, id, 'full');
  assert.equal(oldLink.amountCents, firstCents);

  // Back on the site: 5 adults and the cleaning, « Payer » again — the drawer sends its token.
  const again = send({ ...stay, adults: 5, options: [{ optionId: menage, quantity: 1 }], guest, publicToken });
  assert.equal(again.statusCode, 201);
  const d = again.body.data;
  assert.equal(d.messageAdded, undefined, 'not a message-only answer');
  assert.equal(d.updated, true);
  assert.equal(d.publicToken, publicToken);
  assert.equal(db.prepare('SELECT adults FROM reservations WHERE id = ?').get(id).adults, 5);
  assert.ok(cents(id) > firstCents, 're-priced');
  assert.equal(Math.round(d.finalPrice * 100), cents(id), 'the answer carries the new price');

  // Audit 2026-10-28 — the update itself retires the old link (it cannot be paid at the old price
  // while the quote asks the new one); the next payment only mints a link at the new amount.
  const retired = paymentLinksModel.findById(oldLink.id);
  assert.equal(retired.status, 'cancelled');
  assert.equal(retired.cancelReason, 'amount-changed');
  const newLink = await ensurePaymentLink(deps, id, 'full');
  assert.equal(newLink.amountCents, cents(id));
  assert.deepEqual(calls, [['create', firstCents], ['create', cents(id)]]);
});

test('rule 27: without the token, the same quote with a guest link is not changed (rule 21 stands)', async () => {
  const s = { ...stay, startDate: '2027-08-10', endDate: '2027-08-14' };
  const first = send({ ...s, adults: 2, guest: { ...guest, email: 'other@example.fr' } });
  const id = first.body.data.requestId;
  db.prepare("INSERT INTO payment_links (reservationId, type, url, amountCents, status) VALUES (?, 'full', 'https://p', 100, 'open')").run(id);
  const again = send({ ...s, adults: 5, guest: { ...guest, email: 'other@example.fr' } });
  assert.equal(again.body.data.messageAdded, true);
  assert.equal(db.prepare('SELECT adults FROM reservations WHERE id = ?').get(id).adults, 2);
});

test('rule 27: a quote the operator opened stays message-only, token or not', () => {
  const s = { ...stay, startDate: '2027-09-10', endDate: '2027-09-14' };
  const first = send({ ...s, adults: 2, guest: { ...guest, email: 'seen@example.fr' } });
  const id = first.body.data.requestId;
  require('../../../models/devisModel').markOperatorSeen(id);
  const again = send({ ...s, adults: 5, guest: { ...guest, email: 'seen@example.fr' }, publicToken: first.body.data.publicToken });
  assert.equal(again.body.data.messageAdded, true);
  assert.equal(db.prepare('SELECT adults FROM reservations WHERE id = ?').get(id).adults, 2);
});
