// specs/payment-link-lifecycle.md rule 46 (§9 Q13) — a devis is never written on nights a stay holds: created there
// or moved there (dates or logement), it is refused 409 DATES_HELD « Dates déjà réservées : devis non enregistré. »
// with the stays that block, ConflictList-shaped. Other edits of a devis already there pass; an unpaid row refuses
// nothing. Rule 48 (§9 Q15): a devis whose nights were taken since stays as it is, marked « Dates prises ».

const test = require('node:test');
const assert = require('node:assert/strict');

const { db, inDays, freshProperty, addStay } = require('./datesTakenFixture');
const devisModel = require('../models/devisModel');

const payload = (propertyId, start, end, extra = {}) => ({ propertyId, clientId: 1, startDate: start, endDate: end, adults: 2, ...extra });
const MESSAGE = 'Dates déjà réservées : devis non enregistré.';

test('rule 46: a devis created on held nights is refused with the stays that hold them', () => {
  const propertyId = freshProperty();
  const held = addStay({ propertyId, start: inDays(40), end: inDays(44), depositPaid: 1 });
  const out = devisModel.create(payload(propertyId, inDays(42), inDays(46)));
  assert.equal(out.status, 409);
  assert.equal(out.code, 'DATES_HELD');
  assert.equal(out.error, MESSAGE);
  assert.equal(out.stays.length, 1);
  assert.equal(out.stays[0].id, held);
  assert.equal(out.stays[0].url, `/reservations/${held}`);
  assert.match(out.stays[0].label, new RegExp(`^T${held} · Lina Exemple · \\d{2}/\\d{2} → \\d{2}/\\d{2}$`));
});

test('rule 46: on nights of an unpaid direct reservation or another devis, the devis is saved', () => {
  const propertyId = freshProperty();
  addStay({ propertyId, start: inDays(50), end: inDays(53) });
  addStay({ propertyId, kind: 'devis', start: inDays(50), end: inDays(53) });
  assert.equal(devisModel.create(payload(propertyId, inDays(50), inDays(53))).ok, true);
});

test('rule 46: moving a devis onto held nights is refused; its other edits on held nights pass', () => {
  const propertyId = freshProperty();
  addStay({ propertyId, platform: 'Booking', start: inDays(60), end: inDays(63) });
  const created = devisModel.create(payload(propertyId, inDays(70), inDays(73)));
  const id = created.data.id;
  const moved = devisModel.update(id, payload(propertyId, inDays(61), inDays(64)));
  assert.equal(moved.code, 'DATES_HELD');
  // A stay that arrives later takes the nights: the devis keeps its other edits.
  addStay({ propertyId, platform: 'Airbnb', start: inDays(71), end: inDays(72) });
  const edited = devisModel.update(id, payload(propertyId, inDays(70), inDays(73), { notes: 'Arrivée tardive' }));
  assert.equal(edited.ok, true, JSON.stringify(edited));
});

test('rule 46: moving it to another logement whose nights are held is refused', () => {
  const a = freshProperty();
  const b = freshProperty();
  addStay({ propertyId: b, start: inDays(80), end: inDays(83), depositPaid: 1 });
  const id = devisModel.create(payload(a, inDays(80), inDays(83))).data.id;
  assert.equal(devisModel.update(id, payload(b, inDays(80), inDays(83))).code, 'DATES_HELD');
});

test('rule 46: the controller answers the refusal with its code and its stays', () => {
  const propertyId = freshProperty();
  addStay({ propertyId, platform: 'Booking', start: inDays(90), end: inDays(93) });
  const controller = require('../controllers/devisController').buildController(devisModel);
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  controller.create({ body: payload(propertyId, inDays(90), inDays(92)) }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'DATES_HELD');
  assert.equal(res.body.error, MESSAGE);
  assert.equal(res.body.stays.length, 1);
});

test('rule 48: a devis whose nights a stay took since is marked « Dates prises », in its payload and its list row', () => {
  const propertyId = freshProperty();
  const id = devisModel.create(payload(propertyId, inDays(100), inDays(103))).data.id;
  assert.equal(devisModel.findById(id).datesTaken, null);
  const holder = addStay({ propertyId, platform: 'Booking', start: inDays(101), end: inDays(102) });
  const marker = devisModel.findById(id).datesTaken;
  assert.equal(marker.label, 'Dates prises');
  assert.equal(marker.takenBy.id, holder);
  assert.equal(marker.takenBy.url, `/reservations/${holder}`);
  const listed = devisModel.list({ propertyId }).find((d) => d.id === id);
  assert.equal(listed.datesTaken.takenBy.id, holder);
});

test('rule 48: an unpaid reservation on taken nights carries the marker; a paid one does not', async () => {
  const propertyId = freshProperty();
  const unpaid = addStay({ propertyId, start: inDays(110), end: inDays(113) });
  const paid = addStay({ propertyId, start: inDays(110), end: inDays(113), depositPaid: 1 });
  addStay({ propertyId, platform: 'Booking', start: inDays(111), end: inDays(112) });
  const { datesTakenMarker } = require('../utils/datesTaken');
  const row = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  assert.equal(datesTakenMarker(db, row(unpaid)).label, 'Dates prises');
  assert.equal(datesTakenMarker(db, row(paid)), null);
});
