// specs/payment-link-lifecycle.md rule 46, reading of 2026-11-01 (audit R11-2, decided by Adrien: refuse) and rule 55 —
// « Transformer en devis » copies its source stay's nights, so it is judged like any other devis creation: refused
// 409 CLOSED_DATES when a closure covers them, 409 DATES_HELD when a stay holds them. Review of #915 (finding 1):
// when that stay is the source itself, the refusal says so (« Séjour déjà payé : devis non créé. ») and never lists
// the fiche the operator is on; and GET /api/reservations/:id carries that reason (`convertToDevisLockedReason`) so
// the fiche disables the action before anyone confirms it. No devis row is written on a refusal.

const test = require('node:test');
const assert = require('node:assert/strict');

const { db, inDays, freshProperty, addStay } = require('./datesTakenFixture');
const devisModel = require('../models/devisModel');

const devisCount = () => db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE kind = 'devis'").get().n;
const close = (propertyId, start, end) => Number(db.prepare("INSERT INTO establishment_closures (propertyId, label, startDate, endDate) VALUES (?, 'Travaux', ?, ?)").run(propertyId, start, end).lastInsertRowid);

test('rule 46 (R11-2): a direct stay with money is not turned into a devis on its own held nights, and is not listed', () => {
  const propertyId = freshProperty();
  const source = addStay({ propertyId, start: inDays(40), end: inDays(45), depositPaid: 1 });
  const before = devisCount();
  const out = devisModel.convertFromReservation(source);
  assert.equal(out.status, 409);
  assert.equal(out.code, 'DATES_HELD');
  assert.equal(out.error, 'Séjour déjà payé : devis non créé.');
  assert.deepEqual(out.stays, []);
  assert.equal(devisCount(), before);
});

test('rule 46 (R11-2): a platform stay is not turned into a devis either, with its own sentence', () => {
  const propertyId = freshProperty();
  const source = addStay({ propertyId, platform: 'Booking', start: inDays(50), end: inDays(53) });
  const out = devisModel.convertFromReservation(source);
  assert.equal(out.code, 'DATES_HELD');
  assert.equal(out.error, 'Séjour de plateforme : devis non créé.');
  assert.deepEqual(out.stays, []);
});

test('rule 46 (R11-2): a source holding its nights alongside another stay names the source reason and lists only the other', () => {
  const propertyId = freshProperty();
  const source = addStay({ propertyId, start: inDays(54), end: inDays(58), depositPaid: 1 });
  const other = addStay({ propertyId, platform: 'Airbnb', start: inDays(56), end: inDays(57) });
  const out = devisModel.convertFromReservation(source);
  assert.equal(out.error, 'Séjour déjà payé : devis non créé.');
  assert.deepEqual(out.stays.map((s) => s.id), [other]);
});

test('rule 46 (R11-2): another stay holding the nights refuses the conversion of an unpaid one', () => {
  const propertyId = freshProperty();
  const source = addStay({ propertyId, start: inDays(60), end: inDays(64) });
  const holder = addStay({ propertyId, platform: 'Airbnb', start: inDays(62), end: inDays(63) });
  const out = devisModel.convertFromReservation(source);
  assert.equal(out.code, 'DATES_HELD');
  assert.equal(out.error, 'Dates déjà réservées : devis non créé.');
  assert.deepEqual(out.stays.map((s) => s.id), [holder]);
});

test('rule 55 (R11-2): nights a closure covers refuse the conversion with the closure, before the held check', () => {
  const propertyId = freshProperty();
  const source = addStay({ propertyId, start: inDays(70), end: inDays(73), depositPaid: 1 });
  const closure = close(propertyId, inDays(71), inDays(72));
  const before = devisCount();
  const out = devisModel.convertFromReservation(source);
  assert.equal(out.status, 409);
  assert.equal(out.code, 'CLOSED_DATES');
  assert.equal(out.error, 'Logement fermé sur ces dates : devis non créé.');
  assert.deepEqual(out.closures.map((c) => c.id), [closure]);
  assert.equal(devisCount(), before);
});

test('rule 46 (R11-2): an unpaid direct stay on free nights still becomes a devis, without the « Dates prises » marker', () => {
  const propertyId = freshProperty();
  const source = addStay({ propertyId, start: inDays(80), end: inDays(83) });
  const out = devisModel.convertFromReservation(source);
  assert.equal(out.status, 201, JSON.stringify(out));
  assert.equal(out.data.kind, 'devis');
  assert.equal(out.data.startDate, inDays(80));
  assert.equal(out.data.datesTaken, null);
});

test('rule 46 (R11-2): the controller answers the refusal with its code and its stays', () => {
  const propertyId = freshProperty();
  const source = addStay({ propertyId, platform: 'Booking', start: inDays(90), end: inDays(92) });
  const controller = require('../controllers/devisController').buildController(devisModel);
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  controller.convertFromReservation({ params: { reservationId: String(source) } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'DATES_HELD');
  assert.equal(res.body.error, 'Séjour de plateforme : devis non créé.');
  assert.deepEqual(res.body.stays, []);
});

test('rule 46 (R11-2, show before refusing): the stay carries the reason the conversion would be refused for', () => {
  const propertyId = freshProperty();
  const paid = addStay({ propertyId, start: inDays(100), end: inDays(103), depositPaid: 1 });
  const free = addStay({ propertyId, start: inDays(110), end: inDays(113) });
  const closed = addStay({ propertyId, start: inDays(120), end: inDays(123) });
  close(propertyId, inDays(121), inDays(122));
  const crossed = addStay({ propertyId, start: inDays(130), end: inDays(134) });
  addStay({ propertyId, platform: 'Airbnb', start: inDays(131), end: inDays(132) });
  assert.equal(devisModel.convertToDevisLockedReason(paid), 'Séjour déjà payé : devis non créé.');
  assert.equal(devisModel.convertToDevisLockedReason(closed), 'Logement fermé sur ces dates : devis non créé.');
  assert.equal(devisModel.convertToDevisLockedReason(free), null);
  // Another stay on the nights is a refusal of the POST (with that stay to open), not a lock of this fiche.
  assert.equal(devisModel.convertToDevisLockedReason(crossed), null);
});

test('rule 46 (R11-2, show before refusing): GET /api/reservations/:id answers convertToDevisLockedReason', () => {
  const propertyId = freshProperty();
  const paid = addStay({ propertyId, start: inDays(140), end: inDays(143), depositPaid: 1 });
  const free = addStay({ propertyId, start: inDays(150), end: inDays(153) });
  const controller = require('../controllers/reservationsController');
  const get = (id) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    controller.getById({ params: { id: String(id) }, user: { id: 1, roles: ['admin'] } }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    return res.body;
  };
  assert.equal(get(paid).convertToDevisLockedReason, 'Séjour déjà payé : devis non créé.');
  assert.equal(get(free).convertToDevisLockedReason, null);
});
