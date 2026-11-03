// specs/non-card-option-served-persons.md rules 18, 19 and 23 (audit R21-S5) — a recompute rebuilds every line from
// the quote: the typed nights, the figure a drifted line bills and the typed-against tags must survive it.
import { expect, test } from 'vitest';
import { applyQuoteToForm } from '../applyQuoteToForm';

const quote = (line) => ({ optionLines: [{ optionId: 40, quantity: 1, totalPrice: 15, ...line }], resourceLines: [] });
const prev = (line) => ({ customPrice: '', selectedOptions: [{ optionId: 40, quantity: 1, ...line }], customOptions: [], selectedResources: [] });
const lineOf = (form) => form.selectedOptions[0];

test('rule 19 — the number of nights typed in the form wins over the quote, which still fills a first load', () => {
  expect(lineOf(applyQuoteToForm(prev({ cardNights: 3 }), quote({ cardNights: null }))).cardNights).toBe(3);
  expect(lineOf(applyQuoteToForm(prev({ cardNights: 3 }), quote({ cardNights: 2 }))).cardNights).toBe(3);
  expect(lineOf(applyQuoteToForm(prev({}), quote({ cardNights: 2 }))).cardNights).toBe(2);
  expect(lineOf(applyQuoteToForm(prev({}), quote({ cardNights: null })))).not.toHaveProperty('cardNights');
});

test('rule 18 — the figure a drifted line bills comes from the quote, in people and in nights', () => {
  const people = lineOf(applyQuoteToForm(prev({ quantity: 1.1 }), quote({ quantity: 1.1, servedPersons: 12.1 })));
  expect(people.servedPersons).toBe(12.1);
  const nights = lineOf(applyQuoteToForm(prev({ quantity: 1.5 }), quote({ quantity: 1.5, servedNights: 3 })));
  expect(nights.servedNights).toBe(3);
});

test('rule 23 — the reference a number was typed against stays on the line, and never comes from the quote', () => {
  const kept = lineOf(applyQuoteToForm(prev({ typedAtParty: 4, typedAtNights: 2 }), quote({ typedAtParty: 9, typedAtNights: 9 })));
  expect([kept.typedAtParty, kept.typedAtNights]).toEqual([4, 2]);
  const none = lineOf(applyQuoteToForm(prev({}), quote({ typedAtParty: 9, typedAtNights: 9 })));
  expect(none).not.toHaveProperty('typedAtParty');
  expect(none).not.toHaveProperty('typedAtNights');
});
