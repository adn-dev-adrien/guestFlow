// specs/plugins-phase-4-registry.md rule 39 — a plugin whose live `register` failed is registered
// afresh by the next install: it comes up whole, or the install answers the error again.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const h = require('./pluginPackagesFixture');
const loader = require('../plugins/loader');

const flaky = (flag) => ({
  id: 'linen',
  serverCode: `module.exports = { id: 'linen', register(ctx) { if (globalThis.${flag}) throw new Error('transient'); ctx.route('get', '/api/linen-probe', (req, res) => res.json({ ok: true })); } };`,
});

const get = (app, path) => new Promise((resolve, reject) => {
  const server = app.listen(0, () => {
    fetch(`http://127.0.0.1:${server.address().port}${path}`).then((r) => r.json()).then(resolve, reject).finally(() => server.close());
  });
});

const silently = async (fn) => {
  const original = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = original; }
};

test('rule 39: a failed live register is cleared by the retry, which then mounts the routes once', async () => {
  globalThis.__flakyFails = true;
  const s = h.realSetup([flaky('__flakyFails')]);
  const app = express();
  loader.mountApi(app);
  const first = await silently(() => h.call(s.ctrl.install, { params: { id: 'linen' } }));
  assert.equal(first.statusCode, 500);
  assert.equal(first.body.error, 'PLUGIN_REGISTER_FAILED');
  assert.equal(s.model.get('linen'), null);

  globalThis.__flakyFails = false;
  const second = await h.call(s.ctrl.install, { params: { id: 'linen' } });
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.state, 'active');
  assert.equal(h.registry.get('linen').failed, null);
  assert.equal(h.registry.isLive('linen'), true);
  assert.equal(h.registry.get('linen').routes.length, 1);
  assert.deepEqual(await get(app, '/api/linen-probe'), { ok: true });
  delete globalThis.__flakyFails;
});

test('rule 39: a retry that fails again still answers the error and stays off', async () => {
  globalThis.__flakyStill = true;
  const s = h.realSetup([flaky('__flakyStill')]);
  loader.mountApi(express());
  await silently(() => h.call(s.ctrl.install, { params: { id: 'linen' } }));
  const again = await silently(() => h.call(s.ctrl.install, { params: { id: 'linen' } }));
  assert.equal(again.statusCode, 500);
  assert.equal(h.registry.isLive('linen'), false);
  delete globalThis.__flakyStill;
});
