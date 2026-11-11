// specs/plugins-phase-4-registry.md rules 57 and 58 (audit r4, N-R4-2, decision of Adrien 2026-10-29: « Éteindre le
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
const { skipWithout } = require('../plugins/sdk/testing');

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

test('rule 57: weather-alerts 1.3.0 over an installed but OFF SAS is switched off at boot, the SAS stays off', { skip: skipWithout(['weather-alerts', 'sas']) }, () => {
  const { model, shipped, sas } = weatherOverOffSas();
  assert.ok(shipped.requires.some((r) => r.id === 'sas'));
  const copies = { 'weather-alerts': shipped, sas };
  host.housekeeping({ model, ids: ['weather-alerts', 'sas'], copyOf: (id) => ({ manifest: copies[id], sha256: null }) });
  assert.equal(model.get('weather-alerts').version, shipped.version);
  assert.equal(model.get('weather-alerts').enabled, false);
  assert.equal(model.get('sas').enabled, false);
  assert.equal(model.get('weather-alerts').offReason, 'sas');
});

test('rule 57: an active requirement leaves the dependant on, and the dependants of the one switched off follow', () => {
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

test('rule 57: switching the dependant back on clears the notice', { skip: skipWithout(['weather-alerts', 'sas']) }, () => {
  const { model, shipped, sas } = weatherOverOffSas();
  const copies = { 'weather-alerts': shipped, sas };
  host.housekeeping({ model, ids: ['weather-alerts', 'sas'], copyOf: (id) => ({ manifest: copies[id], sha256: null }) });
  assert.equal(switchedOffNotices(model).length, 1);
  model.setEnabled('weather-alerts', true);
  assert.equal(model.get('weather-alerts').offReason, null);
  assert.deepEqual(switchedOffNotices(model), []);
});

test('rule 58: the home line names the plugin and what it needs, in short impersonal French', { skip: skipWithout(['weather-alerts', 'sas']) }, () => {
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

test('rule 58: a rollback to a version whose requirement is not installed is refused with REQUIREMENT_MISSING', async () => {
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

function chain(depth) {
  const a = h.manifest('xa', '1.0.0');
  const b1 = h.manifest('xb', '1.0.0');
  const b2 = h.manifest('xb', '1.1.0', { requires: [req('xa')] });
  const names = ['xc', 'xd', 'xe'].slice(0, depth - 1);
  const rest = names.map((id, i) => h.manifest(id, '1.0.0', { requires: [req(i === 0 ? 'xb' : names[i - 1])] }));
  const all = [a, b1, ...rest];
  const model = buildModel(h.freshDb());
  all.forEach((m) => model.install(m.id, row(m)));
  model.setEnabled('xa', false);
  const copies = Object.fromEntries([a, b2, ...rest].map((m) => [m.id, m]));
  return { model, ids: all.map((m) => m.id), copyOf: (id) => ({ manifest: copies[id], sha256: null }), names };
}

test('rule 57: a chain of dependants two and three levels deep is switched off, each with its nearest cause, and the boot is not stopped', () => {
  for (const depth of [3, 4]) {
    const { model, ids, copyOf, names } = chain(depth);
    host.housekeeping({ model, ids, copyOf });
    assert.deepEqual(model.list().map((r) => r.enabled), ids.map(() => false), `depth ${depth}`);
    assert.equal(model.get('xb').offReason, 'xa');
    names.forEach((id, i) => assert.equal(model.get(id).offReason, i === 0 ? 'xb' : names[i - 1]));
  }
});

test('rule 57: an error while switching plugins off never stops the boot, and a refused sync is logged once per release', () => {
  const a1 = h.manifest('xa', '1.0.0');
  const b1 = h.manifest('xb', '1.0.0', { requires: [req('xa')] });
  const a2 = h.manifest('xa', '1.1.0', { requires: [req('xb')] });
  const model = buildModel(h.freshDb());
  [a1, b1].forEach((m) => model.install(m.id, row(m)));
  const errors = [];
  const spy = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    for (let i = 0; i < 3; i += 1) host.housekeeping({ model, ids: ['xa', 'xb'], copyOf: (id) => ({ manifest: id === 'xa' ? a2 : b1, sha256: null }) });
    assert.equal(errors.filter((e) => /xa@1\.1\.0 not synced/.test(e)).length, 1);
    const broken = buildModel(h.freshDb());
    const c1 = h.manifest('xc', '1.0.0');
    const c2 = h.manifest('xc', '1.1.0', { requires: [req('xa')] });
    [a1, c1].forEach((m) => broken.install(m.id, row(m)));
    broken.setEnabled('xa', false);
    broken.switchOff = () => { throw new Error('disk'); };
    assert.doesNotThrow(() => host.housekeeping({ model: broken, ids: ['xa', 'xc'], copyOf: (id) => ({ manifest: id === 'xc' ? c2 : a1, sha256: null }) }));
    assert.ok(errors.some((e) => /syncing the bundled rows failed/.test(e)));
  } finally {
    console.error = spy;
  }
});

test('rule 58: the line is skipped for whoever is not an administrator, and says so on a managed space', () => {
  const { coreAttentionSources } = require('../routes/dashboard');
  const source = coreAttentionSources().find((s) => s.key === 'plugins-switched-off');
  assert.equal(source.skip({ user: { roles: ['reception'] } }), true);
  assert.equal(source.skip({ user: { roles: ['admin'] } }), false);
  const items = [{ id: 'weather-alerts', name: 'Vigilance Météo-France', requires: 'Arrivée et départ guidés' }];
  assert.equal(CORE_SUMMARIES['plugins-switched-off']({ items, managed: true }).detail, 'À réactiver par l’exploitant');
});

test('rule 57: a switch-off that fails halfway saves nothing — not the sync, not the first switch-off — and the next boot retries', () => {
  const { model, ids, copyOf } = chain(3);
  const real = model.switchOff;
  let calls = 0;
  const failing = { ...model, switchOff: (id, reason) => { calls += 1; if (calls === 2) throw new Error('SQLITE_BUSY'); return real(id, reason); } };
  const spy = console.error;
  console.error = () => {};
  try { host.housekeeping({ model: failing, ids, copyOf }); } finally { console.error = spy; }
  assert.deepEqual(model.list().map((r) => [r.id, r.enabled, r.version]), [['xa', false, '1.0.0'], ['xb', true, '1.0.0'], ['xc', true, '1.0.0'], ['xd', true, '1.0.0']]);
  host.housekeeping({ model, ids, copyOf });
  assert.deepEqual(model.list().map((r) => r.enabled), [false, false, false, false]);
  assert.equal(model.get('xb').version, '1.1.0');
});
