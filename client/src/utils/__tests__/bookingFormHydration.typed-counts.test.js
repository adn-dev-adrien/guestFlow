// specs/non-card-option-served-persons.md rule 19 (audit R21-S5) — a stored typed count comes back on the form line:
// without it the next save bills the whole stay.
import { expect, test } from 'vitest';
import { hydrateSelectedOptions } from '../bookingFormHydration';

const STAY = { startDate: '2099-03-08', endDate: '2099-03-10' };

test('rule 19 — the typed nights and people come back; a line nobody typed carries neither', () => {
  const [nights, people, followed] = hydrateSelectedOptions([
    { optionId: 1, quantity: 1, totalPrice: 15, cardNights: 3 },
    { optionId: 2, quantity: 1, totalPrice: 24, cardPersons: 3 },
    { optionId: 3, quantity: 1, totalPrice: 40, cardPersons: null, cardNights: null },
  ], STAY, [], null);
  expect(nights.cardNights).toBe(3);
  expect(people.cardPersons).toBe(3);
  expect(followed).not.toHaveProperty('cardNights');
  expect(followed).not.toHaveProperty('cardPersons');
});
