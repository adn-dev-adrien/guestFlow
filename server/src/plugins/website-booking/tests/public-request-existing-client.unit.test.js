require('./isolatedDb');
// specs/public-api.md rule 13 (2026-10-27 audit) — an anonymous request whose e-mail matches a client
// never changes that client (name, phone, language); the identity the visitor typed lands on the devis
// notes, for the operator to read.
const test = require('node:test');
const assert = require('node:assert/strict');

require('../../../utils/reservationHelpers').getTodayIsoDate = () => '2027-01-01';
const db = require('../../../database');
require('../settings').termsSettings = () => ({ requireTermsAcceptance: false });
const bookingCtl = require('../controllers/publicBookingRequestController');

const pid = db.prepare("INSERT INTO properties (name, maxGuests) VALUES ('Gîte', 6)").run().lastInsertRowid;
db.prepare(`INSERT INTO pricing_rules (propertyId, label, pricePerNight, dateRanges, minNights) VALUES (?, 'An', 100, ?, 1)`)
  .run(pid, JSON.stringify([{ startDate: '2027-01-01', endDate: '2027-12-31' }]));
const clientId = db.prepare(`INSERT INTO clients (firstName, lastName, email, phone, emailLanguage)
  VALUES ('Marie', 'Durand', 'marie@example.fr', '06 12 34 56 78', 'fr')`).run().lastInsertRowid;

function res() {
  return { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
function request(guest, extra = {}) {
  const r = res();
  bookingCtl.create({
    body: { propertyId: pid, startDate: extra.startDate || '2027-07-03', endDate: extra.endDate || '2027-07-05', adults: 2, guest, ...extra.body },
    headers: {}, query: {},
  }, r);
  return r;
}
const client = () => db.prepare('SELECT firstName, lastName, phone, emailLanguage FROM clients WHERE id = ?').get(clientId);
const notesOf = (r) => db.prepare('SELECT clientId, notes FROM reservations WHERE id = ?').get(r.body.data.requestId);

test('another identity and an English page leave the client untouched and note what was typed', () => {
  const r = request(
    { firstName: 'Mallory', lastName: 'Evil', email: 'MARIE@example.fr', phone: '+44 7700 900123' },
    { body: { lang: 'en', message: 'Arrivée tardive' } },
  );
  assert.equal(r.statusCode, 201);
  assert.deepEqual(client(), { firstName: 'Marie', lastName: 'Durand', phone: '06 12 34 56 78', emailLanguage: 'fr' });
  const row = notesOf(r);
  assert.equal(row.clientId, clientId);
  assert.equal(row.notes, "Arrivée tardive\n\nClient existant reconnu par l'e-mail — identité saisie : Mallory Evil, +44 7700 900123, langue en. La fiche client n'a pas été modifiée.");
});

test('the same identity, phone written differently, adds no note', () => {
  const r = request({ firstName: 'marie', lastName: 'DURAND', email: 'marie@example.fr', phone: '06.12.34.56.78' }, { startDate: '2027-08-07', endDate: '2027-08-09' });
  assert.equal(r.statusCode, 201);
  assert.equal(notesOf(r).notes || '', '');
});
