// specs/plugins-phase-4-registry.md rule 61 (audit r5 review, residual) — a core update that ships a bundled
// requirement at a version a registry-installed dependant's range refuses switches the dependant off at boot.
const test = require('node:test');
const assert = require('node:assert/strict');

const h = require('./pluginPackagesFixture');
const host = require('../plugins/host');
const { buildModel } = require('../models/pluginsModel');
const { switchedOffNotices } = require('../controllers/pluginsAttentionController');
const { CORE_SUMMARIES } = require('../utils/dashboardAttention');

const r = (id, range = '^1.0.0') => ({ id, range });

test('rule 61: a bundled requirement shipped past a registry dependant range switches the dependant off, once', () => {
  const a1 = h.manifest('xa', '1.0.0');
  const a2 = h.manifest('xa', '2.0.0');
  const b = h.manifest('xb', '1.0.0', { requires: [r('xa')] });
  const model = buildModel(h.freshDb());
  model.install('xa', { id: 'xa', version: '1.0.0', source: 'bundled', manifest: a1 });
  model.install('xb', { id: 'xb', version: '1.0.0', source: 'registry', manifest: b });
  host.housekeeping({ model, ids: ['xa', 'xb'], copyOf: (id) => (id === 'xa' ? { manifest: a2, sha256: null } : null) });
  assert.equal(model.get('xa').version, '2.0.0');
  assert.equal(model.get('xa').enabled, true);
  assert.equal(model.get('xb').enabled, false);
  assert.equal(model.get('xb').offReason, 'xa');
  assert.deepEqual(switchedOffNotices(model).map((n) => n.id), ['xb']);
});

test('rule 61: a dependant whose range the new version satisfies stays on', () => {
  const a1 = h.manifest('xa', '1.0.0');
  const a2 = h.manifest('xa', '1.5.0');
  const b = h.manifest('xb', '1.0.0', { requires: [r('xa')] });
  const model = buildModel(h.freshDb());
  model.install('xa', { id: 'xa', version: '1.0.0', source: 'bundled', manifest: a1 });
  model.install('xb', { id: 'xb', version: '1.0.0', source: 'registry', manifest: b });
  host.housekeeping({ model, ids: ['xa', 'xb'], copyOf: (id) => (id === 'xa' ? { manifest: a2, sha256: null } : null) });
  assert.equal(model.get('xb').enabled, true);
});

test('rule 61: an unrelated sync does not switch off a plugin whose OTHER requirement was already off', () => {
  const model = buildModel(h.freshDb());
  const xa = h.manifest('xa', '1.0.0');
  const xq = h.manifest('xq', '1.0.0');
  const xd = h.manifest('xd', '1.0.0', { requires: [r('xa'), r('xq')] });
  model.install('xa', { id: 'xa', version: '1.0.0', source: 'bundled', manifest: xa });
  model.install('xq', { id: 'xq', version: '1.0.0', source: 'registry', manifest: xq });
  model.install('xd', { id: 'xd', version: '1.0.0', source: 'registry', manifest: xd });
  model.setEnabled('xq', false);
  host.housekeeping({ model, ids: ['xa', 'xq', 'xd'], copyOf: (id) => (id === 'xa' ? { manifest: h.manifest('xa', '1.1.0'), sha256: null } : null) });
  assert.equal(model.get('xd').enabled, true);
});

test('rule 61: the home line for a requirement that is ON but out of range says what is needed, and to update', () => {
  const model = buildModel(h.freshDb());
  model.install('xa', { id: 'xa', version: '2.0.0', source: 'bundled', manifest: h.manifest('xa', '2.0.0') });
  model.install('xb', { id: 'xb', version: '1.0.0', source: 'registry', manifest: h.manifest('xb', '1.0.0', { requires: [r('xa')] }) });
  model.switchOff('xb', 'xa');
  const items = switchedOffNotices(model);
  assert.equal(items[0].need, 'compatible avec ^1.0.0');
  const summary = CORE_SUMMARIES['plugins-switched-off']({ items });
  assert.equal(summary.title, 'Plugin xb éteint : nécessite Plugin xa compatible avec ^1.0.0.');
  assert.equal(summary.detail, 'À mettre à jour puis réactiver depuis la page Plugins.');
  assert.equal(CORE_SUMMARIES['plugins-switched-off']({ items, managed: true }).detail, 'À mettre à jour puis réactiver par l’exploitant.');
});
