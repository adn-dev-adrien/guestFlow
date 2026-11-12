// specs/pricing-components.md §3 rule 17 — the platform pin excludes the lines that do not declare `collectAt = 'platform'`
// (falling back to the `inComplement` flag when a line declares no moment).
const test = require('node:test');
const assert = require('node:assert/strict');
const step = require('../utils/pricing/steps/platformGross');

const run = (finalOptionLines, resourceLines = []) => step.apply({
  channel: { namedChannel: true }, finalOptionLines, resourceLines, midStayUnforced: 0, optionsTotal: 30, resourcesTotal: 0, platformGrossAmountInput: 100,
}).preArrivalOptionsResources;

test('rule 17 — a line with no declared moment reads the inComplement flag, as before', () => {
  assert.equal(run([{ totalPrice: 10, inComplement: 1 }, { totalPrice: 20, inComplement: 0 }]), 20);
});

test('rule 17 — a declared moment wins over the flag', () => {
  assert.equal(run([{ totalPrice: 10, collectAt: 'platform', inComplement: 1 }, { totalPrice: 20, collectAt: 'arrival', inComplement: 0 }]), 10);
});
