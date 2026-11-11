require('./isolatedDb');
// specs/public-request-abuse-and-grouping.md rules 20-22 (review of PR #805, operator decision
// 2026-10-27 « Brouillon seul, jamais le lien ») — knowing a guest's e-mail, property and dates must
// not hand anyone their quote: an existing quote's id and payment token are only returned to a request
// that already holds that token; only an untouched draft is updated in place; a quote the operator
// sent, edited or opened only gains the guest's message, and keeps every line the operator set.
const test = require('node:test');
const assert = require('node:assert/strict');

require('../../../utils/reservationHelpers').getTodayIsoDate = () => '2027-01-01';
const db = require('../../../database');
require('../settings').termsSettings = () => ({ requireTermsAcceptance: false });
const notificationService = require('../../../utils/notificationService');
const notified = [];
notificationService.notifyNewSiteDevis = async (id, opts = {}) => { notified.push({ id, ...opts }); };
const bookingCtl = require('../controllers/publicBookingRequestController');
const devisModel = require('../../../models/devisModel');

const pid = Number(db.prepare("INSERT INTO properties (name, maxGuests) VALUES ('Gîte', 6)").run().lastInsertRowid);
db.prepare(`INSERT INTO pricing_rules (propertyId, label, pricePerNight, dateRanges, minNights) VALUES (?, 'An', 100, ?, 1)`)
  .run(pid, JSON.stringify([{ startDate: '2027-01-01', endDate: '2027-12-31' }]));
const menage = Number(db.prepare("INSERT INTO options (title, priceType, price, displayToClient) VALUES ('Ménage', 'per_stay', 80, 1)").run().lastInsertRowid);
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, ?)').run(pid, menage);

function res() {
  return { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
let day = 0;
function stay() {
  day += 3;
  return {
    startDate: new Date(Date.UTC(2027, 7, day)).toISOString().slice(0, 10),
    endDate: new Date(Date.UTC(2027, 7, day + 2)).toISOString().slice(0, 10),
  };
}
function send(body) {
  const r = res();
  bookingCtl.create({ body, headers: {}, query: {}, visitor: { ip: '81.250.12.4' } }, r);
  return r;
}
const guest = (email) => ({ firstName: 'Marie', lastName: 'Durand', email, phone: '+33612345678' });
const row = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
const lines = (id) => db.prepare('SELECT optionId, quantity, totalPrice, offered FROM reservation_options WHERE reservationId = ? ORDER BY optionId').all(id);

test('rule 20: another visitor sending the same stay never receives the quote id, number or payment token', () => {
  const s = { propertyId: pid, ...stay() };
  const victim = send({ ...s, adults: 2, guest: guest('victim@example.fr') });
  const attacker = send({ ...s, adults: 3, guest: guest('victim@example.fr') });
  assert.equal(attacker.statusCode, 201);
  const d = attacker.body.data;
  assert.equal(d.updated, true);
  assert.equal(d.publicToken, undefined);
  assert.equal(d.requestId, undefined);
  assert.equal(d.reference, undefined);
  assert.equal(d.finalPrice, undefined);
  assert.notEqual(JSON.stringify(attacker.body).includes(victim.body.data.publicToken), true);
});

test('rule 20: the same request twice (double click) answers without the token either', () => {
  const s = { propertyId: pid, ...stay(), adults: 2, guest: guest('double@example.fr') };
  send(s);
  const again = send(s);
  assert.equal(again.body.data.publicToken, undefined);
  assert.equal(again.body.data.requestId, undefined);
});

test('rule 20: a request that carries the quote\'s token gets its id and token back', () => {
  const s = { propertyId: pid, ...stay(), guest: guest('holder@example.fr') };
  const first = send({ ...s, adults: 2 });
  const second = send({ ...s, adults: 3, publicToken: first.body.data.publicToken });
  assert.equal(second.body.data.requestId, first.body.data.requestId);
  assert.equal(second.body.data.publicToken, first.body.data.publicToken);
  assert.equal(row(first.body.data.requestId).adults, 3);
});

test('rule 21: a sent quote is never changed — the message is appended, the guest told it was added', () => {
  const s = { propertyId: pid, ...stay(), guest: guest('sent@example.fr') };
  const first = send({ ...s, adults: 2 });
  const id = first.body.data.requestId;
  db.prepare("UPDATE reservations SET devisStatus = 'sent' WHERE id = ?").run(id);
  const before = row(id);
  const again = send({ ...s, adults: 5, options: [{ optionId: menage, quantity: 1 }], message: 'Pouvez-vous me rappeler ?' });
  assert.equal(again.statusCode, 201);
  assert.equal(again.body.data.messageAdded, true);
  assert.equal(again.body.data.publicToken, undefined);
  const after = row(id);
  assert.equal(after.adults, 2);
  assert.equal(after.finalPrice, before.finalPrice);
  assert.match(after.notes, /Message ajouté depuis le site le \d\d\/\d\d\/\d{4} :\nPouvez-vous me rappeler \?$/);
  assert.ok(after.publicUpdatedAfterSendAt, 'the operator sees the guest wrote after the quote left');
  assert.deepEqual(notified.at(-1), { id, updated: true });
});

test('rule 21 (F2): a draft the operator edited keeps every line the operator set', () => {
  const s = { propertyId: pid, ...stay(), guest: guest('edited@example.fr') };
  const first = send({ ...s, adults: 2, options: [{ optionId: menage, quantity: 1 }] });
  const id = first.body.data.requestId;
  const full = row(id);
  devisModel.update(id, { ...full, status: 'draft', selectedOptions: [{ optionId: menage, quantity: 1 }], offeredOptionIds: [menage] });
  const linesBefore = lines(id);
  assert.equal(linesBefore[0].offered, 1, 'the operator offered the cleaning');
  const again = send({ ...s, adults: 4, message: 'Finalement à quatre' });
  assert.equal(again.body.data.messageAdded, true);
  assert.deepEqual(lines(id), linesBefore);
  assert.equal(row(id).adults, 2);
});

test('rule 21: a draft the operator only opened is not changed either', () => {
  const s = { propertyId: pid, ...stay(), guest: guest('opened@example.fr') };
  const id = send({ ...s, adults: 2 }).body.data.requestId;
  devisModel.markOperatorSeen(id);
  const again = send({ ...s, adults: 4 });
  assert.equal(again.body.data.messageAdded, true);
  assert.equal(row(id).adults, 2);
});

test('rule 21: a quote with a payment link (even unpaid) is not changed', () => {
  const s = { propertyId: pid, ...stay(), guest: guest('link@example.fr') };
  const id = send({ ...s, adults: 2 }).body.data.requestId;
  db.prepare("INSERT INTO payment_links (reservationId, type, url, amountCents, status) VALUES (?, 'full', 'https://p', 100, 'open')").run(id);
  assert.equal(send({ ...s, adults: 4 }).body.data.messageAdded, true);
  assert.equal(row(id).adults, 2);
});

test('rule 22 (F5): a message over 2000 characters is refused on its field', () => {
  const r = send({ propertyId: pid, ...stay(), adults: 2, guest: guest('long@example.fr'), message: 'x'.repeat(2001) });
  assert.equal(r.statusCode, 422);
  assert.equal(r.body.error.details[0].field, 'message');
  assert.equal(r.body.error.message, 'Message trop long : 2 000 caractères au plus.');
});

test('rule 22 (F5): beyond 10 appended messages the request succeeds, the note does not grow, the operator is told', () => {
  const s = { propertyId: pid, ...stay(), guest: guest('chatty@example.fr') };
  const id = send({ ...s, adults: 2 }).body.data.requestId;
  db.prepare("UPDATE reservations SET devisStatus = 'sent' WHERE id = ?").run(id);
  for (let i = 0; i < 10; i += 1) send({ ...s, adults: 2, message: `message ${i}` });
  const notes = row(id).notes;
  const r = send({ ...s, adults: 2, message: 'message 11' });
  assert.equal(r.statusCode, 201);
  assert.equal(row(id).notes, notes);
  assert.deepEqual(notified.at(-1), { id, updated: true, messageDropped: true });
});
