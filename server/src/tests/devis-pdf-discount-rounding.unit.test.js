// specs/devis-pdf-total-parity.md rule 13 (audit 2026-10-27) — the discounted season rows of a devis
// add up to the engine's discounted accommodation, rounded once on the whole stay.
const test = require('node:test');
const assert = require('node:assert/strict');
const { __test: { discountedGroupTotals } } = require('../utils/devisPdf');

const sum = (values) => Math.round(values.reduce((s, v) => s + v, 0) * 100) / 100;

test('two seasons at -10 %: rows add up to 73,66, not 73,67', () => {
  const rows = discountedGroupTotals([40, 41.85], 0.9);
  assert.deepEqual(rows, [36, 37.66]);
  assert.equal(sum(rows), Math.round((40 + 41.85) * 0.9 * 100) / 100);
});

test('a single season, or no discount, is unchanged', () => {
  assert.deepEqual(discountedGroupTotals([99.17], 0.9), [89.25]);
  assert.deepEqual(discountedGroupTotals([100, 60, 60], 1), [100, 60, 60]);
});
