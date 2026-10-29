// specs/plugins-phase-4-registry.md rules 55 and 56 (audit r4, N-R4-2) — an update, update-all, rollback and the
// bundled-row sync at a core update are held to the requirement checks install and activate enforce (rules 37, 38
// and plugin-dependencies rule 5), and an installed cycle can be dismantled by uninstalling its members.
const test = require('node:test');
const assert = require('node:assert/strict');

const h = require('./pluginPackagesFixture');
const host = require('../plugins/host');

const req = (id) => ({ id, range: '^1.0.0' });
const row = (m) => ({ id: m.id, version: m.version, source: 'bundled', manifest: m });

test('rule 55: an update that adds a requirement installed but OFF is refused while the plugin is active', async () => {
  const a1 = h.manifest('xa', '1.0.0');
  const b1 = h.manifest('xb', '1.0.0');
  const a2 = h.manifest('xa', '1.1.0', { requires: [req('xb')] });
  const { ctrl, model, registryClient } = h.setup({
    bundled: [a1, b1], regEntries: [{ m: a2, buf: h.makePackage(a2).buf }], installed: [row(a1), row(b1)],
  });
  model.setEnabled('xb', false);
  await registryClient.refresh();
  const card = (await h.call(ctrl.list)).body.find((p) => p.id === 'xa');
  assert.equal(card.update.refusal.code, 'REQUIREMENT_INACTIVE');
  assert.match(card.update.refusal.message, /Nécessite Plugin xb : à activer d’abord/);
  const res = await h.call(ctrl.update, { params: { id: 'xa' } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'REQUIREMENT_INACTIVE');
  assert.equal(model.get('xa').version, '1.0.0');
  assert.equal(model.get('xb').enabled, false);
  const all = await h.call(ctrl.updateAll, {});
  assert.equal(all.statusCode, 409);
  assert.equal(all.body.error, 'NO_UPDATE');
  assert.equal(model.get('xa').version, '1.0.0');
});

test('rule 55: the same update is allowed when the plugin itself is off', async () => {
  const a1 = h.manifest('xa', '1.0.0');
  const b1 = h.manifest('xb', '1.0.0');
  const a2 = h.manifest('xa', '1.1.0', { requires: [req('xb')] });
  const { ctrl, model, registryClient } = h.setup({
    bundled: [a1, b1], regEntries: [{ m: a2, buf: h.makePackage(a2).buf }], installed: [row(a1), row(b1)],
  });
  model.setEnabled('xb', false);
  model.setEnabled('xa', false);
  await registryClient.refresh();
  const res = await h.call(ctrl.update, { params: { id: 'xa' } });
  assert.equal(res.statusCode, 202);
  assert.equal(model.get('xa').version, '1.1.0');
});

test('rule 55: an update that closes a cycle through active plugins is refused, one by one and in bulk', async () => {
  const a1 = h.manifest('xa', '1.0.0');
  const b1 = h.manifest('xb', '1.0.0', { requires: [req('xa')] });
  const a2 = h.manifest('xa', '1.1.0', { requires: [req('xb')] });
  const { ctrl, model, registryClient } = h.setup({
    bundled: [a1, b1], regEntries: [{ m: a2, buf: h.makePackage(a2).buf }], installed: [row(a1), row(b1)],
  });
  await registryClient.refresh();
  const card = (await h.call(ctrl.list)).body.find((p) => p.id === 'xa');
  assert.equal(card.update.refusal.code, 'REQUIREMENT_CYCLE');
  const res = await h.call(ctrl.update, { params: { id: 'xa' } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'REQUIREMENT_CYCLE');
  assert.equal(model.get('xa').version, '1.0.0');
  const all = await h.call(ctrl.updateAll, {});
  assert.equal(all.statusCode, 409);
  assert.equal(model.get('xa').version, '1.0.0');
});

test('rule 55: a rollback to a version whose requirements close a cycle is refused', async () => {
  const a1 = h.manifest('xa', '1.0.0', { requires: [req('xb')] });
  const b1 = h.manifest('xb', '1.0.0');
  const a2 = h.manifest('xa', '1.1.0');
  const { ctrl, model, registryClient, host: fakeHost } = h.setup({
    bundled: [a1, b1], regEntries: [{ m: a2, buf: h.makePackage(a2).buf }], installed: [row(a1), row(b1)],
  });
  await registryClient.refresh();
  assert.equal((await h.call(ctrl.update, { params: { id: 'xa' } })).statusCode, 202);
  fakeHost.state().updating = false;
  model.syncBundled('xb', h.manifest('xb', '1.0.0', { requires: [req('xa')] }), null);
  const res = await h.call(ctrl.rollback, { params: { id: 'xa' } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'REQUIREMENT_CYCLE');
  assert.equal(model.get('xa').version, '1.1.0');
});

test('rule 55: the bundled-row sync at a core update leaves a row alone when the new manifest would close a cycle', () => {
  const a1 = h.manifest('xa', '1.0.0');
  const b1 = h.manifest('xb', '1.0.0', { requires: [req('xa')] });
  const a2 = h.manifest('xa', '1.1.0', { requires: [req('xb')] });
  const { model } = h.setup({ bundled: [a1, b1], installed: [row(a1), row(b1)] });
  const shipped = { xa: a2, xb: b1 };
  const errors = [];
  const spy = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    host.housekeeping({ model, ids: ['xa', 'xb'], copyOf: (id) => ({ manifest: shipped[id], sha256: null }) });
  } finally {
    console.error = spy;
  }
  assert.equal(model.get('xa').version, '1.0.0');
  assert.equal(model.get('xb').version, '1.0.0');
  assert.ok(errors.some((e) => /xa/.test(e) && /REQUIREMENT_CYCLE/.test(e)), errors.join('|'));
});

test('rule 56: two installed plugins that require each other can be uninstalled, one after the other', async () => {
  const a = h.manifest('xa', '1.0.0', { requires: [req('xb')] });
  const b = h.manifest('xb', '1.0.0', { requires: [req('xa')] });
  const { ctrl, model } = h.setup({ bundled: [a, b], installed: [row(a), row(b)] });
  ['xa', 'xb'].forEach((id) => model.setEnabled(id, false));
  const cards = (await h.call(ctrl.list)).body;
  assert.equal(cards.find((p) => p.id === 'xa').actions.uninstall.allowed, true);
  assert.equal((await h.call(ctrl.uninstall, { params: { id: 'xa' }, query: {} })).statusCode, 200);
  assert.equal(model.get('xa'), null);
  assert.equal((await h.call(ctrl.uninstall, { params: { id: 'xb' }, query: {} })).statusCode, 200);
});

test('rule 56: a dependant outside the cycle still blocks the uninstall', async () => {
  const a = h.manifest('xa', '1.0.0', { requires: [req('xb')] });
  const b = h.manifest('xb', '1.0.0', { requires: [req('xa')] });
  const c = h.manifest('xc', '1.0.0', { requires: [req('xa')] });
  const { ctrl, model } = h.setup({ bundled: [a, b, c], installed: [row(a), row(b), row(c)] });
  ['xa', 'xb', 'xc'].forEach((id) => model.setEnabled(id, false));
  const res = await h.call(ctrl.uninstall, { params: { id: 'xa' }, query: {} });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'REQUIRED_BY');
  assert.deepEqual(res.body.requiredBy, ['xc']);
});

test('rule 56: a plugin that needs the cycle through one member blocks the removal of every member', async () => {
  const a = h.manifest('xa', '1.0.0', { requires: [req('xb')] });
  const b = h.manifest('xb', '1.0.0', { requires: [req('xa')] });
  const d = h.manifest('xd', '1.0.0', { requires: [req('xa')] });
  const { ctrl, model } = h.setup({ bundled: [a, b, d], installed: [row(a), row(b), row(d)] });
  ['xa', 'xb', 'xd'].forEach((id) => model.setEnabled(id, false));
  const res = await h.call(ctrl.uninstall, { params: { id: 'xb' }, query: {} });
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body.requiredBy, ['xd']);
  assert.equal((await h.call(ctrl.list)).body.find((p) => p.id === 'xb').actions.uninstall.allowed, false);
});
