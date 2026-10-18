// specs/clients.md rule 14 — review 2026-10-18 (second pass), finding 3: a couple or a family often
// shares one phone, compared on its last 9 digits, and the fiche could only « Utiliser ce client ». The
// fiche now sends `allowDuplicate` with the typed client when « Créer quand même » is chosen.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const clientsModel = require('../models/clientsModel');
const reservationsController = require('../controllers/reservationsController');

const fakeRes = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

db.prepare("INSERT INTO properties (id, name, maxGuests) VALUES (1, 'Gîte', 8)").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (1, 'Standard', 100)").run();
const known = clientsModel.insert({ firstName: 'Camille', lastName: 'Revue', phone: '06 12 34 56 78' });

const stay = (over = {}) => ({
  propertyId: 1, startDate: '2027-05-10', endDate: '2027-05-13',
  checkInTime: '16:00', checkOutTime: '10:00', platform: 'direct',
  adults: 2, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 0, babyBeds: 0,
  ...over,
});

test('rule 14 — a typed client sharing a known phone is created with the stay once the fiche asks for it', () => {
  const partner = { firstName: 'Dominique', lastName: 'Revue', phone: '+33 6 12 34 56 78' };
  const refused = fakeRes();
  reservationsController.create({ body: stay({ newClient: partner }), user: { role: 'admin' } }, refused);
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.body.code, 'CLIENT_EXISTS');

  const res = fakeRes();
  reservationsController.create({ body: stay({ newClient: { ...partner, allowDuplicate: true } }), user: { role: 'admin' } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const client = db.prepare('SELECT c.id, c.firstName FROM reservations r JOIN clients c ON c.id = r.clientId WHERE r.id = ?').get(res.body.id);
  assert.notEqual(client.id, known.id, 'a second client, not the known one');
  assert.equal(client.firstName, 'Dominique');
});
