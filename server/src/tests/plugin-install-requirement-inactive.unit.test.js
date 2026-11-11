// specs/plugins-phase-4-registry.md rule 38 — install is install-and-activate, so it refuses a
// plugin whose requirement is installed but switched off, like activate does (rule 37).
const test = require('node:test');
const assert = require('node:assert/strict');
const { skipWithout } = require('../plugins/sdk/testing');
const h = require('./pluginPackagesFixture');

const skip = { skip: skipWithout(['google-vacation-rentals', 'website-booking']) };

const requires = [{ id: 'website-booking', range: '^1.7.1' }];

function release() {
  return h.setup({
    bundled: [h.manifest('website-booking', '1.8.2'), h.manifest('google-vacation-rentals', '1.0.2', { requires })],
    installed: [{ id: 'website-booking', version: '1.8.2', source: 'bundled' }],
  });
}

test('rule 38: installing on top of an inactive requirement is refused 409 REQUIREMENT_INACTIVE', skip, async () => {
  const { ctrl, model } = release();
  model.setEnabled('website-booking', false);
  const res = await h.call(ctrl.install, { params: { id: 'google-vacation-rentals' } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'REQUIREMENT_INACTIVE');
  assert.deepEqual(res.body.requires, ['website-booking']);
  assert.match(res.body.message, /^Nécessite .+ : à activer d’abord\.$/);
  assert.equal(model.get('google-vacation-rentals'), null);
});

test('rule 38: with the requirement active the install goes through', skip, async () => {
  const { ctrl, model } = release();
  const res = await h.call(ctrl.install, { params: { id: 'google-vacation-rentals' } });
  assert.equal(res.statusCode, 200);
  assert.equal(model.get('google-vacation-rentals').enabled, true);
});
