require('./isolatedDb');
// specs/public-request-abuse-and-grouping.md rule 10 — a website request nobody acted on is deleted 30
// days after its creation, with its CGV acceptance and the client created for it when nothing else
// names that client; one the operator opened, sent, edited or that has a payment link stays. A
// retired number is never handed out again.
const test = require('node:test');
const assert = require('node:assert/strict');

require('../../../utils/reservationHelpers').getTodayIsoDate = () => '2027-01-01';
const db = require('../../../database');
require('../settings').termsSettings = () => ({ requireTermsAcceptance: false });
require('../../../utils/notificationService').notifyNewSiteDevis = async () => {};
const bookingCtl = require('../controllers/publicBookingRequestController');
const devisModel = require('../../../models/devisModel');
const devisController = require('../../../controllers/devisController');
const { runRequestPurge } = require('../requestPurge');

const pid = db.prepare("INSERT INTO properties (name, maxGuests) VALUES ('Gîte', 6)").run().lastInsertRowid;
db.prepare(`INSERT INTO pricing_rules (propertyId, label, pricePerNight, dateRanges, minNights) VALUES (?, 'An', 100, ?, 1)`)
  .run(pid, JSON.stringify([{ startDate: '2027-01-01', endDate: '2027-12-31' }]));
const versionId = db.prepare(`INSERT INTO terms_versions (version, markdownFr, markdownEn, htmlFr, htmlEn, variablesJson, contentHash, publishedAt)
  VALUES (1, 'x', 'x', 'x', 'x', '{}', 'h', '2026-01-01')`).run().lastInsertRowid;

function res() {
  return { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
let day = 0;
function request(email) {
  day += 3;
  const start = new Date(Date.UTC(2027, 6, day)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(2027, 6, day + 2)).toISOString().slice(0, 10);
  const r = res();
  bookingCtl.create({ body: { propertyId: pid, startDate: start, endDate: end, adults: 2,
    guest: { firstName: 'A', lastName: 'B', email, phone: '+33612345678' } }, headers: {}, query: {}, visitor: {} }, r);
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  const id = r.body.data.requestId;
  db.prepare("INSERT INTO terms_acceptances (reservationId, termsVersionId, acceptedAt) VALUES (?, ?, '2026-01-01')").run(id, versionId);
  return id;
}
const age = (id, days) => db.prepare("UPDATE reservations SET createdAt = datetime('now', ?) WHERE id = ?").run(`-${days} days`, id);
const exists = (id) => Boolean(db.prepare('SELECT 1 FROM reservations WHERE id = ?').get(id));
const clientOf = (id) => db.prepare('SELECT clientId FROM reservations WHERE id = ?').get(id).clientId;
const clientExists = (cid) => Boolean(db.prepare('SELECT 1 FROM clients WHERE id = ?').get(cid));

test('an untouched 31-day request goes, with its acceptance, lines and lone client; its number is retired', () => {
  const id = request('lone@example.fr');
  const cid = clientOf(id);
  const number = db.prepare('SELECT devisNumber FROM reservations WHERE id = ?').get(id).devisNumber;
  age(id, 31);
  const out = runRequestPurge();
  assert.equal(exists(id), false);
  assert.equal(clientExists(cid), false);
  assert.ok(out.deleted >= 1 && out.clientsDeleted >= 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM terms_acceptances WHERE reservationId = ?').get(id).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_nights WHERE reservationId = ?').get(id).n, 0);
  const [prefix, n] = [number.slice(0, 8), parseInt(number.slice(8), 10)];
  const next = db.generateDevisNumber();
  if (next.startsWith(prefix)) assert.ok(parseInt(next.slice(8), 10) > n, 'never reused');
});

test('a 29-day request stays', () => {
  const id = request('young@example.fr');
  age(id, 29);
  runRequestPurge();
  assert.equal(exists(id), true);
});

test('a request the operator opened stays (operatorSeenAt set by GET /api/devis/:id)', () => {
  const id = request('opened@example.fr');
  devisController.getOne({ params: { id } }, res());
  assert.ok(db.prepare('SELECT operatorSeenAt FROM reservations WHERE id = ?').get(id).operatorSeenAt);
  age(id, 40);
  runRequestPurge();
  assert.equal(exists(id), true);
});

test('sent, edited or with a payment link: it stays', () => {
  const sent = request('sent@example.fr');
  db.prepare("UPDATE reservations SET devisStatus = 'sent' WHERE id = ?").run(sent);
  const edited = request('edited@example.fr');
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(edited);
  devisModel.update(edited, { ...row, adults: 3, status: 'draft' });
  const paid = request('paid@example.fr');
  db.prepare("INSERT INTO payment_links (reservationId, type, url, amountCents, status) VALUES (?, 'full', 'https://p', 100, 'paid')").run(paid);
  [sent, edited, paid].forEach((id) => age(id, 40));
  runRequestPurge();
  assert.equal(exists(sent), true);
  assert.equal(exists(edited), true);
  assert.equal(exists(paid), true);
});

test('a client with another reservation stays when its untouched request goes', () => {
  const id = request('kept@example.fr');
  const cid = clientOf(id);
  db.prepare("INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate) VALUES ('reservation', ?, ?, '2027-09-01', '2027-09-03')").run(pid, cid);
  age(id, 31);
  runRequestPurge();
  assert.equal(exists(id), false);
  assert.equal(clientExists(cid), true);
});
