// specs/plugins-phase-4-registry.md rule 45 (audit round 2, N3) — the activation hooks a restart-needing
// dependency plan owes run at the boot that follows, in the production order (register, record the live
// set, then the pending hooks): for a requirement switched on by the plan AND for one installed live in it.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./pluginPackagesFixture');
const loader = require('../plugins/loader');
const registry = require('../plugins/sdk/registry');

const R = { id: 'website-booking', serverCode: "module.exports = { id: 'website-booking', register(ctx) { ctx.onInstall(() => { globalThis.__hooks.push('R:install'); }); ctx.onActivate(() => { globalThis.__hooks.push('R:activate'); }); } };" };
const D = { id: 'google-vacation-rentals', requires: [{ id: 'website-booking', range: '^1.0.0' }], serverCode: "module.exports = { id: 'google-vacation-rentals', register(ctx) { ctx.onActivate(() => { globalThis.__hooks.push('D:activate'); }); } };" };
const modOf = (s, id) => require(`${s.state.store.packageDirFor(id, s.model.get(id))}/server/index.js`);

async function boot(s) {
  // A fresh process: nothing registered yet.
  registry.discard('website-booking');
  registry.discard('google-vacation-rentals');
  loader.registerAll({ db: s.db, modules: [modOf(s, 'website-booking'), modOf(s, 'google-vacation-rentals')], isInstalled: () => true });
  loader.resetLiveTransitionsForTests();
  await loader.syncLiveTransitions();
  await loader.runPendingInstallHooks(s.model);
}

test('rule 45: a requirement switched on by a restart-needing plan gets its activation hook at boot', async () => {
  globalThis.__hooks = [];
  const s = h.realSetup([R, D]);
  await h.call(s.ctrl.install, { params: { id: 'website-booking' } });
  await h.call(s.ctrl.deactivate, { params: { id: 'website-booking' } });
  s.state.loaded['google-vacation-rentals'] = '0.9.0';
  globalThis.__hooks = [];
  const res = await h.call(s.ctrl.install, { params: { id: 'google-vacation-rentals' }, body: { withRequirements: ['website-booking'] } });
  assert.notEqual(res.statusCode, 500);
  await boot(s);
  assert.deepEqual([...globalThis.__hooks].sort(), ['D:activate', 'R:activate']);
  assert.deepEqual(s.model.pendingHooks(), []);
  delete globalThis.__hooks;
});

test('rule 45: a requirement installed live inside a restart-needing plan owes its activation hook at boot', async () => {
  globalThis.__hooks = [];
  const s = h.realSetup([R, D]);
  s.state.loaded['google-vacation-rentals'] = '0.9.0';
  const res = await h.call(s.ctrl.install, { params: { id: 'google-vacation-rentals' }, body: { withRequirements: ['website-booking'] } });
  assert.notEqual(res.statusCode, 500);
  assert.deepEqual(globalThis.__hooks, ['R:install'], 'the live install ran its install hook now');
  assert.equal(s.model.hooksPendingKind('website-booking'), 'activate');
  await boot(s);
  assert.deepEqual([...globalThis.__hooks].sort(), ['D:activate', 'R:activate', 'R:install']);
  delete globalThis.__hooks;
});
