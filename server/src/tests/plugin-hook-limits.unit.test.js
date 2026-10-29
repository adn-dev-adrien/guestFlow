// specs/plugins-phase-4-registry.md rule 48 — (a) the hooks a restart owes run requirements first, not in id
// order; (b) an onInstall / onActivate hook that never settles is given up on after a bounded time, logged,
// so it cannot hold the plugin-operation lock for ever.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./pluginPackagesFixture');
const loader = require('../plugins/loader');

const hookOf = (id, tag, requires = []) => ({
  id, requires,
  serverCode: `module.exports = { id: '${id}', register(ctx) { ctx.onActivate(() => { globalThis.__order.push('${tag}'); }); } };`,
});

test('rule 48: pending activation hooks run requirements first', async () => {
  globalThis.__order = [];
  const s = h.realSetup([hookOf('website-booking', 'R'), hookOf('google-vacation-rentals', 'D', [{ id: 'website-booking', range: '^1.0.0' }])]);
  await h.call(s.ctrl.install, { params: { id: 'website-booking' } });
  await h.call(s.ctrl.install, { params: { id: 'google-vacation-rentals' } });
  ['website-booking', 'google-vacation-rentals'].forEach((id) => loader.markInactive(id));
  globalThis.__order = [];
  s.model.markHooksPending('google-vacation-rentals', 'activate');
  s.model.markHooksPending('website-booking', 'activate');
  await loader.runPendingInstallHooks(s.model);
  assert.deepEqual(globalThis.__order, ['R', 'D'], 'ids sort D before W; the graph says R first');
  delete globalThis.__order;
});

test('rule 48: an install hook that never settles is given up on and the install goes on', async () => {
  const errors = [];
  const real = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  loader.setHookTimeoutForTests(30);
  try {
    const s = h.realSetup([{ id: 'linen', serverCode: "module.exports = { id: 'linen', register(ctx) { ctx.onInstall(() => new Promise(() => {})); } };" }]);
    const res = await h.call(s.ctrl.install, { params: { id: 'linen' } });
    assert.equal(res.statusCode, 200);
    assert.ok(errors.some((e) => /\[plugin:linen\] install hook failed: hook did not settle/.test(e)));
    assert.equal(s.state.updating, false, 'the lock is released');
  } finally {
    loader.setHookTimeoutForTests(120000);
    console.error = real;
  }
});
