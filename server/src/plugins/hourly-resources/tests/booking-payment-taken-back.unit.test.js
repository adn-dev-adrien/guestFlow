// specs/resource-booking-pricing-and-invoicing.md rule 36 (R35b N2) — once its payment is taken back, a booking is
// priced again at its next save like any unpaid one: after a tariff change, a save that moves nothing priced stores the
// live total, the dialog's preview shows that same total before the save, and the payment then asks for it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { seed, book, card, DAY } = require('./standaloneBookingFixture');

test('rule 36 — after « Retirer le paiement » and a tariff change, the next save stores the total the preview showed', () => {
  const { model, resourceId, db } = seed();
  const id = book(model, resourceId);
  assert.equal(model.recordPayment(id, { tenders: card(12000), paidAt: DAY }).ok, true);
  db.prepare('UPDATE resources SET hourlyExternalDayRate = 55 WHERE id = ?').run(resourceId);
  assert.equal(model.clearPayment(id).ok, true);
  const shown = model.priceBooking({ resourceId, bookingId: id, date: DAY, startTime: '18:00', endTime: '20:00', offeredMinutes: 0 });
  assert.equal(shown.total, 125);
  const out = model.update(id, { notes: 'Serviette', displayedTotal: shown.total });
  assert.equal(out.ok, true);
  assert.equal(out.totalPrice, 125);
  assert.equal(out.warning, null, 'what was shown is what is stored');
  assert.equal(model.recordPayment(id, { tenders: card(12000), paidAt: DAY }).ok, undefined, 'the old amount no longer covers it');
  assert.equal(model.recordPayment(id, { tenders: card(12500), paidAt: DAY }).ok, true);
  assert.equal(model.findById(id).totalPrice, 125);
});
