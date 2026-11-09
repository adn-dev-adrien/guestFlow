// specs/resource-booking-pricing-and-invoicing.md rules 25-26 — the billing address is optional, the postcode 5 digits.
const test = require('node:test');
const assert = require('node:assert/strict');
const { seed, book } = require('./standaloneBookingFixture');

test('rule 25 — no address at all is accepted', () => {
  const { model, resourceId } = seed();
  const id = book(model, resourceId);
  assert.deepEqual(model.findById(id).billing, { street: '', postcode: '', city: '' });
});

test('rule 25 — a partial address is stored as typed', () => {
  const { model, resourceId } = seed();
  const id = book(model, resourceId, { billing: { street: '', postcode: '07200', city: 'Aubenas' } });
  assert.deepEqual(model.findById(id).billing, { street: '', postcode: '07200', city: 'Aubenas' });
});

test('rule 26 — the postcode is 5 digits or nothing; another shape is refused', () => {
  const { model, resourceId } = seed();
  for (const postcode of ['7200', '07 200', 'ABCDE', '072000']) {
    const out = model.createBooking({ resourceId, date: '2099-02-13', startTime: '10:00', endTime: '11:00', clientName: 'X', billing: { postcode } });
    assert.equal(out.error, 'Code postal : 5 chiffres.', postcode);
  }
  assert.equal(model.createBooking({ resourceId, date: '2099-02-13', startTime: '10:00', endTime: '11:00', clientName: 'X', billing: 'Privas' }).error, 'Adresse invalide.');
  assert.equal(model.recordArrivalBilling(book(model, resourceId, { startTime: '12:00', endTime: '13:00' }), { postcode: '1' }).error, 'Code postal : 5 chiffres.');
});
