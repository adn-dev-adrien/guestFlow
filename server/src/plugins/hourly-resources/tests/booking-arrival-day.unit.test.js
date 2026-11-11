// specs/resource-booking-pricing-and-invoicing.md rules 28, 32 (R35-C-L4) — a guest with no stay arrives on his session's
// day only; an arrival already recorded opens again any day, and a booking paid at booking time can still arrive.
const test = require('node:test');
const assert = require('node:assert/strict');
const { seed, book, card, DAY } = require('./standaloneBookingFixture');

const at = (iso) => () => new Date(iso);
const dayAfter = new Date(`${DAY}T12:00:00Z`);
dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);

test('rule 28 — the arrival is refused on another day than the session\'s', () => {
  const { model, resourceId } = seed({ now: () => dayAfter });
  const id = book(model, resourceId);
  const out = model.recordArrival(id, { payment: null });
  assert.equal(out.status, 409);
  assert.equal(out.code, 'ARRIVAL_NOT_TODAY');
  assert.equal(out.error, 'Arrivée : le jour de la séance seulement.');
  assert.equal(model.findById(id).arrived, false);
});

test('rules 28, 32 — paid at booking, the guest arrives on the day; recorded, the arrival opens again the next day', () => {
  let clock = at(`${DAY}T15:00:00Z`)();
  const { model, resourceId } = seed({ now: () => clock });
  const id = book(model, resourceId);
  model.recordPayment(id, { tenders: card(12000), paidAt: DAY });
  assert.equal(model.recordArrival(id, { payment: null }).ok, true);
  assert.equal(model.findById(id).arrived, true);
  clock = dayAfter;
  assert.equal(model.recordArrival(id, { payment: null }).ok, true);
});
