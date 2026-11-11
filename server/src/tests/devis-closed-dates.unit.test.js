// specs/payment-link-lifecycle.md rule 55 (audit R10-1, decided by Adrien 2026-10-31) — a devis is never written on
// nights an establishment closure covers: created there, or moved there (dates or logement, operator or website
// source), it is refused 409 CLOSED_DATES « Logement fermé sur ces dates : devis non enregistré. », with the closure
// to open. A devis already on closed nights keeps its other edits. Defence in depth: a devis link paid anyway is
// converted, but the guest gets no confirmation and the admin the « déplacer ou rembourser » alert.

const test = require('node:test');
const assert = require('node:assert/strict');

const { db, inDays, freshProperty, addStay, addLink } = require('./datesTakenFixture');
const devisModel = require('../models/devisModel');
const paymentLinksModel = require('../models/paymentLinksModel');
const { processPaidLink } = require('../utils/paymentPollRunner');
const { conflictCheckerFor } = require('../utils/paymentEffectDeps');

const MESSAGE = 'Logement fermé sur ces dates : devis non enregistré.';
const payload = (propertyId, start, end, extra = {}) => ({ propertyId, clientId: 1, startDate: start, endDate: end, adults: 2, ...extra });
const close = (propertyId, start, end) => Number(db.prepare("INSERT INTO establishment_closures (propertyId, label, startDate, endDate) VALUES (?, 'Travaux', ?, ?)").run(propertyId, start, end).lastInsertRowid);

test('rule 55: a devis created on closed nights is refused with the closure', () => {
  const propertyId = freshProperty();
  const closure = close(propertyId, inDays(40), inDays(42));
  const out = devisModel.create(payload(propertyId, inDays(41), inDays(44)));
  assert.equal(out.status, 409);
  assert.equal(out.code, 'CLOSED_DATES');
  assert.equal(out.error, MESSAGE);
  assert.equal(out.closures.length, 1);
  assert.equal(out.closures[0].id, closure);
  assert.match(out.closures[0].label, /^Travaux · \d{2}\/\d{2} → \d{2}\/\d{2}$/);
  assert.equal(out.closures[0].url, '/establishment-closures');
});

test('rule 55: an establishment-wide closure counts; the departure day on a closure start does not', () => {
  const propertyId = freshProperty();
  close(null, inDays(50), inDays(52));
  assert.equal(devisModel.create(payload(propertyId, inDays(51), inDays(53))).code, 'CLOSED_DATES');
  assert.equal(devisModel.create(payload(propertyId, inDays(47), inDays(50))).ok, true);
  db.prepare('DELETE FROM establishment_closures WHERE propertyId IS NULL').run();
});

test('rule 55 (R10-1): moving a devis with an open link onto closed nights is refused; the link stays as it was', () => {
  const propertyId = freshProperty();
  const id = devisModel.create(payload(propertyId, inDays(60), inDays(62))).data.id;
  const link = addLink(id, { type: 'full' });
  close(propertyId, inDays(70), inDays(72));
  const moved = devisModel.update(id, payload(propertyId, inDays(70), inDays(72)));
  assert.equal(moved.code, 'CLOSED_DATES');
  assert.equal(db.prepare('SELECT startDate FROM reservations WHERE id = ?').get(id).startDate, inDays(60));
  assert.equal(paymentLinksModel.findById(link).status, 'open');
});

test('rule 55: a website request moving its devis onto closed nights is refused too', () => {
  const propertyId = freshProperty();
  const id = devisModel.create(payload(propertyId, inDays(80), inDays(82))).data.id;
  close(propertyId, inDays(90), inDays(92));
  assert.equal(devisModel.update(id, payload(propertyId, inDays(90), inDays(92)), { source: 'public' }).code, 'CLOSED_DATES');
});

test('rule 55: a notes edit of a devis already on closed nights saves; another logement whose nights are closed refuses', () => {
  const a = freshProperty();
  const b = freshProperty();
  const id = devisModel.create(payload(a, inDays(100), inDays(103))).data.id;
  close(a, inDays(101), inDays(102));
  assert.equal(devisModel.update(id, payload(a, inDays(100), inDays(103), { notes: 'Arrivée tardive' })).ok, true);
  close(b, inDays(100), inDays(103));
  assert.equal(devisModel.update(id, payload(b, inDays(100), inDays(103))).code, 'CLOSED_DATES');
});

test('rule 55: the controller answers the refusal with its code and its closures', () => {
  const propertyId = freshProperty();
  close(propertyId, inDays(110), inDays(112));
  const controller = require('../controllers/devisController').buildController(devisModel);
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  controller.create({ body: payload(propertyId, inDays(110), inDays(111)) }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'CLOSED_DATES');
  assert.equal(res.body.error, MESSAGE);
  assert.equal(res.body.closures.length, 1);
});

test('rule 55 (defence in depth): a devis link paid on closed nights converts without a guest confirmation, and alerts', async () => {
  const propertyId = freshProperty();
  const devisId = addStay({ propertyId, kind: 'devis', start: inDays(120), end: inDays(123) });
  const link = addLink(devisId, { type: 'full', amountCents: 40000 });
  close(propertyId, inDays(121), inDays(122));
  const confirmed = [];
  const notified = [];
  const conflicts = [];
  const out = await processPaidLink({
    database: db, devisModel, paymentLinksModel, link: paymentLinksModel.findById(link),
    paidPayment: { paid: true, paymentId: 'pay_closed', paidAt: new Date().toISOString() },
    checkConflict: conflictCheckerFor(db),
    sendConfirmation: async (id) => { confirmed.push(id); },
    notifyConflict: async (id) => { conflicts.push(id); },
    notifyPaidAfterCancel: async (l, o) => { notified.push(o); },
    emitPluginEvent: () => {},
  });
  assert.equal(out.effect, 'converted');
  assert.deepEqual(confirmed, [], 'no confirmation for closed nights');
  assert.ok(notified.some((o) => o && o.nightsUnavailable === 'closed'), JSON.stringify(notified));
  assert.equal(conflicts.length, 1);
});

test('rule 55 (defence in depth): a devis link paid on open nights still confirms the guest', async () => {
  const propertyId = freshProperty();
  const devisId = addStay({ propertyId, kind: 'devis', start: inDays(130), end: inDays(133) });
  const link = addLink(devisId, { type: 'full', amountCents: 40000 });
  const confirmed = [];
  await processPaidLink({
    database: db, devisModel, paymentLinksModel, link: paymentLinksModel.findById(link),
    paidPayment: { paid: true, paymentId: 'pay_open', paidAt: new Date().toISOString() },
    checkConflict: conflictCheckerFor(db), sendConfirmation: async (id) => { confirmed.push(id); },
    notifyPaidAfterCancel: async () => {}, emitPluginEvent: () => {},
  });
  assert.equal(confirmed.length, 1);
});

test('rule 55 (defence in depth): the alert says the nights are closed and what to do', () => {
  const { subject, text } = require('../utils/notificationService').__test.buildPaidAfterCancelEmail(
    { id: 9, kind: 'reservation', propertyName: 'Logement', startDate: inDays(10), endDate: inDays(12) },
    { id: 3, amountCents: 12000 }, '', { nightsUnavailable: 'closed', livePayment: true },
  );
  assert.match(subject, /Paiement reçu sur des dates fermées/);
  assert.match(text, /payé pour des nuits où le logement est fermé/);
  assert.match(text, /Action requise : déplacer le séjour ou le rembourser\./);
  assert.doesNotMatch(text, /retiré à la main/);
});
