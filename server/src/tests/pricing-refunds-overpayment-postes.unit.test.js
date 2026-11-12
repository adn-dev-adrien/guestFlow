// specs/pricing-components.md §3 rules 74 and 76 — the trop-perçu poste split reads lines and what the payments named on them, never the
// audit log: a line collects more than it costs → the excess of its poste; a key a stay has dropped costs nothing; a removed
// paid line adds to its poste.
const test = require('node:test');
const assert = require('node:assert/strict');
const { postesLeftOf } = require('../utils/pricing/refunds/overpayment');

test('rule 76 — each key is judged on its own: a lowered line leaves its difference, a kept one nothing', () => {
  const left = postesLeftOf(
    [{ key: 'opt:3', poste: 'options', collectedCents: 3000 }, { key: 'res:7', poste: 'resources', collectedCents: 8000 }, { key: 'touristTax', poste: 'touristTax', collectedCents: 900 }],
    new Map([['opt:3', 2000], ['res:7', 8000], ['touristTax', 600]]),
  );
  assert.deepEqual(left, { options: 10, resources: 0, touristTax: 3 });
});

test('rule 74 — a key the stay no longer carries costs nothing; several entries on a key add up before the comparison', () => {
  const left = postesLeftOf(
    [{ key: 'opt:3', poste: 'options', collectedCents: 1000 }, { key: 'opt:3', poste: 'options', collectedCents: 2200 }, { key: 'res:7', poste: 'resources', collectedCents: 500 }],
    new Map([['opt:3', 3200]]),
  );
  assert.deepEqual(left, { options: 0, resources: 5, touristTax: 0 });
});

test('rule 76 — no entry, no excess', () => {
  assert.deepEqual(postesLeftOf([], new Map()), { options: 0, resources: 0, touristTax: 0 });
  assert.deepEqual(postesLeftOf(undefined, undefined), { options: 0, resources: 0, touristTax: 0 });
});
