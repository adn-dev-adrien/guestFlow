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

test('rule 20: each of those specs has its own project, after the main one and the plugin toggles, the VAT ones in a chain', () => {
  assert.deepEqual(project('laundry-schedule').dependencies, ['plugin-toggles']);
  assert.deepEqual(project('vat-regime').dependencies, ['plugin-toggles']);
  assert.deepEqual(project('bank-reconciliation').dependencies, ['plugin-toggles'], 'online-payment reads a database with no provider connected');
  assert.deepEqual(project('vat-franchise').dependencies, ['vat-regime']);
  assert.deepEqual(project('vat-rate').dependencies, ['vat-franchise']);
  assert.ok(matches(project('laundry-schedule').testMatch, 'linen/laundry-days.spec.js'));
  assert.ok(matches(project('vat-rate').testMatch, 'settings/vat-roundtrip.spec.js'));
});

// Reading of 2026-11-16 (stabilisation loop t2): a spec that switches a plugin off rewrites global state too — run beside the specs of that plugin, it
// emptied /resource-planning under outside-visit and hourly-resources-client-picker in every parallel run.
test('rule 20: the specs that switch a plugin off run in « plugin-toggles », after the main one; the specs that use the plugin stay in the main one', () => {
  const ignore = project('chromium').testIgnore;
  const toggles = project('plugin-toggles');
  assert.deepEqual(toggles.dependencies, ['chromium']);
  for (const file of ['plugins/hourly-resources.spec.js', 'plugins/neat.spec.js', 'plugins/online-payment.spec.js', 'plugins/plugins-page.spec.js', 'plugins/booking-intake.spec.js']) {
    assert.ok(matches(ignore, `/repo/e2e/specs/${file}`), `${file} is not left to the main project`);
    assert.ok(matches(toggles.testMatch, `/repo/e2e/specs/${file}`), `${file} runs in plugin-toggles`);
  }
  for (const file of ['plugins/hourly-resources-client-picker.spec.js', 'planning/outside-visit.spec.js']) {
    assert.ok(!matches(ignore, `/repo/e2e/specs/${file}`), `${file} stays in the main project`);
  }
});

// Reading of 2026-11-16 (stabilisation loop t3, P3-4): the support access request is a banner of every admin page until it is answered — filed beside
// the main project, it moved the tab strip mobile/page-tabs measures in the viewport.
test('rule 20: the support access flow runs in « support-access », after the plugin toggles, never in the main project', () => {
  const file = '/repo/e2e/specs/account-security/support-access.spec.js';
  assert.ok(matches(project('chromium').testIgnore, file), 'the support flow is not left to the main project');
  assert.ok(matches(project('support-access').testMatch, file));
  assert.deepEqual(project('support-access').dependencies, ['plugin-toggles']);
  assert.ok(!matches(project('chromium').testIgnore, '/repo/e2e/specs/account-security/hosting-h2.spec.js'), 'the rest of hosting-h2 stays in the main project');
});
