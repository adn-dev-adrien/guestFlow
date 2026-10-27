const test = require('node:test');
const assert = require('node:assert/strict');

const { eur } = require('../utils/financeInsights');

// specs/finance-dashboard-redesign.md §3.3 rule 11 (2026-10-27 audit) — the « faits marquants »
// printed « 1300 € » (Intl's narrow no-break space, invisible in the app font) under tiles reading
// « 1 900 € ». Same writing as the client's formatCurrencyRounded: a regular space every 3 digits.

test('thousands are grouped with a regular space, like the tiles', () => {
  assert.equal(eur(1300), '1 300 €');
  assert.equal(eur(1234567.4), '1 234 567 €');
  assert.equal(eur(805), '805 €');
  assert.equal(eur(-1900), '-1 900 €');
  assert.doesNotMatch(eur(1300), / | /);
});
