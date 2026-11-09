// specs/resource-booking-pricing-and-invoicing.md rules 34, 36, 37 (R35-C-M2, R35-M-L1, R35-DB-L1) — a paid booking is a
// sale: it is not deleted before its payment is taken back, it keeps the total its payment covers when only its notes or
// client move (whatever the tariff now), and `paid` is the truth a rolled-back release's untick writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { seed, book, card, DAY } = require('./standaloneBookingFixture');
const { createInvoicing } = require('../invoicing');

const salesOf = (model) => model.standaloneSales({ from: `${DAY.slice(0, 4)}-01-01`, to: `${DAY.slice(0, 4)}-12-31` });

test('rule 34 — a paid booking is not deleted: its payment is taken back first, then it goes', () => {
  const { model, resourceId } = seed();
  const id = book(model, resourceId);
  model.recordPayment(id, { tenders: card(12000), paidAt: DAY });
  const refused = model.remove(id);
  assert.equal(refused.status, 409);
  assert.equal(refused.code, 'BOOKING_PAID');
  assert.equal(refused.error, 'Payée : retirer d’abord le paiement enregistré.');
  assert.equal(salesOf(model).length, 1);
  assert.equal(model.clearPayment(id).ok, true);
  assert.equal(model.remove(id).ok, true);
});

test('rule 36 — after a tariff change, the notes and the client of a paid booking still save, at the paid total', () => {
  const { model, resourceId, db } = seed();
  const id = book(model, resourceId);
  model.recordPayment(id, { tenders: card(12000), paidAt: DAY });
  db.prepare('UPDATE resources SET hourlyExternalDayRate = 55 WHERE id = ?').run(resourceId);
  const out = model.update(id, { notes: 'Serviette', clientName: 'Ana Lune', date: DAY, startTime: '18:00', endTime: '20:00', offeredMinutes: 0, propertyId: null });
  assert.equal(out.ok, true);
  assert.equal(out.totalPrice, 120);
  assert.equal(model.findById(id).totalPrice, 120);
  assert.equal(model.update(id, { endTime: '20:30' }).code, 'BOOKING_PAID', 'a real move still asks the payment back');
});

test('rule 36 — the invoice of a booking whose tariff moved since its payment is refused before Qonto', async () => {
  const { model, resourceId, db } = seed();
  const id = book(model, resourceId);
  model.recordPayment(id, { tenders: card(12000), paidAt: DAY });
  db.prepare('UPDATE resources SET hourlyExternalDayRate = 60, hourlyExternalEveningRate = 80 WHERE id = ?').run(resourceId);
  let called = false;
  const invoicing = createInvoicing({
    bookings: () => model, issuers: () => ({ isReady: () => true, async issue() { called = true; return {}; } }), logger: { error() {}, warn() {} },
  });
  const out = await invoicing.issue(id);
  assert.equal(out.status, 409);
  assert.equal(out.code, 'TARIFF_CHANGED');
  assert.equal(called, false);
});

test('rule 37 — a release before 1.4.0 unticks « Payé » (paid = 0 only): the booking reads unpaid and leaves the journal', () => {
  const { model, resourceId, db } = seed();
  const id = book(model, resourceId);
  model.recordPayment(id, { tenders: [{ method: 'cheque', amountCents: 12000 }], paidAt: DAY });
  db.prepare('UPDATE resource_bookings SET paid = 0 WHERE id = ?').run(id);
  const row = model.findById(id);
  assert.equal(row.paid, false);
  assert.equal(row.payment, null);
  assert.deepEqual(salesOf(model), []);
  assert.equal(model.remove(id).ok, true);
});
