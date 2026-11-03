// specs/non-card-option-served-persons.md rules 19, 20, 23 and 25 (audit R21-S5) — the pure reading behind every
// flag: who counts in the party, what a stay's nights are, which line a change of party or stay flags, and the
// floor a typed count takes on its way into the engine.

const test = require('node:test');
const assert = require('node:assert/strict');

const { partyOf, nightsOf, typedCountAlerts } = require('../utils/typedCounts');
const { resolveNonCardUnits } = require('../utils/pricing');

const alertsOf = (input) => typedCountAlerts({ persons: 5, nights: 3, storedPersons: 4, storedNights: 2, ...input });

test('rule 20 — babies never count in the party, and a stay has at least one adult', () => {
  assert.equal(partyOf({ adults: 2, teens: 1, children: 1, babies: 3 }), 4);
  assert.equal(partyOf({ adults: 0, teens: 0, children: 2 }), 3);
  assert.equal(partyOf({}), 1);
});

test('rule 19 — a reversed or empty stay has no nights, never a made-up one', () => {
  assert.equal(nightsOf({ startDate: '2099-03-01', endDate: '2099-03-04' }), 3);
  assert.equal(nightsOf({ startDate: '2099-03-04', endDate: '2099-03-01' }), 0);
  assert.equal(nightsOf({ startDate: '2099-03-01', endDate: '2099-03-01' }), 0);
  assert.equal(nightsOf({}), 0);
});

test('rule 20 — a typed count equal to the new party is not flagged, the party having moved or not', () => {
  const line = { optionId: 9, title: 'Linge', cardPersons: 5 };
  assert.deepEqual(alertsOf({ quoteLines: [line] }), []);
  assert.equal(alertsOf({ quoteLines: [{ ...line, cardPersons: 3 }] }).length, 1);
});

test('rule 20 — a typed number of nights equal to the new stay is not flagged', () => {
  const line = { optionId: 9, title: 'Bois', cardNights: 3 };
  assert.deepEqual(alertsOf({ quoteLines: [line] }), []);
  const [flagged] = alertsOf({ quoteLines: [{ ...line, cardNights: 2 }] });
  assert.deepEqual([flagged.kind, flagged.typed, flagged.reference, flagged.current], ['nights', 2, 2, 3]);
  assert.equal(flagged.label, 'Saisi pour 2 nuits, séjour : 3');
  assert.equal(flagged.applyLabel, 'Appliquer 3 nuits');
});

test('rule 23 — a number of nights typed during this edit is measured against the stay it was typed for', () => {
  const line = { optionId: 9, title: 'Bois', cardNights: 2 };
  assert.deepEqual(alertsOf({ quoteLines: [line], requestLines: [{ optionId: 9, typedAtNights: 3 }] }), []);
  const [kept] = alertsOf({ quoteLines: [line], requestLines: [{ optionId: 9, typedAtNights: 4 }], storedNights: 3 });
  assert.equal(kept.reference, 4);
});

test('rule 20 — a free line typed by the operator is no option: it is never flagged', () => {
  assert.deepEqual(alertsOf({ quoteLines: [{ optionId: 9, title: 'Libre', isCustom: true, cardPersons: 3 }] }), []);
  assert.deepEqual(alertsOf({ quoteLines: [{ optionId: null, title: 'Libre', cardPersons: 3 }] }), []);
});

test('rule 25 — a typed count reaches the engine as a whole number, in people and in nights', () => {
  const people = resolveNonCardUnits({ priceType: 'per_person', quantity: 1, persons: 5, nights: 2, cardPersons: 3.7, maxGuests: 13 });
  assert.deepEqual([people.cardPersons, people.billedUnits], [3, 3]);
  const perNight = resolveNonCardUnits({ priceType: 'per_person_per_night', quantity: 1, persons: 5, nights: 2, cardPersons: 3.7, maxGuests: 13 });
  assert.deepEqual([perNight.cardPersons, perNight.billedUnits], [3, 6]);
  const nights = resolveNonCardUnits({ priceType: 'per_night', quantity: 1, persons: 5, nights: 2, cardNights: 3.7 });
  assert.deepEqual([nights.cardNights, nights.billedUnits], [3, 3]);
});
