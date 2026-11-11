// specs/plugins-phase-4-registry.md rule 46 — switching a requirement on answers `reload: true` and the
// revived ids when a dependant came up (the browser must import its bundle); a dependant still waiting on
// another requirement names that one, not the requirement that just came up.
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../plugins/sdk/testing');

// specs/plugin-removal-resilience.md rules 4, 5 — the controller installs only the ids of the shipped catalogue, so these
// tests borrow shipped plugins' ids: a tree without one has nothing to prove.
if (!requirePlugins(['website-booking', 'google-vacation-rentals', 'sas'])) return;
const h = require('./pluginPackagesFixture');
const registry = require('../plugins/sdk/registry');

const D = { id: 'google-vacation-rentals', requires: [{ id: 'website-booking', range: '^1.0.0' }, { id: 'sas', range: '^1.0.0' }] };

async function waiting() {
  const s = h.realSetup([{ id: 'sas' }, { id: 'website-booking' }, D]);
  await h.call(s.ctrl.install, { params: { id: 'sas' } });
  await h.call(s.ctrl.deactivate, { params: { id: 'sas' } });
  const pkg = s.state.store.bundled()['google-vacation-rentals'];
  s.model.install('google-vacation-rentals', { version: '1.0.0', source: 'bundled', manifest: pkg.manifest, sha256: pkg.sha256 });
  s.state.incompatible['google-vacation-rentals'] = { code: 'REQUIREMENT_MISSING', message: 'Nécessite website-booking.' };
  return s;
}

test('rule 46: the requirement that came up is not named any more; the one still unmet is', async () => {
  const s = await waiting();
  await h.call(s.ctrl.install, { params: { id: 'website-booking' } });
  const left = s.state.incompatible['google-vacation-rentals'];
  assert.equal(left.code, 'REQUIREMENT_MISSING');
  assert.match(left.message, /^Nécessite /);
  assert.doesNotMatch(left.message, /website-booking/);
  assert.equal(registry.isLive('google-vacation-rentals'), false);
});

test('rule 46: activating the last requirement revives the dependant and answers reload with the ids', async () => {
  const s = await waiting();
  await h.call(s.ctrl.install, { params: { id: 'website-booking' } });
  const res = await h.call(s.ctrl.activate, { params: { id: 'sas' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reload, true);
  assert.deepEqual(res.body.revived, ['google-vacation-rentals']);
  assert.ok(s.state.loaded['google-vacation-rentals']);
});

test('rule 46: an activation that revives nobody does not ask for a reload', async () => {
  const s = h.realSetup([{ id: 'sas' }]);
  await h.call(s.ctrl.install, { params: { id: 'sas' } });
  await h.call(s.ctrl.deactivate, { params: { id: 'sas' } });
  const res = await h.call(s.ctrl.activate, { params: { id: 'sas' } });
  assert.equal(res.body.reload, undefined);
  assert.equal(res.body.revived, undefined);
});
