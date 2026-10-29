// specs/e2e-playwright-smoke-suite.md rule 20 — the specs that rewrite global state (VAT regime and rate,
// laundry schedule) run in projects of their own, after the main one, and the VAT ones in a chain.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { PROJECTS } = require(path.join(__dirname, '..', '..', '..', 'e2e', 'projects.js'));
const project = (name) => PROJECTS.find((p) => p.name === name);
const matches = (re, file) => (Array.isArray(re) ? re : [re]).some((r) => r.test(file));

test('rule 20: the main project ignores every spec that rewrites global state', () => {
  const ignore = project('chromium').testIgnore;
  for (const file of ['settings/vat-regime-switch.spec.js', 'finance/vat-franchise.spec.js', 'settings/vat-roundtrip.spec.js', 'linen/laundry-days.spec.js']) {
    assert.ok(matches(ignore, file), `${file} is not left to the main project`);
  }
  assert.ok(!matches(ignore, 'planning/laundry-extra-trip.spec.js'), 'the extra-trip spec stays in the main project');
});

test('rule 20: each of those specs has its own project, after the main one, the VAT ones in a chain', () => {
  assert.deepEqual(project('laundry-schedule').dependencies, ['chromium']);
  assert.deepEqual(project('vat-regime').dependencies, ['chromium']);
  assert.deepEqual(project('vat-franchise').dependencies, ['vat-regime']);
  assert.deepEqual(project('vat-rate').dependencies, ['vat-franchise']);
  assert.ok(matches(project('laundry-schedule').testMatch, 'linen/laundry-days.spec.js'));
  assert.ok(matches(project('vat-rate').testMatch, 'settings/vat-roundtrip.spec.js'));
});
