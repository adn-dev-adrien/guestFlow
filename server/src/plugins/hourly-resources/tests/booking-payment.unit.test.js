// specs/resource-booking-pricing-and-invoicing.md rules 11-13 — the payment of a booking, through the fiches' tender rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const { seed, book, card } = require('./standaloneBookingFixture');
const { FAR_YEAR: Y } = require('../../../tests/farYearFixture');

test('rule 11 — booking records nothing paid: paying is a moment of its own', () => {
  const { model, resourceId } = seed();
  const id = book(model, resourceId, { paid: true });
  const row = model.findById(id);
  assert.equal(row.paid, false);
  assert.equal(row.payment, null);
});

test('rule 11 — the lines must cover the total, with the fiches\' refusals', () => {
  const { model, resourceId } = seed();
  const id = book(model, resourceId);
  assert.match(model.recordPayment(id, { tenders: card(10000) }).error, /ne sont pas couverts/);
  assert.match(model.recordPayment(id, { tenders: card(13000) }).error, /pour 120,00 € dus/);
  assert.equal(model.recordPayment(id, { tenders: [{ method: 'card', amountCents: 12000, internal: true }] }).error, 'Seules les espèces peuvent aller en caisse interne.');
  assert.equal(model.recordPayment(id, { tenders: card(12000), paidAt: `${Y}-13-01` }).error, 'Date du paiement invalide.');
  const ok = model.recordPayment(id, { tenders: [{ method: 'cash', amountCents: 2000, internal: true }, { method: 'card', amountCents: 10000 }], paidAt: `${Y}-11-09` });
  assert.equal(ok.ok, true);
  const row = model.findById(id);
  assert.equal(row.paid, true);
  assert.equal(row.payment.paidAt, `${Y}-11-09`);
  assert.equal(row.payment.label, 'Espèces (caisse interne) · CB');
  assert.equal(row.payment.internalCents, 2000);
  assert.equal(row.payment.onTheBooks, false);
  assert.equal(row.payment.hasCard, true);
});

test('rule 12 — a payment is taken back until an invoice exists; a moving price asks for it first', () => {
  const { model, resourceId } = seed();
  const id = book(model, resourceId);
  model.recordPayment(id, { tenders: card(12000) });
  assert.equal(model.update(id, { offeredMinutes: 30 }).code, 'BOOKING_PAID');
  assert.equal(model.clearPayment(id).ok, true);
  assert.equal(model.findById(id).paid, false);
  assert.equal(model.update(id, { offeredMinutes: 30 }).ok, true);
});

test('rule 13 — a payment entirely on the books is invoiceable, a caisse-interne line is not', () => {
  const { model, resourceId } = seed();
  const a = book(model, resourceId);
  model.recordPayment(a, { tenders: card(12000) });
  assert.equal(model.findById(a).payment.onTheBooks, true);
  const b = book(model, resourceId, { startTime: '10:00', endTime: '11:00' });
  model.recordPayment(b, { tenders: [{ method: 'cash', amountCents: 5000, internal: true }] });
  assert.equal(model.findById(b).payment.onTheBooks, false);
});
