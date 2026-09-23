/**
 * specs/wp-booking-widget-redesign.md §3 — what a stay gets for free on an hourly resource must be
 * SAID, not merely applied. The engine already bills the nordic bath's first hour at 0 €; these
 * cases pin the wording the public payload carries so the site never has to derive it.
 */
const test = require('node:test');
const assert = require('node:assert');

const {
  resourceFreeLabel,
  resourceOfferedNote,
  toPublicResource,
  toPublicQuote,
} = require('../utils/publicProjections');

test('no allowance configured → nothing is announced', () => {
  assert.strictEqual(resourceFreeLabel(0), null);
  assert.strictEqual(resourceFreeLabel(null), null);
  assert.strictEqual(resourceFreeLabel(undefined), null);
});

test('the allowance is worded in hours, singular below one hour of surplus', () => {
  assert.strictEqual(resourceFreeLabel(60), '1 h offerte par séjour');
  assert.strictEqual(resourceFreeLabel(90), '1 h 30 offerte par séjour');
  assert.strictEqual(resourceFreeLabel(120), '2 h offertes par séjour');
  assert.strictEqual(resourceFreeLabel(30), '30 min offertes par séjour');
});

test('a resource carries its allowance into the public catalogue', () => {
  const projected = toPublicResource({
    id: 2, name: 'Bain nordique', priceType: 'per_hour', price: 30, freeMinutes: 60,
  });
  assert.strictEqual(projected.freeLabel, '1 h offerte par séjour');
  assert.strictEqual(projected.showsSchedulingNote, true);
});

test('a resource without an allowance keeps a null label', () => {
  const projected = toPublicResource({ id: 1, name: 'Lit bébé', priceType: 'per_stay', price: 0 });
  assert.strictEqual(projected.freeLabel, null);
});

test('a fully offered line says nothing beside its title — the amount column already says « Offert »', () => {
  assert.strictEqual(resourceOfferedNote(1, 0, 0), null);
});

test('a partly offered line names the free share', () => {
  assert.strictEqual(resourceOfferedNote(2, 1, 30), '1 h offerte');
  assert.strictEqual(resourceOfferedNote(3, 1, 60), '2 h offertes');
  assert.strictEqual(resourceOfferedNote(2.5, 1, 45), '1 h 30 offerte');
});

test('a line billed in full names nothing', () => {
  assert.strictEqual(resourceOfferedNote(2, 2, 60), null);
});

test('the quote exposes the billed share and the note the site renders', () => {
  const quote = toPublicQuote({
    propertyId: 1,
    nights: 3,
    resourceLines: [
      { resourceId: 2, name: 'Bain nordique', quantity: 2, billedUnits: 1, unitPrice: 30, totalPrice: 30, offered: false },
      { resourceId: 3, name: 'Sauna', quantity: 1, billedUnits: 0, unitPrice: 20, totalPrice: 0, offered: false },
    ],
  }, { available: true, startDate: '2026-09-28', endDate: '2026-10-01' });
  assert.deepStrictEqual(
    quote.resources.map((r) => [r.name, r.quantity, r.billedQuantity, r.offeredNote, r.total]),
    [
      ['Bain nordique', 2, 1, '1 h offerte', 30],
      ['Sauna', 1, 0, null, 0],
    ],
  );
});

test('a line with no billedUnits falls back to its quantity rather than inventing a gift', () => {
  const quote = toPublicQuote({
    propertyId: 1,
    nights: 2,
    resourceLines: [{ resourceId: 5, name: 'Vélo', quantity: 2, unitPrice: 10, totalPrice: 20, offered: false }],
  }, { available: true, startDate: '2026-09-28', endDate: '2026-09-30' });
  assert.strictEqual(quote.resources[0].billedQuantity, 2);
  assert.strictEqual(quote.resources[0].offeredNote, null);
});
