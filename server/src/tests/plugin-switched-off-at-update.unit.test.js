// specs/plugins-phase-4-registry.md rules 56 and 57 (audit r4, N-R4-2, decision of Adrien 2026-10-29: « Éteindre le
// dépendant ») — when a core update ships a manifest that makes an ACTIVE bundled plugin require a plugin that is
// installed but OFF, the dependant is switched off at boot and the home says so; the requirement is never switched
// on. A rollback to a version whose requirement is not installed is refused.
const test = require('node:test');
const assert = require('node:assert/strict');

const h = require('./pluginPackagesFixture');
const host = require('../plugins/host');
const { readSourceManifest } = require('../plugins/manifest');
const { buildModel } = require('../models/pluginsModel');
const { switchedOffNotices } = require('../controllers/pluginsAttentionController');
const { CORE_SUMMARIES } = require('../utils/dashboardAttention');

const req = (id) => ({ id, range: '^1.0.0' });
const row = (m) => ({ id: m.id, version: m.version, source: 'bundled', manifest: m });

function weatherOverOffSas() {
  const shipped = readSourceManifest('weather-alerts');
  const sas = readSourceManifest('sas');
  const older = { ...shipped, version: '1.2.0', requires: [] };
  const db = h.freshDb();
  const model = buildModel(db);
  model.install('weather-alerts', row(older));
  model.install('sas', row(sas));
  model.setEnabled('sas', false);
  return { model, shipped, sas };
}

test('rule 56: weather-alerts 1.3.0 over an installed but OFF SAS is switched off at boot, the SAS stays off', () => {
  const { model, shipped, sas } = weatherOverOffSas();
  assert.ok(shipped.requires.some((r) => r.id === 'sas'));
  const copies = { 'weather-alerts': shipped, sas };
  host.housekeeping({ model, ids: ['weather-alerts', 'sas'], copyOf: (id) => ({ manifest: copies[id], sha256: null }) });
  assert.equal(model.get('weather-alerts').version, shipped.version);
  assert.equal(model.get('weather-alerts').enabled, false);
  assert.equal(model.get('sas').enabled, false);
  assert.equal(model.get('weather-alerts').offReason, 'sas');
});

test('rule 56: an active requirement leaves the dependant on, and the dependants of the one switched off follow', () => {
  const a = h.manifest('xa', '1.0.0');
  const b1 = h.manifest('xb', '1.0.0');
  const b2 = h.manifest('xb', '1.1.0', { requires: [req('xa')] });
  const c = h.manifest('xc', '1.0.0', { requires: [req('xb')] });
  const copies = { xa: a, xb: b2, xc: c };
  const sync = (model) => host.housekeeping({ model, ids: ['xa', 'xb', 'xc'], copyOf: (id) => ({ manifest: copies[id], sha256: null }) });
  const build = () => {
    const model = buildModel(h.freshDb());
    [a, b1, c].forEach((m) => model.install(m.id, row(m)));
    return model;
  };
  const onModel = build();
  sync(onModel);
  assert.deepEqual(onModel.list().map((r) => r.enabled), [true, true, true]);
  const offModel = build();
  offModel.setEnabled('xa', false);
  sync(offModel);
  assert.deepEqual(offModel.list().map((r) => [r.id, r.enabled]), [['xa', false], ['xb', false], ['xc', false]]);
  assert.equal(offModel.get('xb').offReason, 'xa');
  assert.equal(offModel.get('xc').offReason, 'xb');
});

test('rule 56: switching the dependant back on clears the notice', () => {
  const { model, shipped, sas } = weatherOverOffSas();
  const copies = { 'weather-alerts': shipped, sas };
  host.housekeeping({ model, ids: ['weather-alerts', 'sas'], copyOf: (id) => ({ manifest: copies[id], sha256: null }) });
  assert.equal(switchedOffNotices(model).length, 1);
  model.setEnabled('weather-alerts', true);
  assert.equal(model.get('weather-alerts').offReason, null);
  assert.deepEqual(switchedOffNotices(model), []);
});

test('rule 57: the home line names the plugin and what it needs, in short impersonal French', () => {
  const { model, shipped, sas } = weatherOverOffSas();
  const copies = { 'weather-alerts': shipped, sas };
  host.housekeeping({ model, ids: ['weather-alerts', 'sas'], copyOf: (id) => ({ manifest: copies[id], sha256: null }) });
  const items = switchedOffNotices(model);
  assert.deepEqual(items, [{ id: 'weather-alerts', name: 'Vigilance Météo-France', requires: 'Arrivée et départ guidés' }]);
  const summary = CORE_SUMMARIES['plugins-switched-off']({ items });
  assert.deepEqual(summary, { count: 1, title: 'Vigilance Météo-France éteint : nécessite Arrivée et départ guidés.', detail: 'À réactiver depuis la page Plugins', severity: 'todo' });
  assert.equal(CORE_SUMMARIES['plugins-switched-off']({ items: [] }), null);
  assert.equal(CORE_SUMMARIES['plugins-switched-off']({ items: [...items, { id: 'x', name: 'X', requires: 'Y' }, ...items] }).title, 'Plugins éteints : 3');
});

test('rule 57: a rollback to a version whose requirement is not installed is refused with REQUIREMENT_MISSING', async () => {
  const a1 = h.manifest('xa', '1.0.0', { requires: [req('xb')] });
  const b1 = h.manifest('xb', '1.0.0');
  const a2 = h.manifest('xa', '1.1.0');
  const { ctrl, model, registryClient, host: fakeHost } = h.setup({
    bundled: [a1, b1], regEntries: [{ m: a2, buf: h.makePackage(a2).buf }], installed: [row(a1), row(b1)],
  });
  await registryClient.refresh();
  assert.equal((await h.call(ctrl.update, { params: { id: 'xa' } })).statusCode, 202);
  fakeHost.state().updating = false;
  model.uninstall('xb');
  const res = await h.call(ctrl.rollback, { params: { id: 'xa' } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'REQUIREMENT_MISSING');
  assert.equal(model.get('xa').version, '1.1.0');
});
