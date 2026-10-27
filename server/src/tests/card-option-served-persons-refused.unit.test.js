const test = require('node:test');
const assert = require('node:assert/strict');

const { refuseInvalidServedPersons } = require('../utils/cardServedPersons');

// specs/card-option-served-persons.md §3 rules 3 and 19 — spec review 2026-10-27 (agent 7 F9). « A value ≤ 0
// is refused »: the API priced `cardPersons: 0` (or −2) as the whole party, with a 200.

test('0, a negative count or a non-number is refused with its code', () => {
  for (const cardPersons of [0, -2, 'abc']) {
    const out = refuseInvalidServedPersons([{ optionId: 4, cardPersons }]);
    assert.equal(out.code, 'INVALID_CARD_PERSONS', String(cardPersons));
    assert.equal(out.optionId, 4);
  }
});

test('no count (the whole party) and a positive count pass', () => {
  assert.equal(refuseInvalidServedPersons([
    { optionId: 1 }, { optionId: 2, cardPersons: null }, { optionId: 3, cardPersons: '' }, { optionId: 4, cardPersons: 3 },
  ]), null);
  assert.equal(refuseInvalidServedPersons(undefined), null);
});
