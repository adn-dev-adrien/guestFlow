// specs/non-card-option-served-persons.md rules 1, 8, 9, 18, 19 (audit R21-S5) — which option has a typed field, and
// what the field shows. A wrong answer here turns a card or the insurance into a typed line.
import { expect, test } from 'vitest';
import { typedCountKind, typedCountValue } from '../optionTypedCount';

test('rules 8, 9, 19 — people on the per-person prices, nights on the per-night price, nothing elsewhere', () => {
  expect(typedCountKind({ priceType: 'per_person' })).toBe('persons');
  expect(typedCountKind({ priceType: 'per_person_per_night' })).toBe('persons');
  expect(typedCountKind({ priceType: 'per_night' })).toBe('nights');
  expect(typedCountKind({ priceType: 'per_stay' })).toBe(null);
  expect(typedCountKind(undefined)).toBe(null);
});

test('rule 1 — a planning card and the cancellation insurance keep their own field', () => {
  expect(typedCountKind({ priceType: 'per_person', showsPlanningCard: 1 })).toBe(null);
  expect(typedCountKind({ priceType: 'per_night', showsPlanningCard: 1 })).toBe(null);
  expect(typedCountKind({ priceType: 'per_night', isCancellationInsurance: 1 })).toBe(null);
  expect(typedCountKind({ priceType: 'percent_of_stay' })).toBe(null);
});

test('rule 19 — the nights field reads the typed nights, never the people', () => {
  expect(typedCountValue({ quantity: 1, cardNights: 3, cardPersons: 8 }, 'nights', 2)).toBe(3);
  expect(typedCountValue({ quantity: 1, cardNights: 3, cardPersons: 8 }, 'persons', 5)).toBe(8);
  expect(typedCountValue({ quantity: 1, cardPersons: 8 }, 'nights', 2)).toBe(2);
});

test('rule 18 — a drifted line reads as what it bills, in its own column', () => {
  expect(typedCountValue({ quantity: 1.1, servedPersons: 12.1, servedNights: 7 }, 'persons', 11)).toBe(12.1);
  expect(typedCountValue({ quantity: 1.5, servedPersons: 12.1, servedNights: 3 }, 'nights', 2)).toBe(3);
});
