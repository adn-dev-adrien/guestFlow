// specs/plugin-dependencies.md rules 5, 9, 10 and 15 — the install plan lists what to install and what
// to switch on, in order, in a release and in a development tree; a cycle is refused, never skipped.
const test = require('node:test');
const assert = require('node:assert/strict');
const { skipWithout } = require('../plugins/sdk/testing');
const h = require('./pluginPackagesFixture');
const loader = require('../plugins/loader');
const { requirementPlan } = require('../utils/pluginOffers');
const { createController } = require('../controllers/pluginsController');
const { readSourceManifest } = require('../plugins/manifest');
const { findPlugin } = require('../constants/plugins');

const WB = 'website-booking';
const GVR = 'google-vacation-rentals';
const SAS = 'sas';
const WEATHER = 'weather-alerts';
const nm = (id) => findPlugin(id).name;
const need = (id, range = '^1.0.0') => ({ id, range });
const row = (id, version, manifest) => ({ id, version, source: 'bundled', manifest });
const skip = { skip: skipWithout([WB, GVR]) };

const ENV = { coreVersion: '3.9.0', sdkVersion: '2.0.0' };
function planCtx(manifests, { installed = {}, inactive = [], allows = () => true } = {}) {
  return {
    sources: { registry: () => [], bundled: (id) => (manifests[id] ? { manifest: manifests[id], sha256: 'x' } : null) },
    env: ENV,
    installed,
    inactive,
    installedManifest: (id) => manifests[id],
    nameOf: (id) => `Nom ${id}`,
    allows,
  };
}
const man = (id, version, requires = []) => h.manifest(id, version, { requires });

test('rule 9: the plan lists an installed-but-off requirement as an `activate` step, an absent one as `install`', () => {
  const manifests = { aa: man('aa', '1.0.0', [need('bb'), need('cc')]), bb: man('bb', '1.2.0'), cc: man('cc', '1.1.0') };
  const { plan, refusal } = requirementPlan(manifests.aa, planCtx(manifests, { installed: { bb: '1.2.0' }, inactive: ['bb'] }));
  assert.equal(refusal, null);
  assert.deepEqual(plan.map(({ id, op, version }) => ({ id, op, version })), [{ id: 'bb', op: 'activate', version: '1.2.0' }, { id: 'cc', op: 'install', version: '1.1.0' }]);
  assert.deepEqual(requirementPlan(manifests.aa, planCtx(manifests, { installed: { bb: '1.2.0', cc: '1.1.0' } })).plan, [], 'active ones are not listed');
});

test('rule 9: the plan is transitive — a requirement off that itself needs a missing plugin installs that one first', () => {
  const manifests = { aa: man('aa', '1.0.0', [need('bb')]), bb: man('bb', '1.0.0', [need('cc')]), cc: man('cc', '1.0.0') };
  const { plan } = requirementPlan(manifests.aa, planCtx(manifests, { installed: { bb: '1.0.0' }, inactive: ['bb'] }));
  assert.deepEqual(plan.map((p) => `${p.op}:${p.id}`), ['install:cc', 'activate:bb']);
});

test('rule 9: a plugin two paths need is listed once', () => {
  const manifests = { aa: man('aa', '1.0.0', [need('bb'), need('cc')]), bb: man('bb', '1.0.0', [need('dd')]), cc: man('cc', '1.0.0', [need('dd')]), dd: man('dd', '1.0.0') };
  assert.deepEqual(requirementPlan(manifests.aa, planCtx(manifests)).plan.map((p) => p.id), ['dd', 'bb', 'cc']);
});

test('rule 9: a requirement off and out of plan stops the plan', () => {
  const manifests = { aa: man('aa', '1.0.0', [need('bb')]), bb: man('bb', '1.0.0') };
  const { refusal } = requirementPlan(manifests.aa, planCtx(manifests, { installed: { bb: '1.0.0' }, inactive: ['bb'], allows: (id) => id !== 'bb' }));
  assert.deepEqual([refusal.code, refusal.message], ['REQUIREMENT_OUT_OF_PLAN', 'Nécessite Nom bb, hors forfait.']);
});

test('rule 5: a cycle is refused REQUIREMENT_CYCLE with the names, never skipped', () => {
  const manifests = { aa: man('aa', '1.0.0', [need('bb')]), bb: man('bb', '1.0.0', [need('aa')]) };
  const { plan, refusal } = requirementPlan(manifests.aa, planCtx(manifests));
  assert.deepEqual(plan, []);
  assert.deepEqual([refusal.code, refusal.message], ['REQUIREMENT_CYCLE', 'Dépendance circulaire : Nom aa → Nom bb → Nom aa.']);
  const three = { aa: man('aa', '1.0.0', [need('bb')]), bb: man('bb', '1.0.0', [need('cc')]), cc: man('cc', '1.0.0', [need('bb')]) };
  assert.equal(requirementPlan(three.aa, planCtx(three)).refusal.message, 'Dépendance circulaire : Nom bb → Nom cc → Nom bb.');
});

test('rule 15: a requirement below its range reads « Nécessite X 1.7.1 ou plus récent (installé : 1.6.0). »', () => {
  const manifests = { aa: man('aa', '1.0.0', [need('bb', '^1.7.1')]), bb: man('bb', '1.6.0') };
  assert.equal(requirementPlan(manifests.aa, planCtx(manifests, { installed: { bb: '1.6.0' } })).refusal.message, 'Nécessite Nom bb 1.7.1 ou plus récent (installé : 1.6.0).');
});

// ---------- a release (packages mode) ----------

const wb = () => h.manifest(WB, '1.8.3');
const gvr = () => h.manifest(GVR, '1.0.2', { requires: [need(WB, '^1.7.1')] });

test('rule 9: the offer of an available plugin lists the plan, each line with its op', skip, async () => {
  const { ctrl, model } = h.setup({ bundled: [wb(), gvr()] });
  let offer = (await h.call(ctrl.list)).body.find((p) => p.id === GVR).offer;
  assert.deepEqual(offer.requirements, [{ id: WB, name: nm(WB), version: '1.8.3', op: 'install' }]);
  model.install(WB, row(WB, '1.8.3', wb()));
  model.setEnabled(WB, false);
  offer = (await h.call(ctrl.list)).body.find((p) => p.id === GVR).offer;
  assert.deepEqual(offer.requirements, [{ id: WB, name: nm(WB), version: '1.8.3', op: 'activate' }]);
});

test('rule 9: without the flag an install that needs an install is proposed as 409 REQUIREMENTS, lines with their op', skip, async () => {
  const { ctrl, model } = h.setup({ bundled: [wb(), gvr()] });
  const res = await h.call(ctrl.install, { params: { id: GVR } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'REQUIREMENTS');
  assert.deepEqual(res.body.requirements.map((r) => [r.id, r.op]), [[WB, 'install']]);
  assert.equal(model.get(WB), null);
});

test('rule 9: with the flag a requirement installed but off is switched on, then the plugin installed', skip, async () => {
  const { ctrl, model } = h.setup({ bundled: [wb(), gvr()], installed: [row(WB, '1.8.3', wb())] });
  model.setEnabled(WB, false);
  const order = [];
  const real = model.setEnabled;
  model.setEnabled = (id, on) => { order.push(`${id}:${on}`); return real(id, on); };
  const install = model.install;
  model.install = (id, ...rest) => { order.push(`install:${id}`); return install(id, ...rest); };
  const res = await h.call(ctrl.install, { params: { id: GVR }, body: { withRequirements: true } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(order, [`${WB}:true`, `install:${GVR}`]);
  assert.equal(model.get(WB).enabled, true);
  assert.equal(model.get(GVR).enabled, true);
});

test('rule 9: with the flag, a missing and an off requirement go in order — install first when it is deeper', skip, async () => {
  const sasM = h.manifest(SAS, '1.7.2', { requires: [need(WB, '^1.7.1')] });
  const weather = h.manifest(WEATHER, '1.3.0', { requires: [need(SAS, '^1.7.0')] });
  const { ctrl, model } = h.setup({ bundled: [wb(), sasM, weather], installed: [row(SAS, '1.7.2', sasM)] });
  model.setEnabled(SAS, false);
  const res = await h.call(ctrl.install, { params: { id: WEATHER }, body: { withRequirements: true } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual([WB, SAS, WEATHER].map((id) => model.get(id) && model.get(id).enabled), [true, true, true]);
});

test('rule 9: all or nothing — a failure after a requirement was switched on switches it back off and writes no row', skip, async () => {
  const ctx = h.setup({ bundled: [wb(), gvr()], installed: [row(WB, '1.8.3', wb())] });
  ctx.model.setEnabled(WB, false);
  const down = [];
  const ctrl = createController(ctx.model, {
    registry: h.registry,
    host: () => ctx.host,
    db: () => ctx.db,
    loader: () => ({
      migrate() {}, runInstallHooks: async () => {}, runActivateHooks() {}, beginInstall() {}, endInstall() {}, markInactive: (id) => down.push(id),
      requirePackage: (id) => ({ id, register() {} }),
      registerLive: (mod) => mod.id !== GVR,
    }),
    licence: () => ({ allowsPlugin: () => true, planFor: () => null }),
    coreVersion: () => '3.9.0',
  });
  const quiet = console.error;
  console.error = () => {};
  const res = await h.call(ctrl.install, { params: { id: GVR }, body: { withRequirements: true } });
  console.error = quiet;
  assert.equal(res.statusCode, 500);
  assert.equal(ctx.model.get(GVR), null);
  assert.equal(ctx.model.get(WB).enabled, false);
  assert.deepEqual(down, [WB]);
});

test('phase 4 install 409 kept: without the flag, a plan of switch-ons alone is still 409 REQUIREMENT_INACTIVE naming them', skip, async () => {
  const { ctrl, model } = h.setup({ bundled: [wb(), gvr()], installed: [row(WB, '1.8.3', wb())] });
  model.setEnabled(WB, false);
  const res = await h.call(ctrl.install, { params: { id: GVR } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'REQUIREMENT_INACTIVE');
  assert.deepEqual(res.body.requires, [WB]);
  assert.equal(model.get(GVR), null);
});

test('rule 5: installing a plugin in a cycle is refused 409 REQUIREMENT_CYCLE', async () => {
  const weather = h.manifest(WEATHER, '1.3.0', { requires: [need(SAS, '^1.7.0')] });
  const sasM = h.manifest(SAS, '1.7.2', { requires: [need(WEATHER, '^1.3.0')] });
  const { ctrl, model } = h.setup({ bundled: [weather, sasM] });
  const res = await h.call(ctrl.install, { params: { id: WEATHER }, body: { withRequirements: true } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'REQUIREMENT_CYCLE');
  assert.equal(res.body.message, `Dépendance circulaire : ${nm(WEATHER)} → ${nm(SAS)} → ${nm(WEATHER)}.`);
  assert.equal(model.get(WEATHER), null);
});

test('rule 5: the loader leaves every member of a cycle unloaded, and what needs them', () => {
  const a = h.manifest(WEATHER, '1.3.0', { requires: [need(SAS, '^1.7.0')] });
  const b = h.manifest(SAS, '1.7.2', { requires: [need(WEATHER, '^1.3.0')] });
  const c = h.manifest(WB, '1.8.3', { requires: [need(SAS, '^1.7.0')] });
  const dirs = Object.fromEntries([a, b, c].map((m) => [m.id, h.makePackage(m).dir]));
  const store = { packageDirFor: (id) => dirs[id] };
  const out = loader.loadPackages({
    store, rows: [a, b, c].map((m) => ({ id: m.id })), order: [WEATHER, SAS, WB], env: { coreVersion: '3.9.0', sdkVersion: '2.0.0' }, nameOf: (id) => `Nom ${id}`,
  });
  assert.deepEqual(out.modules, []);
  assert.equal(out.incompatible[WEATHER].code, 'REQUIREMENT_CYCLE');
  assert.equal(out.incompatible[SAS].code, 'REQUIREMENT_CYCLE');
  assert.equal(out.incompatible[WEATHER].message, `Dépendance circulaire : Nom ${SAS} → Nom ${WEATHER} → Nom ${SAS}.`);
  assert.equal(out.incompatible[WB].code, 'REQUIREMENT_MISSING');
});

// ---------- a development tree (sources mode) ----------

function sourcesTree({ without = [], failMigration = null } = {}) {
  const base = h.setup({ bundled: [] });
  const state = { mode: 'sources', incompatible: {}, loaded: {}, updating: false, restart: { supervised: true } };
  const host = {
    state: () => state,
    mode: () => 'sources',
    registryClient: () => ({ versions: () => [], status: () => ({ configured: false }) }),
    runningCopy: (id) => {
      if (without.includes(id)) return null;
      try { return { manifest: readSourceManifest(id), sha256: null }; } catch { return null; }
    },
    hostExports: () => null,
    store: () => ({}),
  };
  const calls = [];
  const known = { get: (id) => (failMigration ? { id, settings: [] } : null), isLive: () => true };
  const ctrl = createController(base.model, {
    registry: known,
    host: () => host,
    db: () => base.db,
    loader: () => ({
      migrate: (db, id) => { if (id === failMigration) throw new Error('boom'); calls.push(['migrate', id]); },
      runInstallHooks: async (id) => { calls.push(['install', id]); },
      runActivateHooks: (id) => { calls.push(['activate', id]); },
      beginInstall() {}, endInstall() {}, markInactive() {},
    }),
    licence: () => ({ allowsPlugin: () => true, planFor: () => null }),
    coreVersion: () => '0.0.0-dev',
  });
  return { ...base, ctrl, calls };
}

test('rule 10: in a development tree the offer lists the requirements, read from the source manifests', skip, async () => {
  const { ctrl } = sourcesTree();
  const offer = (await h.call(ctrl.list)).body.find((p) => p.id === GVR).offer;
  assert.deepEqual(offer.requirements.map((r) => [r.id, r.op]), [[WB, 'install']]);
  assert.equal(offer.refusal, null);
});

test('rule 10: an install in a development tree is proposed, not done, until the requirements are confirmed (closes H1)', skip, async () => {
  const { ctrl, model } = sourcesTree();
  const res = await h.call(ctrl.install, { params: { id: GVR } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'REQUIREMENTS');
  assert.equal(model.get(GVR), null);
  assert.equal(model.get(WB), null);
});

test('rule 10: confirmed, the requirement’s row is written first, then the plugin’s, and the hooks follow', skip, async () => {
  const { ctrl, model, calls } = sourcesTree();
  const order = [];
  const install = model.install;
  model.install = (id, ...rest) => { order.push(id); return install(id, ...rest); };
  const res = await h.call(ctrl.install, { params: { id: GVR }, body: { withRequirements: true } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(order, [WB, GVR]);
  assert.deepEqual(calls.filter(([k]) => k === 'install'), [], 'no module registered here: no install hook');
});

test('rule 10: a requirement installed but off is switched on in a development tree too', skip, async () => {
  const { ctrl, model } = sourcesTree();
  model.install(WB);
  model.setEnabled(WB, false);
  assert.equal((await h.call(ctrl.install, { params: { id: GVR } })).body.error, 'REQUIREMENT_INACTIVE');
  const res = await h.call(ctrl.install, { params: { id: GVR }, body: { withRequirements: true } });
  assert.equal(res.statusCode, 200);
  assert.equal(model.get(WB).enabled, true);
  assert.equal(model.get(GVR).enabled, true);
});

test('rule 10: a requirement absent from the tree is refused REQUIREMENT_MISSING', skip, async () => {
  const { ctrl, model } = sourcesTree({ without: [WB] });
  const res = await h.call(ctrl.install, { params: { id: GVR }, body: { withRequirements: true } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'REQUIREMENT_MISSING');
  assert.equal(model.get(GVR), null);
});

test('rule 10: all or nothing in a development tree — a failed migration of the plugin removes the requirement’s row', skip, async () => {
  const { ctrl, model } = sourcesTree({ failMigration: GVR });
  const quiet = console.error;
  console.error = () => {};
  const res = await h.call(ctrl.install, { params: { id: GVR }, body: { withRequirements: true } });
  console.error = quiet;
  assert.equal(res.statusCode, 500);
  assert.equal(model.get(WB), null);
  assert.equal(model.get(GVR), null);
});

test('rule 9: an install plan that switches a requirement on and then needs a restart leaves that requirement owing its hooks', skip, async () => {
  const ctx = h.setup({ bundled: [wb(), gvr()], installed: [row(WB, '1.8.3', wb())], loaded: { [GVR]: '0.9.0' } });
  ctx.model.setEnabled(WB, false);
  const res = await h.call(ctx.ctrl.install, { params: { id: GVR }, body: { withRequirements: true } });
  assert.equal(res.statusCode, 202);
  assert.deepEqual(ctx.model.pendingHooks(), [GVR, WB].sort());
});

test('rule 9: installing a requirement registers, without a restart, the dependant left unloaded at boot', skip, async () => {
  const sasM = h.manifest(SAS, '1.7.2');
  const weather = h.manifest(WEATHER, '1.3.0', { requires: [need(SAS, '^1.7.0')] });
  const ctx = h.setup({ bundled: [sasM, weather], installed: [row(WEATHER, '1.3.0', weather)] });
  ctx.host.state().incompatible[WEATHER] = { code: 'REQUIREMENT_MISSING', message: 'Nécessite X.' };
  const res = await h.call(ctx.ctrl.install, { params: { id: SAS } });
  assert.equal(res.statusCode, 200);
  assert.ok(ctx.calls.some(([k, id]) => k === 'live' && id === WEATHER), 'registered live');
  assert.equal(ctx.host.state().incompatible[WEATHER], undefined);
  assert.equal(ctx.host.state().loaded[WEATHER], '1.3.0');
  assert.ok(ctx.calls.some(([k, id]) => k === 'activate' && id === WEATHER), 'its activation hook ran');
});

test('rule 9: a dependant incompatible for another reason is left alone', skip, async () => {
  const sasM = h.manifest(SAS, '1.7.2');
  const weather = h.manifest(WEATHER, '1.3.0', { requires: [need(SAS, '^1.7.0')] });
  const ctx = h.setup({ bundled: [sasM, weather], installed: [row(WEATHER, '1.3.0', weather)] });
  ctx.host.state().incompatible[WEATHER] = { code: 'CORE_TOO_OLD', message: 'Incompatible avec cette version.' };
  await h.call(ctx.ctrl.install, { params: { id: SAS } });
  assert.equal(ctx.calls.some(([k, id]) => k === 'live' && id === WEATHER), false);
  assert.equal(ctx.host.state().incompatible[WEATHER].code, 'CORE_TOO_OLD');
});

test('rule 9: revival loops — a chain of dependants left unloaded at boot all come back', skip, async () => {
  const sasM = h.manifest(SAS, '1.7.2');
  const weather = h.manifest(WEATHER, '1.3.0', { requires: [need(SAS, '^1.7.0')] });
  const dependant = h.manifest(GVR, '1.0.2', { requires: [need(WEATHER, '^1.3.0')] });
  const ctx = h.setup({ bundled: [sasM, weather, dependant], installed: [row(WEATHER, '1.3.0', weather), row(GVR, '1.0.2', dependant)] });
  [WEATHER, GVR].forEach((id) => { ctx.host.state().incompatible[id] = { code: 'REQUIREMENT_MISSING', message: 'x' }; });
  await h.call(ctx.ctrl.install, { params: { id: SAS } });
  assert.deepEqual(ctx.host.state().incompatible, {});
  assert.deepEqual([ctx.host.state().loaded[WEATHER], ctx.host.state().loaded[GVR]], ['1.3.0', '1.0.2']);
});

test('rule 9: revival migrates first — a failed migration leaves the dependant unloaded and incompatible', skip, async () => {
  const sasM = h.manifest(SAS, '1.7.2');
  const weather = h.manifest(WEATHER, '1.3.0', { requires: [need(SAS, '^1.7.0')] });
  const ctx = h.setup({ bundled: [sasM, weather], installed: [row(WEATHER, '1.3.0', weather)] });
  ctx.host.state().incompatible[WEATHER] = { code: 'REQUIREMENT_MISSING', message: 'x' };
  const controller = createController(ctx.model, {
    registry: h.registry, host: () => ctx.host, db: () => ctx.db,
    loader: () => ({
      migrate: (db, id) => { if (id === WEATHER) throw new Error('boom'); },
      runInstallHooks: async () => {}, runActivateHooks() {}, beginInstall() {}, endInstall() {}, markInactive() {},
      requirePackage: (id) => ({ id, register() {} }), registerLive: () => true,
    }),
    licence: () => ({ allowsPlugin: () => true, planFor: () => null }),
    coreVersion: () => '3.9.0',
  });
  const quiet = console.error;
  console.error = () => {};
  const res = await h.call(controller.install, { params: { id: SAS } });
  console.error = quiet;
  assert.equal(res.statusCode, 200);
  assert.equal(ctx.host.state().incompatible[WEATHER].code, 'REQUIREMENT_MISSING');
  assert.equal(ctx.host.state().loaded[WEATHER], undefined);
});
