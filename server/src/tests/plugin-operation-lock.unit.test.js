// specs/plugins-phase-4-registry.md rule 43 (audit round 2, N1) — activate, deactivate and uninstall refuse
// 409 UPDATE_IN_PROGRESS while a plugin operation (an install awaiting its package) holds the lock, so
// rules 12, 36 and 37 never read rows the install is still writing.
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../plugins/sdk/testing');

// specs/plugin-removal-resilience.md rules 4, 5 — the controller installs only the ids of the shipped catalogue, so these
// tests borrow shipped plugins' ids: a tree without one has nothing to prove.
if (!requirePlugins(['website-booking', 'google-vacation-rentals'])) return;
const h = require('./pluginPackagesFixture');

const wb = h.manifest('website-booking', '1.8.2');
const gvr = h.manifest('google-vacation-rentals', '1.0.2', { requires: [{ id: 'website-booking', range: '^1.7.1' }] });

test('rule 43: deactivating the requirement while the dependant installs is refused, and the install ends coherent', async () => {
  const { ctrl, model } = h.setup({ bundled: [wb, gvr], installed: [{ id: 'website-booking', version: '1.8.2', source: 'bundled' }] });
  model.setEnabled('website-booking', false);
  const pending = h.call(ctrl.install, { params: { id: 'google-vacation-rentals' }, body: { withRequirements: ['website-booking'] } });
  const off = await h.call(ctrl.deactivate, { params: { id: 'website-booking' } });
  const res = await pending;
  assert.equal(off.statusCode, 409);
  assert.equal(off.body.error, 'UPDATE_IN_PROGRESS');
  assert.equal(res.statusCode, 200);
  assert.equal(model.get('website-booking').enabled, true);
  assert.equal(model.get('google-vacation-rentals').enabled, true);
});

test('rule 43: uninstalling the requirement while the dependant installs is refused', async () => {
  const { ctrl, model } = h.setup({ bundled: [wb, gvr] });
  const pending = h.call(ctrl.install, { params: { id: 'google-vacation-rentals' }, body: { withRequirements: ['website-booking'] } });
  for (let i = 0; i < 50 && !(model.get('website-booking') && !model.get('google-vacation-rentals')); i += 1) await Promise.resolve();
  const un = await h.call(ctrl.uninstall, { params: { id: 'website-booking' } });
  const res = await pending;
  assert.equal(un.statusCode, 409);
  assert.equal(un.body.error, 'UPDATE_IN_PROGRESS');
  assert.equal(res.statusCode, 200);
  assert.ok(model.get('website-booking') && model.get('google-vacation-rentals'));
});

test('rule 43: activating is refused while an operation is in flight, and works once it ended', async () => {
  const { ctrl, model, host } = h.setup({ bundled: [wb], installed: [{ id: 'website-booking', version: '1.8.2', source: 'bundled' }] });
  const state = host.state();
  model.setEnabled('website-booking', false);
  state.updating = true;
  const refused = await h.call(ctrl.activate, { params: { id: 'website-booking' } });
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.body.error, 'UPDATE_IN_PROGRESS');
  assert.equal(model.get('website-booking').enabled, false);
  state.updating = false;
  assert.equal((await h.call(ctrl.activate, { params: { id: 'website-booking' } })).statusCode, 200);
});
