// specs/clients.md rules 12-13 — review 2026-10-18, F6: « Créer un nouveau client » wrote the client at
// once (three abandoned fiches left three « Revueinte Camille ») and POST /api/clients took an email
// that already existed. A known email or phone is now refused with the existing client, and a client
// typed on a new fiche is written with the stay, in the same transaction.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const clientsModel = require('../models/clientsModel');
const clientsController = require('../controllers/clientsController');
const reservationsController = require('../controllers/reservationsController');
const { saveWithDraftClient } = require('../utils/draftClient');

const fakeRes = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const countClients = () => db.prepare('SELECT COUNT(*) AS n FROM clients').get().n;

db.prepare("INSERT INTO properties (id, name, maxGuests) VALUES (1, 'Gîte', 8)").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (1, 'Standard', 100)").run();
const known = clientsModel.insert({ firstName: 'Camille', lastName: 'Revue', email: 'Camille@Example.fr', phone: '06 12 34 56 78' });

test('rule 12 — the same email, whatever its case, is the existing client', () => {
  assert.equal(clientsModel.findDuplicate({ email: ' camille@example.FR ' }).id, known.id);
});

test('rule 12 — the same phone, national or international, is the existing client', () => {
  assert.equal(clientsModel.findDuplicate({ phone: '+33 6 12 34 56 78' }).id, known.id);
  assert.equal(clientsModel.findDuplicate({ phone: '0712345678', email: 'other@example.fr' }), undefined);
  assert.equal(clientsModel.findDuplicate({}), undefined);
});

test('rule 12 — POST /clients refuses a duplicate with 409 CLIENT_EXISTS and the client, unless asked', () => {
  const before = countClients();
  const res = fakeRes();
  clientsController.create({ body: { firstName: 'Camille', lastName: 'Revue', email: 'camille@example.fr' } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'CLIENT_EXISTS');
  assert.equal(res.body.client.id, known.id);
  assert.equal(res.body.error, 'Client existant : Camille Revue (Camille@Example.fr).');
  assert.equal(countClients(), before);

  const forced = fakeRes();
  clientsController.create({ body: { firstName: 'Camille', lastName: 'Revue', email: 'camille@example.fr', allowDuplicate: true } }, forced);
  assert.equal(forced.statusCode, 200);
  assert.equal(countClients(), before + 1);
  db.prepare('DELETE FROM clients WHERE id = ?').run(forced.body.id);
});

test('rule 12 — GET /clients/duplicate answers the client the record would duplicate, or null', () => {
  const hit = fakeRes();
  clientsController.duplicate({ query: { email: 'camille@example.fr' } }, hit);
  assert.equal(hit.body.client.id, known.id);
  assert.match(hit.body.message, /^Client existant : Camille Revue/);
  const miss = fakeRes();
  clientsController.duplicate({ query: { email: 'nobody@example.fr' } }, miss);
  assert.deepEqual(miss.body, { client: null });
});

const stay = (over = {}) => ({
  propertyId: 1, startDate: '2027-03-10', endDate: '2027-03-13',
  checkInTime: '16:00', checkOutTime: '10:00', platform: 'direct',
  adults: 2, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 0, babyBeds: 0,
  ...over,
});

test('rule 13 — a stay saved with a typed client writes both, the stay pointing at the new client', () => {
  const before = countClients();
  const res = fakeRes();
  reservationsController.create({ body: stay({ newClient: { firstName: 'Léa', lastName: 'Nouvelle', email: 'lea@example.fr' } }), user: { role: 'admin' } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(countClients(), before + 1);
  const row = db.prepare('SELECT c.email FROM reservations r JOIN clients c ON c.id = r.clientId WHERE r.id = ?').get(res.body.id);
  assert.equal(row.email, 'lea@example.fr');
});

test('rule 13 — a refused save leaves no client behind', () => {
  const before = countClients();
  const res = fakeRes();
  // Same dates as the stay above: the overlap refuses the save.
  reservationsController.create({ body: stay({ newClient: { firstName: 'Paul', lastName: 'Refusé', email: 'paul@example.fr' } }), user: { role: 'admin' } }, res);
  assert.notEqual(res.statusCode, 200);
  assert.equal(countClients(), before);
});

test('rule 13 — a typed client that duplicates a known one is refused before anything is written', () => {
  const before = countClients();
  const reservationsBefore = db.prepare('SELECT COUNT(*) AS n FROM reservations').get().n;
  const res = fakeRes();
  reservationsController.create({ body: stay({ startDate: '2027-04-10', endDate: '2027-04-13', newClient: { firstName: 'C', lastName: 'R', email: 'camille@example.fr' } }), user: { role: 'admin' } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'CLIENT_EXISTS');
  assert.equal(countClients(), before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservations').get().n, reservationsBefore);
});

test('rule 13 — a body that names its client, or carries no draft, is passed through', () => {
  const calls = [];
  const run = (body) => { calls.push(body); return { status: 200, body: { ok: true } }; };
  saveWithDraftClient({ db, clientsModel, body: { clientId: 5, newClient: { lastName: 'X', firstName: 'Y' } }, run });
  saveWithDraftClient({ db, clientsModel, body: { clientId: null }, run });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].clientId, 5);
  const missingName = saveWithDraftClient({ db, clientsModel, body: { newClient: { email: 'a@b.fr' } }, run });
  assert.equal(missingName.status, 400);
});
