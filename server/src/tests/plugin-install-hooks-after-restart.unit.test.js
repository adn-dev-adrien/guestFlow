// specs/plugins-phase-4-registry.md rule 41 — an install that needed a restart owes its install and
// activation hooks: they run once at the boot that follows, not never.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./pluginPackagesFixture');
const loader = require('../plugins/loader');

const HOOKED = {
  id: 'linen',
  serverCode: "module.exports = { id: 'linen', register(ctx) { ctx.onInstall(() => { globalThis.__hooks.push('install'); }); ctx.onActivate(() => { globalThis.__hooks.push('activate'); }); } };",
};

test('rule 41: a restart-needing install marks the hooks pending, and the next boot runs them once', async () => {
  globalThis.__hooks = [];
  const s = h.realSetup([HOOKED]);
  s.state.loaded.linen = '0.9.0';
  const res = await h.call(s.ctrl.install, { params: { id: 'linen' } });
  assert.notEqual(res.statusCode, 500);
  assert.deepEqual(s.model.pendingHooks(), ['linen']);
  assert.deepEqual(globalThis.__hooks, []);

  // The restarted process: the plugin registers, then the boot settles what it owes.
  loader.registerAll({ db: s.db, modules: [require(`${s.state.store.packageDirFor('linen', s.model.get('linen'))}/server/index.js`)], isInstalled: () => true });
  loader.resetLiveTransitionsForTests();
  await loader.syncLiveTransitions();
  await loader.runPendingInstallHooks(s.model);
  assert.deepEqual(globalThis.__hooks, ['install', 'activate']);
  assert.deepEqual(s.model.pendingHooks(), []);
  await loader.runPendingInstallHooks(s.model);
  assert.deepEqual(globalThis.__hooks, ['install', 'activate']);
  delete globalThis.__hooks;
});

test('rule 41: an ordinary live install leaves nothing pending', async () => {
  globalThis.__hooks = [];
  const s = h.realSetup([HOOKED]);
  await h.call(s.ctrl.install, { params: { id: 'linen' } });
  assert.deepEqual(s.model.pendingHooks(), []);
  assert.deepEqual(globalThis.__hooks, ['install', 'activate']);
  delete globalThis.__hooks;
});

test('rule 41 + specs/plugin-dependencies.md rule 9: a plugin only switched on owes its activation hooks, not its install hooks', async () => {
  globalThis.__hooks = [];
  const s = h.realSetup([HOOKED]);
  await h.call(s.ctrl.install, { params: { id: 'linen' } });
  globalThis.__hooks = [];
  s.model.markHooksPending('linen', 'activate');
  assert.equal(s.model.hooksPendingKind('linen'), 'activate');
  s.model.markHooksPending('linen', 'activate');
  // The production boot order (index.js): the live set is recorded, then the pending hooks run.
  loader.resetLiveTransitionsForTests();
  await loader.syncLiveTransitions();
  await loader.runPendingInstallHooks(s.model);
  assert.deepEqual(globalThis.__hooks, ['activate']);
  assert.deepEqual(s.model.pendingHooks(), []);
  s.model.markHooksPending('linen', 'activate');
  s.model.markHooksPending('linen');
  assert.equal(s.model.hooksPendingKind('linen'), 'install', 'an install owed is never downgraded');
  delete globalThis.__hooks;
});
