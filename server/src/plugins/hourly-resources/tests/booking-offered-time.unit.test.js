// specs/resource-booking-pricing-and-invoicing.md rules 7-10 — offered time, by steps of 15 minutes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { seed, book, DAY } = require('./standaloneBookingFixture');

const draft = (resourceId, extra = {}) => ({ resourceId, date: DAY, startTime: '18:00', endTime: '20:00', ...extra });

test('rule 7 — offered minutes are deducted after the property ones, from the start, at the band they fall in', () => {
  const { model, resourceId } = seed();
  const out = model.priceBooking(draft(resourceId, { propertyId: 2, offeredMinutes: 15 }));
  assert.equal(out.freeMinutesApplied, 60);
  assert.equal(out.offeredMinutesApplied, 15);
  assert.equal(out.offeredValue, 17.5); // 15 min of the 70 € evening hour
  const external = model.priceBooking(draft(resourceId, { offeredMinutes: 45 }));
  assert.equal(external.offeredValue, 37.5); // 45 min of the 50 € day hour
  assert.equal(external.total, 82.5);
});

test('rule 7 — offered time moves only by steps of 15 minutes', () => {
  const { model, resourceId } = seed();
  assert.equal(model.priceBooking(draft(resourceId, { offeredMinutes: 10 })).error, 'Temps offert invalide : par tranche de 15 min.');
  assert.equal(model.priceBooking(draft(resourceId, { offeredMinutes: 30 })).offeredMinutesApplied, 30);
});

test('rule 8 — offered time never grows the slot: occupancy is the booked range', () => {
  const { model, resourceId } = seed();
  const id = book(model, resourceId, { offeredMinutes: 60 });
  const row = model.findById(id);
  assert.equal(row.startTime, '18:00');
  assert.equal(row.endTime, '20:00');
  const next = model.createBooking({ resourceId, date: DAY, startTime: '20:00', endTime: '21:00', clientName: 'Paul' });
  assert.equal(next.ok, true);
});

test('rule 9 — the refusals, the same from the preview and the commit', () => {
  const { model, resourceId } = seed();
  for (const bad of [-15, 'abc', 7.5, { n: 1 }]) {
    assert.equal(model.priceBooking(draft(resourceId, { offeredMinutes: bad })).error, 'Temps offert invalide : par tranche de 15 min.');
  }
  assert.equal(model.priceBooking(draft(resourceId, { offeredMinutes: 135 })).error, 'Le temps offert dépasse la durée réservée.');
  assert.equal(model.priceBooking(draft(resourceId, { propertyId: 2, offeredMinutes: 75 })).error, 'Le temps offert dépasse la durée réservée.');
  const refused = model.createBooking({ resourceId, date: DAY, startTime: '18:00', endTime: '20:00', clientName: 'X', offeredMinutes: 135 });
  assert.equal(refused.status, 400);
});

test('rule 10 — everything offered: total 0 €, still on the planning', () => {
  const { model, resourceId } = seed();
  const id = book(model, resourceId, { offeredMinutes: 120 });
  assert.equal(model.findById(id).totalPrice, 0);
  assert.equal(model.listPlanningEvents(DAY, DAY).length, 1);
  assert.equal(model.recordPayment(id, { tenders: [{ method: 'card', amountCents: 100 }] }).error, 'Rien à encaisser.');
});
