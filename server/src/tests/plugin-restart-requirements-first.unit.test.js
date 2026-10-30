// specs/plugins-phase-4-registry.md rule 50 (audit r3, N-R3-4) — once a step of an install plan owes the restart,
// every later install of the plan is recorded for the boot instead of running live: requirements first
// (rules 4 and 48), never a dependant's install hook against the old requirement code.
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../plugins/sdk/testing');

// specs/plugin-removal-resilience.md rules 4, 5 — the controller installs only the ids of the shipped catalogue, so these
// tests borrow shipped plugins' ids: a tree without one has nothing to prove.
if (!requirePlugins(['website-booking', 'google-vacation-rentals'])) return;
const h = require('./pluginPackagesFixture');
const registry = require('../plugins/sdk/registry');

const R = { id: 'website-booking', serverCode: "module.exports = { id: 'website-booking', register(ctx) { ctx.onInstall(() => { globalThis.__hooks.push('R:install'); }); ctx.onActivate(() => { globalThis.__hooks.push('R:activate'); }); } };" };
const D = { id: 'google-vacation-rentals', requires: [{ id: 'website-booking', range: '^1.0.0' }], serverCode: "module.exports = { id: 'google-vacation-rentals', register(ctx) { ctx.onInstall(() => { globalThis.__hooks.push('D:install'); }); ctx.onActivate(() => { globalThis.__hooks.push('D:activate'); }); } };" };

test('rule 50: the dependant is not installed live nor hooked while its requirement waits for the restart', async () => {
  globalThis.__hooks = [];
  const s = h.realSetup([R, D]);
  s.state.loaded['website-booking'] = '0.9.0';
  const res = await h.call(s.ctrl.install, { params: { id: 'google-vacation-rentals' }, body: { withRequirements: ['website-booking'] } });
  assert.equal(res.statusCode, 202);
  assert.deepEqual(globalThis.__hooks, []);
  assert.equal(registry.isLive('google-vacation-rentals'), false);
  assert.equal(s.state.loaded['google-vacation-rentals'], undefined);
  assert.equal(s.model.get('google-vacation-rentals').version, '1.0.0');
  assert.equal(s.model.hooksPendingKind('website-booking'), 'install');
  assert.equal(s.model.hooksPendingKind('google-vacation-rentals'), 'install');
});
