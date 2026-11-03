// specs/non-card-option-served-persons.md rule 12 (audit R21-S5) — a non-card per-person sale reaches the server in
// people served. Sent as units, the server would bill the whole party.
import { expect, test } from 'vitest';
import buildArrivalDraft from '../arrivalDraft';

const draftOf = (soldSelections) => buildArrivalDraft({ activeKeys: ['cateringAsk'], soldSelections }).soldOptions;

test('rule 12 — a sale per person sends the people served, and no units', () => {
  expect(draftOf([{ offer: { optionId: 28 }, occurrences: null, persons: 3, units: 9 }])).toEqual([{ optionId: 28, persons: 3 }]);
});

test('rule 12 — a sale with no people sends its units', () => {
  expect(draftOf([{ offer: { optionId: 27 }, occurrences: null, persons: null, units: 2 }])).toEqual([{ optionId: 27, units: 2 }]);
});
