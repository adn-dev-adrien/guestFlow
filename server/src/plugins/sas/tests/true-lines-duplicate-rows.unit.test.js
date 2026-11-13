// specs/pricing-components.md §3 rule 85 — the SAS plugin's quantity bounds on a stay holding TWO lines of one article.
const test = require('node:test');
const assert = require('node:assert/strict');
const { bath } = require('../../../tests/trueLinesFixture');

test('rule 85 (LINE: sasQuantityBounds) — a unit or persons count that ANY SAS line of the article stores is not re-judged', () => {
  const { soldOptionsMessage } = require('../sasQuantityBounds');
  const held = [{ optionId: bath, sasArrivalOrigin: 1, billedUnits: 3, cardPersons: 2 }, { optionId: bath, sasArrivalOrigin: 1, billedUnits: 7, cardPersons: 5 }];
  assert.equal(soldOptionsMessage([{ optionId: bath, units: 7, persons: 5 }, { optionId: bath, units: 3, persons: 2 }], () => 'per_stay', held), null);
  assert.ok(soldOptionsMessage([{ optionId: bath, units: -4 }], () => 'per_stay', held), 'a value no line stores is judged');
});
