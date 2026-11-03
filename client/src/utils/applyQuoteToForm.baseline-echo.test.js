// specs/non-card-option-served-persons.md rule 30 — the clean baseline takes a numeric echo only when the
// quote asked for the count the baseline holds, so a number typed meanwhile stays an edit.
import { expect, test } from 'vitest';
import { applyQuoteToBaseline } from './applyQuoteToForm';

const baselineWith = (line) => ({ customPrice: '', selectedOptions: [{ optionId: 9, quantity: 1, ...line }], customOptions: [], selectedResources: [] });
const quoteWith = (line) => ({ optionLines: [{ optionId: 9, quantity: 1, totalPrice: 15, ...line }], resourceLines: [] });
const next = (held, asked, echo) => applyQuoteToBaseline(baselineWith(held), quoteWith(echo), [{ optionId: 9, quantity: 1, ...asked }]).selectedOptions[0];

test('rule 30 — the quote asked for the stored 7 and the engine clamps it to 5: the baseline takes 5', () => {
  expect(next({ cardPersons: 7 }, { cardPersons: 7 }, { cardPersons: 5 }).cardPersons).toBe(5);
  expect(next({ cardNights: 7 }, { cardNights: 7 }, { cardNights: 5 }).cardNights).toBe(5);
});

test('rule 30 — the quote asked for a typed 2: the baseline keeps the stored 3', () => {
  expect(next({ cardPersons: 3 }, { cardPersons: 2 }, { cardPersons: 2 }).cardPersons).toBe(3);
  expect(next({ cardNights: 3 }, { cardNights: 2 }, { cardNights: 2 }).cardNights).toBe(3);
});

test('rule 30 — a following line typed meanwhile stays following in the baseline', () => {
  expect(next({}, { cardPersons: 2 }, { cardPersons: 2 })).not.toHaveProperty('cardPersons');
  expect(next({}, { cardNights: 2 }, { cardNights: 2 })).not.toHaveProperty('cardNights');
});

test('rule 30 — a stored count sent back as following keeps the stored count in the baseline', () => {
  expect(next({ cardPersons: 3 }, {}, { cardPersons: null }).cardPersons).toBe(3);
});

test('rule 30 — a quote with no known request applies the echo as it comes', () => {
  const baseline = baselineWith({ cardPersons: 7 });
  expect(applyQuoteToBaseline(baseline, quoteWith({ cardPersons: 5 }), undefined).selectedOptions[0].cardPersons).toBe(5);
});
