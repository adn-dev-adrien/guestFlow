// specs/payment-link-lifecycle.md rule 46, reading of 2026-11-01 (audit R11-2, decided by Adrien: refuse) and rule 55 —
// « Transformer en devis » copies its source stay's nights, so it is judged like any other devis creation: refused
// 409 DATES_HELD « Dates déjà réservées : devis non enregistré. » when the stay holds those nights (a platform stay,
// a direct stay with money), 409 CLOSED_DATES when a closure covers them. No devis row is written on a refusal.

const test = require('node:test');
const assert = require('node:assert/strict');

const { db, inDays, freshProperty, addStay } = require('./datesTakenFixture');
const devisModel = require('../models/devisModel');

const devisCount = () => db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE kind = 'devis'").get().n;
const close = (propertyId, start, end) => Number(db.prepare("INSERT INTO establishment_closures (propertyId, label, startDate, endDate) VALUES (?, 'Travaux', ?, ?)").run(propertyId, start, end).lastInsertRowid);

test('rule 46 (R11-2): a direct stay with money is not turned into a devis on its own held nights', () => {
  const propertyId = freshProperty();
  const source = addStay({ propertyId, start: inDays(40), end: inDays(45), depositPaid: 1 });
  const before = devisCount();
  const out = devisModel.convertFromReservation(source);
  assert.equal(out.status, 409);
  assert.equal(out.code, 'DATES_HELD');
  assert.equal(out.error, 'Dates déjà réservées : devis non enregistré.');
  assert.deepEqual(out.stays.map((s) => s.id), [source]);
  assert.equal(out.stays[0].url, `/reservations/${source}`);
  assert.equal(devisCount(), before);
});

test('rule 46 (R11-2): a platform stay is not turned into a devis either', () => {
  const propertyId = freshProperty();
  const source = addStay({ propertyId, platform: 'Booking', start: inDays(50), end: inDays(53) });
  const out = devisModel.convertFromReservation(source);
  assert.equal(out.code, 'DATES_HELD');
  assert.deepEqual(out.stays.map((s) => s.id), [source]);
});

test('rule 46 (R11-2): another stay holding the nights refuses the conversion of an unpaid one', () => {
  const propertyId = freshProperty();
  const source = addStay({ propertyId, start: inDays(60), end: inDays(64) });
  const holder = addStay({ propertyId, platform: 'Airbnb', start: inDays(62), end: inDays(63) });
  const out = devisModel.convertFromReservation(source);
  assert.equal(out.code, 'DATES_HELD');
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
  assert.equal(out.error, 'Logement fermé sur ces dates : devis non enregistré.');
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
  assert.equal(res.body.error, 'Dates déjà réservées : devis non enregistré.');
  assert.equal(res.body.stays[0].id, source);
});
