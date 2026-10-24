// specs/breakfast-offer-price-server-side.md rules 1-3 — the price of one breakfast morning that the
// arrival SAS offer page shows comes from the server, priced by the very function the sale is billed with.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSasSaleOffers, priceOptionSale } = require('../utils/sasOptionSale');

const STAY = {
  startDate: '2026-08-18', endDate: '2026-08-20', checkInTime: '15:00', checkOutTime: '10:00',
};
const BREAKFAST = {
  id: 6, title: 'Petit déjeuner', description: '', price: 8, priceType: 'per_person_per_night',
  autoOptionType: 'breakfast', showsPlanningCard: 1, cardRepeat: 'once_per_day',
  planningCardTimes: ['09:00'], category: 'Restauration', displayToClient: 1, autoEnabled: 0,
};

function offers({ option = BREAKFAST, adults = 2, options, maxPersons = 5 } = {}) {
  return buildSasSaleOffers({
    reservation: { id: 1, adults, teens: 0, children: 0, ...STAY, nights: [{}, {}], options: options || [] },
    options: [option],
    maxPersons,
  }).breakfast;
}

test('rule 1 — 8,00 € per person, party of 2 → 16,00 € for one morning', () => {
  assert.deepEqual(offers().perMorning, { persons: 2, amount: 16 });
});

test('rule 1 — a property override (9,50 €) is applied before pricing', () => {
  assert.deepEqual(offers({ option: { ...BREAKFAST, price: 9.5 }, adults: 3 }).perMorning, { persons: 3, amount: 28.5 });
});

test('rule 1 — 7,35 € × 3 is rounded to the cent, not truncated', () => {
  assert.deepEqual(offers({ option: { ...BREAKFAST, price: 7.35 }, adults: 3 }).perMorning, { persons: 3, amount: 22.05 });
});

test('rule 2 — a breakfast that is not per person carries no covers, the amount is the unit price', () => {
  const b = offers({ option: { ...BREAKFAST, price: 12, priceType: 'per_night' } });
  assert.deepEqual(b.perMorning, { persons: null, amount: 12 });
});

test('rule 2 — a re-opened SAS announces the covers it already chose (3 of 4)', () => {
  const b = offers({
    adults: 4,
    options: [{ optionId: 6, sasArrivalOrigin: 1, cardPersons: 3, billedUnits: 3, cardOccurrences: [{ date: '2026-08-19', time: '09:00' }] }],
  });
  assert.deepEqual(b.perMorning, { persons: 3, amount: 24 });
});

test('rule 3 — no candidate morning, no figure', () => {
  const b = buildSasSaleOffers({
    reservation: { id: 1, adults: 2, teens: 0, children: 0, startDate: '2026-08-18', endDate: '2026-08-18', checkInTime: '15:00', checkOutTime: '10:00', nights: [], options: [] },
    options: [BREAKFAST],
  }).breakfast;
  assert.equal(b.available, false);
  assert.equal(b.perMorning, null);
});

test('parity — perMorning equals the sale priced on the first candidate morning', () => {
  const b = offers({ adults: 3 });
  const sale = priceOptionSale(BREAKFAST, {
    unitPrice: 8, persons: 3, stay: STAY, occurrences: [b.mornings[0]], servedPersons: 3, maxPersons: 5,
  });
  assert.equal(b.perMorning.amount, sale.totalPrice);
});

test('rule 12 — additive: the offer keeps every earlier field and the SDK range is untouched', () => {
  const b = offers();
  ['available', 'optionId', 'unitPrice', 'perPerson', 'defaultPersons', 'selectedPersons', 'maxPersons', 'mornings']
    .forEach((key) => assert.ok(key in b, key));
  const manifest = require('../plugins/sas/manifest.json');
  assert.ok(require('semver').satisfies('2.0.0', manifest.sdk), 'the plugin still accepts the current SDK');
  assert.ok(manifest.changelog[manifest.version], 'the bumped version carries its French changelog line');
});
