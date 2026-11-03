// specs/non-card-option-served-persons.md rule 28 (reading of card-option-served-persons rule 9) — the
// field shows what is billed: a numeric echo of the engine wins over the form, a null echo (« follows
// the party or the stay ») keeps what the form holds.
import { expect, test } from 'vitest';
import { applyQuoteToForm } from './applyQuoteToForm';

const prevWith = (line) => ({ customPrice: '', selectedOptions: [{ optionId: 9, quantity: 1, ...line }], customOptions: [], selectedResources: [] });
const quoteWith = (line) => ({ optionLines: [{ optionId: 9, quantity: 1, totalPrice: 15, ...line }], resourceLines: [] });
const next = (prevLine, quoteLine) => applyQuoteToForm(prevWith(prevLine), quoteWith(quoteLine)).selectedOptions[0];

test('rule 28 — the engine clamps 6 people to the capacity of 5: the form takes 5', () => {
  expect(next({ cardPersons: 6 }, { cardPersons: 5 }).cardPersons).toBe(5);
});

test('rule 28 — same for a stored number of nights', () => {
  expect(next({ cardNights: 6 }, { cardNights: 4 }).cardNights).toBe(4);
});

test('rule 28 — a null echo keeps what the form holds', () => {
  expect(next({ cardPersons: 4, typedAtParty: 3 }, { cardPersons: null }).cardPersons).toBe(4);
  expect(next({ cardNights: 3 }, { cardNights: null }).cardNights).toBe(3);
});

test('rule 28 — nothing on either side stays nothing, and the echo fills an empty form', () => {
  expect(next({}, { cardPersons: null }).cardPersons).toBeUndefined();
  expect(next({}, { cardPersons: 3 }).cardPersons).toBe(3);
  expect(next({}, { cardNights: 2 }).cardNights).toBe(2);
});

test('rule 28 — the reference of the editing session survives the echo', () => {
  expect(next({ cardPersons: 6, typedAtParty: 7 }, { cardPersons: 5 }).typedAtParty).toBe(7);
});
