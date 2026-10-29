// specs/plugins-phase-4-registry.md rule 46 (audit round 2, N4) — a dependant revived live after its
// requirement came up is failed (nothing of it runs) when its migration throws, and an enabled one waits
// for every requirement to be enabled, not only loaded.
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../plugins/sdk/testing');

// specs/plugin-removal-resilience.md rules 4, 5 — the controller installs only the ids of the shipped catalogue, so these
// tests borrow shipped plugins' ids: a tree without one has nothing to prove.
if (!requirePlugins(['website-booking', 'google-vacation-rentals', 'sas'])) return;
const h = require('./pluginPackagesFixture');
const registry = require('../plugins/sdk/registry');

const R = { id: 'website-booking' };
const D = {
  id: 'google-vacation-rentals',
  requires: [{ id: 'website-booking', range: '^1.0.0' }],
  serverCode: "module.exports = { id: 'google-vacation-rentals', register(ctx) { ctx.migrations([{ name: 'gvr-1', up: () => { throw new Error('disk full'); } }]); ctx.onActivate(() => { globalThis.__activated = true; }); ctx.route('get', '/api/gvr-probe', (req, res) => res.json({ ok: true })); } };",
};

function leaveUnloaded(s, id) {
  const pkg = s.state.store.bundled()[id];
  s.model.install(id, { version: '1.0.0', source: 'bundled', manifest: pkg.manifest, sha256: pkg.sha256 });
  s.state.incompatible[id] = { code: 'REQUIREMENT_MISSING', message: 'Nécessite website-booking.' };
}

test('rule 46: a revived dependant whose migration throws is failed, not live, and not announced', async () => {
  delete globalThis.__activated;
  const s = h.realSetup([R, D]);
  leaveUnloaded(s, 'google-vacation-rentals');
  const res = await h.call(s.ctrl.install, { params: { id: 'website-booking' } });
  assert.equal(res.statusCode, 200);
  assert.equal(registry.isLive('google-vacation-rentals'), false);
  assert.ok(registry.get('google-vacation-rentals').failed);
  assert.equal(s.state.loaded['google-vacation-rentals'], undefined);
  assert.equal(globalThis.__activated, undefined);
});

test('rule 46: an enabled dependant is not revived while another requirement is installed but off', async () => {
  const s = h.realSetup([{ id: 'sas' }, R, { id: 'google-vacation-rentals', requires: [{ id: 'website-booking', range: '^1.0.0' }, { id: 'sas', range: '^1.0.0' }] }]);
  await h.call(s.ctrl.install, { params: { id: 'sas' } });
  await h.call(s.ctrl.deactivate, { params: { id: 'sas' } });
  leaveUnloaded(s, 'google-vacation-rentals');
  await h.call(s.ctrl.install, { params: { id: 'website-booking' } });
  assert.equal(registry.isLive('google-vacation-rentals'), false);
  assert.equal(s.model.get('sas').enabled, false);
  assert.equal(s.state.incompatible['google-vacation-rentals'].code, 'REQUIREMENT_MISSING');
});

test('rule 46: switching a requirement on revives the dependants left unloaded, in the same operation', async () => {
  delete globalThis.__activated;
  const s = h.realSetup([R, { id: 'google-vacation-rentals', requires: [{ id: 'website-booking', range: '^1.0.0' }] }]);
  await h.call(s.ctrl.install, { params: { id: 'website-booking' } });
  await h.call(s.ctrl.deactivate, { params: { id: 'website-booking' } });
  leaveUnloaded(s, 'google-vacation-rentals');
  s.model.setEnabled('google-vacation-rentals', false);
  const res = await h.call(s.ctrl.activate, { params: { id: 'website-booking' } });
  assert.equal(res.statusCode, 200);
  assert.equal(s.state.incompatible['google-vacation-rentals'], undefined);
  assert.ok(s.state.loaded['google-vacation-rentals']);
  assert.ok(registry.get('google-vacation-rentals') && !registry.get('google-vacation-rentals').failed);
});

test('rule 46: the revive on activate marks a dependant failed when its migration throws', async () => {
  const s = h.realSetup([R, D]);
  await h.call(s.ctrl.install, { params: { id: 'website-booking' } });
  await h.call(s.ctrl.deactivate, { params: { id: 'website-booking' } });
  leaveUnloaded(s, 'google-vacation-rentals');
  s.model.setEnabled('google-vacation-rentals', false);
  const res = await h.call(s.ctrl.activate, { params: { id: 'website-booking' } });
  assert.equal(res.statusCode, 200);
  assert.ok(registry.get('google-vacation-rentals').failed);
  assert.equal(s.state.loaded['google-vacation-rentals'], undefined);
});
