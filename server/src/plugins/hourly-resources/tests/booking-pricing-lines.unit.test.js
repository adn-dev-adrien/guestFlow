// specs/resource-booking-pricing-and-invoicing.md rules 3-6 — the price of a booking, line by line, with its VAT.
const test = require('node:test');
const assert = require('node:assert/strict');
const { seed, book, DAY } = require('./standaloneBookingFixture');
const { priceBookingLines } = require('../bookingPricing');

const draft = (resourceId, extra = {}) => ({ resourceId, date: DAY, startTime: '18:00', endTime: '20:00', ...extra });

test('rule 3 — the preview and the stored total come from the same breakdown', () => {
  const { model, resourceId } = seed();
  const preview = model.priceBooking(draft(resourceId));
  const id = book(model, resourceId);
  assert.equal(model.findById(id).totalPrice, preview.total);
  assert.equal(preview.total, 120);
});

test('rule 4 — one line per band, then the deductions; the lines add up to the total to the cent', () => {
  const { model, resourceId } = seed();
  const out = model.priceBooking(draft(resourceId, { propertyId: 2, offeredMinutes: 30 }));
  assert.deepEqual(out.lines.map((l) => [l.key.split(':')[0], l.label, l.amount]), [
    ['band', 'Jour · 18:00–19:00', 50],
    ['band', 'Soir · 19:00–20:00', 70],
    ['free', 'Offert par le logement', -50],
    ['offered', 'Temps offert', -35],
  ]);
  assert.equal(out.lines[0].detail, '1 h × 50,00 €');
  const sum = Math.round(out.lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  assert.equal(sum, out.total);
  assert.equal(out.total, 35);
});

test('rule 4 — a band of 0 minutes gets no line', () => {
  const { model, resourceId } = seed();
  const out = model.priceBooking(draft(resourceId, { startTime: '15:00', endTime: '17:00' }));
  assert.deepEqual(out.lines.map((l) => l.label), ['Jour · 15:00–17:00']);
});

test('rule 5 — a sale outside a stay takes the « TVA des ventes hors séjour » setting, shown, never left to the client', () => {
  const { model, resourceId } = seed({ vatRate: 20 });
  const out = model.priceBooking(draft(resourceId));
  assert.deepEqual(out.vat, { rate: 20, amount: 20, net: 100 });
  const changed = seed({ vatRate: 5.5 });
  assert.equal(changed.model.priceBooking(draft(changed.resourceId)).vat.rate, 5.5);
});

test('rule 5 — no VAT for the instance: `vat` is null', () => {
  const resource = { priceType: 'per_hour', price: 30, showsPlanningCard: 0 };
  const out = priceBookingLines({ resource, startTime: '10:00', endTime: '11:00', external: true, vat: { rate: null } });
  assert.equal(out.vat, null);
  assert.equal(out.total, 30);
});

test('rule 6 — no reservation: the external rate pair, named on the breakdown', () => {
  const { model, resourceId } = seed();
  const out = model.priceBooking(draft(resourceId));
  assert.equal(out.rateGrid, 'external');
  assert.deepEqual(out.bands.map((b) => b.rate), [50, 70]);
});
