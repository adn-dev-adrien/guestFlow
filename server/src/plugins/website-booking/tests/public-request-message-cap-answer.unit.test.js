require('./isolatedDb');
// specs/public-request-abuse-and-grouping.md rule 30 (2026-10-27 spec review) — past the 10-message cap
// of rule 22 a quote the operator touched gains nothing, so the answer must not say « message ajouté »
// (it did: `messageAdded: true`, and the drawer told the guest their message was added). It answers
// `messageAdded: false`, `updated: false`; the drawer then says nothing about a message, and still
// never pays a message-only answer (rule 27).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('../../../utils/reservationHelpers').getTodayIsoDate = () => '2027-01-01';
const db = require('../../../database');
require('../settings').termsSettings = () => ({ requireTermsAcceptance: false });
const notificationService = require('../../../utils/notificationService');
const notified = [];
notificationService.notifyNewSiteDevis = async (id, opts = {}) => { notified.push({ id, ...opts }); };
const bookingCtl = require('../controllers/publicBookingRequestController');

const pid = Number(db.prepare("INSERT INTO properties (name, maxGuests) VALUES ('Gîte', 6)").run().lastInsertRowid);
db.prepare(`INSERT INTO pricing_rules (propertyId, label, pricePerNight, dateRanges, minNights) VALUES (?, 'An', 100, ?, 1)`)
  .run(pid, JSON.stringify([{ startDate: '2027-01-01', endDate: '2027-12-31' }]));

function send(body) {
  const r = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  bookingCtl.create({ body, headers: {}, query: {}, visitor: { ip: '81.250.12.4' } }, r);
  return r;
}
const guest = { firstName: 'Marie', lastName: 'Durand', email: 'chatty@example.fr', phone: '+33612345678' };

test('rule 30: past the cap, a touched quote answers messageAdded false and updated false, even to the token holder', () => {
  const s = { propertyId: pid, startDate: '2027-08-10', endDate: '2027-08-12', adults: 2, guest };
  const first = send(s).body.data;
  db.prepare("UPDATE reservations SET devisStatus = 'sent' WHERE id = ?").run(first.requestId);
  const added = send({ ...s, message: 'message 0' }).body.data;
  assert.equal(added.messageAdded, true);
  assert.equal(added.updated, true);
  for (let i = 1; i < 10; i += 1) send({ ...s, message: `message ${i}` });
  const capped = send({ ...s, message: 'message 11', publicToken: first.publicToken });
  assert.equal(capped.statusCode, 201);
  assert.equal(capped.body.data.messageAdded, false);
  assert.equal(capped.body.data.updated, false);
  assert.deepEqual(notified.at(-1), { id: first.requestId, updated: true, messageDropped: true }, 'the operator is still told');
});

test('rule 30: an untouched draft carries no messageAdded at all (it is updated, not message-only)', () => {
  const s = { propertyId: pid, startDate: '2027-09-10', endDate: '2027-09-12', guest: { ...guest, email: 'draft@example.fr' } };
  send({ ...s, adults: 2 });
  const again = send({ ...s, adults: 3 }).body.data;
  assert.equal(again.updated, true);
  assert.equal('messageAdded' in again, false);
});

test('rule 30: the drawer says nothing about a message on messageAdded false, and never pays a message-only answer', () => {
  const view = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', '..', 'integrations', 'wordpress', 'guestflow-booking', 'blocks', 'booking', 'view.js'), 'utf8');
  assert.match(view, /var messageOnly = typeof data\.messageAdded === 'boolean';/);
  assert.match(view, /if \(paying && !noQuote && !messageOnly\) \{/);
  assert.match(view, /if \(data\.messageAdded\) sentText = GF\.t\('messageAdded', askedOn\);\n\s*else if \(messageOnly\) sentText = GF\.t\('requestReceived'\);/);
});
