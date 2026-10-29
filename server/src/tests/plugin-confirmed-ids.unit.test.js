// specs/plugin-dependencies.md rule 22 (audit round 2, N6) — a cascade request carries the ids the operator
// confirmed (`withRequirements` / `withDependents` are id lists). The server recomputes the closure and
// refuses 409 CONFIRMATION_STALE when it differs: nobody is switched on or off unseen.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./pluginPackagesFixture');

const WB = 'website-booking';
const GVR = 'google-vacation-rentals';
const site = () => h.manifest(WB, '1.8.3');
const feed = () => h.manifest(GVR, '1.0.2', { requires: [{ id: WB, range: '^1.7.1' }] });
const row = (id, manifest) => ({ id, version: manifest.version, source: 'bundled', manifest });
const both = () => h.setup({ bundled: [site(), feed()], installed: [row(WB, site()), row(GVR, feed())] });

test('rule 22: activate — a list that is not the requirements to switch on is refused, nothing moves', async () => {
  const { ctrl, model } = both();
  model.setEnabled(GVR, false);
  model.setEnabled(WB, false);
  for (const given of [['sas'], [WB, 'sas'], true]) {
    const res = await h.call(ctrl.activate, { params: { id: GVR }, body: { withRequirements: given } });
    assert.equal(res.statusCode, 409, JSON.stringify(given));
    assert.equal(res.body.error, 'CONFIRMATION_STALE');
    assert.deepEqual(res.body.requirements.map((r) => r.id), [WB]);
  }
  assert.deepEqual([WB, GVR].map((id) => model.get(id).enabled), [false, false]);
  assert.equal((await h.call(ctrl.activate, { params: { id: GVR }, body: { withRequirements: [WB] } })).statusCode, 200);
  assert.deepEqual([WB, GVR].map((id) => model.get(id).enabled), [true, true]);
});

test('rule 22: deactivate — a dependant that appeared since the click is not switched off unseen', async () => {
  const { ctrl, model } = both();
  const res = await h.call(ctrl.deactivate, { params: { id: WB }, body: { withDependents: [] } });
  assert.equal(res.statusCode, 409, 'an empty list confirms nothing');
  assert.equal(res.body.error, 'REQUIRED_BY');
  const stale = await h.call(ctrl.deactivate, { params: { id: WB }, body: { withDependents: ['sas'] } });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.body.error, 'CONFIRMATION_STALE');
  assert.deepEqual(stale.body.requirements.map((r) => r.id), [GVR]);
  assert.deepEqual([WB, GVR].map((id) => model.get(id).enabled), [true, true]);
  assert.equal((await h.call(ctrl.deactivate, { params: { id: WB }, body: { withDependents: [GVR] } })).statusCode, 200);
  assert.deepEqual([WB, GVR].map((id) => model.get(id).enabled), [false, false]);
});

test('rule 22: install — the confirmed plan must be the plan now', async () => {
  const { ctrl, model } = h.setup({ bundled: [site(), feed()] });
  const stale = await h.call(ctrl.install, { params: { id: GVR }, body: { withRequirements: ['sas'] } });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.body.error, 'CONFIRMATION_STALE');
  assert.equal(model.get(WB), null);
  const unconfirmed = await h.call(ctrl.install, { params: { id: GVR }, body: {} });
  assert.equal(unconfirmed.body.error, 'REQUIREMENTS', 'no list at all is still the proposal');
  assert.equal((await h.call(ctrl.install, { params: { id: GVR }, body: { withRequirements: [WB] } })).statusCode, 200);
});
