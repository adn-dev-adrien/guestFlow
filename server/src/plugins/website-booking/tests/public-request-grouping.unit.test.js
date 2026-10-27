require('./isolatedDb');
// specs/public-request-abuse-and-grouping.md rules 7 and 12-16 — one quote per stay: the same e-mail,
// property and dates update the open website quote in place (number, token and acceptances kept,
// price recomputed by the engine, message appended, history line); another property or a paid quote
// make a new one; a quote already sent is flagged; at most 3 NEW quotes per e-mail per 24 h.
const test = require('node:test');
const assert = require('node:assert/strict');

require('../../../utils/reservationHelpers').getTodayIsoDate = () => '2027-01-01';
const db = require('../../../database');
require('../settings').termsSettings = () => ({ requireTermsAcceptance: false });
const notificationService = require('../../../utils/notificationService');
const notified = [];
notificationService.notifyNewSiteDevis = async (id, opts = {}) => { notified.push({ id, updated: Boolean(opts.updated) }); };
const bookingCtl = require('../controllers/publicBookingRequestController');

function property(name) {
  const id = db.prepare('INSERT INTO properties (name, maxGuests) VALUES (?, 6)').run(name).lastInsertRowid;
  db.prepare(`INSERT INTO pricing_rules (propertyId, label, pricePerNight, dateRanges, minNights) VALUES (?, 'An', 100, ?, 2)`)
    .run(id, JSON.stringify([{ startDate: '2027-01-01', endDate: '2027-12-31' }]));
  return Number(id);
}
const gite = property('Gîte');
const tente = property('Tente');
const menage = (() => {
  const id = db.prepare("INSERT INTO options (title, priceType, price, displayToClient) VALUES ('Ménage', 'per_stay', 80, 1)").run().lastInsertRowid;
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, ?)').run(gite, id);
  return Number(id);
})();

function res() {
  return { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
let dayCounter = 0;
function freshStay() {
  dayCounter += 4;
  const start = new Date(Date.UTC(2027, 5, 1 + dayCounter));
  const end = new Date(start.getTime() + 2 * 86400000);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}
function send(body) {
  const r = res();
  bookingCtl.create({ body, headers: {}, query: {}, visitor: { ip: '81.250.12.4', userAgent: 'test', pluginVersion: '' } }, r);
  return r;
}
const guest = (email = 'marie@example.fr') => ({ firstName: 'Marie', lastName: 'Durand', email, phone: '+33612345678' });
const row = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
const count = (email) => db.prepare(`SELECT COUNT(*) AS n FROM reservations r JOIN clients c ON c.id = r.clientId
  WHERE r.kind = 'devis' AND lower(c.email) = ?`).get(email).n;

test('rule 13: the same stay updates the open quote — same id, number and token, price recomputed, notes appended, history', () => {
  const stay = { propertyId: gite, ...freshStay() };
  const first = send({ ...stay, adults: 2, guest: guest('same@example.fr'), message: 'Arrivée vers 18 h' });
  assert.equal(first.statusCode, 201);
  assert.equal(first.body.data.updated, false);
  const before = row(first.body.data.requestId);

  // The drawer that sent the first request holds its token (rule 20).
  const second = send({ ...stay, adults: 3, options: [{ optionId: menage, quantity: 1 }], guest: guest(' Same@Example.FR '), message: 'Nous serons trois', publicToken: first.body.data.publicToken });
  assert.equal(second.statusCode, 201);
  const d = second.body.data;
  assert.equal(d.updated, true);
  assert.equal(d.requestId, first.body.data.requestId);
  assert.equal(d.reference, first.body.data.reference);
  assert.equal(d.publicToken, first.body.data.publicToken);
  assert.equal(d.requestedOn, String(before.createdAt).slice(0, 10));
  assert.equal(count('same@example.fr'), 1, 'no second quote');

  const after = row(d.requestId);
  assert.equal(after.devisNumber, before.devisNumber);
  assert.equal(after.publicToken, before.publicToken);
  assert.equal(after.adults, 3);
  assert.equal(Number(after.finalPrice), Number(before.finalPrice) + 80, 'the option is priced by the engine');
  assert.equal(d.finalPrice, Number(after.finalPrice));
  assert.match(after.notes, /^Arrivée vers 18 h\n\nDemande mise à jour depuis le site le \d\d\/\d\d\/\d{4} :\nNous serons trois$/);
  assert.equal(after.publicUpdatedAfterSendAt, null, 'a draft is not flagged');

  const history = db.prepare("SELECT changedFields FROM reservation_history WHERE reservationId = ? AND eventType = 'public_update'").all(d.requestId);
  assert.equal(history.length, 1);
  assert.ok(JSON.parse(history[0].changedFields).some((c) => c.field === 'adults' && c.from === 2 && c.to === 3));
  assert.deepEqual(notified.slice(-2).map((n) => n.updated), [false, true], 'rule 16: counted as an update');
});

test('edge case: the same request twice (double click) answers the same quote, unchanged', () => {
  const stay = { propertyId: gite, ...freshStay(), adults: 2, guest: guest('double@example.fr'), message: 'Bonjour' };
  const first = send(stay);
  const historyBefore = db.prepare('SELECT COUNT(*) AS n FROM reservation_history WHERE reservationId = ?').get(first.body.data.requestId).n;
  const second = send({ ...stay, publicToken: first.body.data.publicToken });
  assert.equal(second.statusCode, 201);
  assert.equal(second.body.data.requestId, first.body.data.requestId);
  assert.equal(second.body.data.updated, false);
  assert.equal(row(first.body.data.requestId).notes, 'Bonjour', 'the message is not appended twice');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_history WHERE reservationId = ?').get(first.body.data.requestId).n, historyBefore);
});

test('rule 15: same e-mail and dates, another property → a second quote', () => {
  const dates = freshStay();
  const a = send({ propertyId: gite, ...dates, adults: 2, guest: guest('group@example.fr') });
  const b = send({ propertyId: tente, ...dates, adults: 2, guest: guest('group@example.fr') });
  assert.notEqual(b.body.data.requestId, a.body.data.requestId);
  assert.equal(b.body.data.updated, false);
  assert.equal(count('group@example.fr'), 2);
});

test('rules 14 + 21: a quote the operator already sent keeps its composition and is flagged', () => {
  const stay = { propertyId: gite, ...freshStay(), guest: guest('sent@example.fr') };
  const first = send({ ...stay, adults: 2 });
  db.prepare("UPDATE reservations SET devisStatus = 'sent' WHERE id = ?").run(first.body.data.requestId);
  const second = send({ ...stay, adults: 4 });
  assert.equal(second.body.data.updated, true);
  assert.equal(second.body.data.messageAdded, true);
  const after = row(first.body.data.requestId);
  assert.equal(after.devisStatus, 'sent', 'the status stays');
  assert.equal(after.adults, 2, 'rule 21: never changed');
  assert.ok(after.publicUpdatedAfterSendAt, 'flagged');

  // The operator's next save clears it.
  const devisModel = require('../../../models/devisModel');
  devisModel.update(after.id, { ...after, status: 'sent' });
  assert.equal(row(after.id).publicUpdatedAfterSendAt, null);
});

test('rule 13: a paid quote is not open — the same stay makes a new one', () => {
  const stay = { propertyId: gite, ...freshStay(), adults: 2, guest: guest('paid@example.fr') };
  const first = send(stay);
  db.prepare("INSERT INTO payment_links (reservationId, type, url, amountCents, status) VALUES (?, 'full', 'https://pay.example', 1000, 'paid')")
    .run(first.body.data.requestId);
  const second = send({ ...stay, adults: 3 });
  assert.ok(second.body.data.requestId, 'a new quote, its own id');
  assert.notEqual(second.body.data.requestId, first.body.data.requestId);
  assert.notEqual(second.body.data.reference, first.body.data.reference);
});

test('edge case: a new composition the stay refuses leaves the open quote untouched', () => {
  const stay = { propertyId: gite, ...freshStay(), guest: guest('cap@example.fr') };
  const first = send({ ...stay, adults: 2 });
  const before = row(first.body.data.requestId);
  const refused = send({ ...stay, adults: 9 });
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.body.error.code, 'OVER_CAPACITY');
  assert.deepEqual(row(first.body.data.requestId), before);
});

test('rule 7: the 4th NEW quote for one e-mail in 24 h is refused; an update of an open one still passes', () => {
  const email = 'busy@example.fr';
  const stays = [freshStay(), freshStay(), freshStay(), freshStay()];
  stays.slice(0, 3).forEach((s) => assert.equal(send({ propertyId: gite, ...s, adults: 2, guest: guest(email) }).statusCode, 201));
  const fourth = send({ propertyId: gite, ...stays[3], adults: 2, guest: guest(email.toUpperCase()) });
  assert.equal(fourth.statusCode, 429);
  assert.equal(fourth.body.error.code, 'TOO_MANY_REQUESTS');
  assert.equal(fourth.body.error.message, 'Plusieurs demandes sont déjà en cours pour cette adresse. Elles seront traitées rapidement.');
  const update = send({ propertyId: gite, ...stays[0], adults: 3, guest: guest(email) });
  assert.equal(update.statusCode, 201);
  assert.equal(update.body.data.updated, true, 'rule 16: an update does not count against rule 7');
  assert.equal(count(email), 3);
});
