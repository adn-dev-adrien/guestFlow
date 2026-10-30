// specs/plugins-phase-4-registry.md rule 59 (audit r5, N-R5-1) — an update or a rollback of a REQUIREMENT is held
// to the ranges its active dependants declare, on the card, on the endpoints and in update-all.
const test = require('node:test');
const assert = require('node:assert/strict');

const h = require('./pluginPackagesFixture');
const { createGraph } = require('../utils/pluginGraph');
const { requirementPlan } = require('../utils/pluginOffers');

const r = (id, range = '^1.0.0') => ({ id, range });
const installed = (m) => ({ id: m.id, version: m.version, source: 'bundled', manifest: m });
const reg = (m) => ({ m, buf: h.makePackage(m).buf });

test('rule 59: an update past a range an active dependant declares is refused on the card and by the endpoint', async () => {
  const a1 = h.manifest('xa', '1.0.0');
  const b1 = h.manifest('xb', '1.0.0', { requires: [r('xa')] });
  const a2 = h.manifest('xa', '2.0.0');
  const { ctrl, model, registryClient } = h.setup({ bundled: [a1, b1], regEntries: [reg(a2)], installed: [installed(a1), installed(b1)] });
  await registryClient.refresh();
  const card = (await h.call(ctrl.list, {})).body.find((p) => p.id === 'xa');
  assert.equal(card.update.refusal.code, 'REQUIRED_BY_RANGE');
  assert.match(card.update.refusal.message, /nécessite .* compatible avec \^1\.0\.0 : à mettre à jour d’abord\.$/);
  const res = await h.call(ctrl.update, { params: { id: 'xa' } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'REQUIRED_BY_RANGE');
  assert.equal(model.get('xa').version, '1.0.0');
});

test('rule 59: an INACTIVE dependant does not hold the requirement back', async () => {
  const a1 = h.manifest('xa', '1.0.0');
  const b1 = h.manifest('xb', '1.0.0', { requires: [r('xa')] });
  const a2 = h.manifest('xa', '2.0.0');
  const { ctrl, model, registryClient } = h.setup({ bundled: [a1, b1], regEntries: [reg(a2)], installed: [installed(a1), installed(b1)] });
  model.setEnabled('xb', false);
  await registryClient.refresh();
  const card = (await h.call(ctrl.list, {})).body.find((p) => p.id === 'xa');
  assert.equal(card.update.refusal, null);
});

test('rule 59: a rollback of the requirement below the floor of an active dependant is refused, card and endpoint', async () => {
  const a1 = h.manifest('xa', '1.0.0');
  const b1 = h.manifest('xb', '1.0.0', { requires: [r('xa')] });
  const a2 = h.manifest('xa', '1.1.0');
  const b2 = h.manifest('xb', '1.1.0', { requires: [r('xa', '^1.1.0')] });
  const { ctrl, model, registryClient, host } = h.setup({
    bundled: [a1, b1], regEntries: [reg(a2), reg(b2)], installed: [installed(a1), installed(b1)],
  });
  await registryClient.refresh();
  assert.equal((await h.call(ctrl.update, { params: { id: 'xa' } })).statusCode, 202);
  host.state().updating = false;
  assert.equal((await h.call(ctrl.update, { params: { id: 'xb' } })).statusCode, 202);
  host.state().updating = false;
  const card = (await h.call(ctrl.list, {})).body.find((p) => p.id === 'xa');
  assert.equal(card.rollback.refusal.code, 'REQUIRED_BY_RANGE');
  assert.match(card.rollback.refusal.message, /nécessite .* 1\.1 ou plus récente : à remettre à sa version précédente ou à désactiver d’abord\.$/);
  const res = await h.call(ctrl.rollback, { params: { id: 'xa' }, body: {} });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'REQUIRED_BY_RANGE');
  assert.equal(model.get('xa').version, '1.1.0');
});

test('rule 59: update-all judges the cycle two targets would close together', async () => {
  const a1 = h.manifest('xa', '1.0.0');
  const b1 = h.manifest('xb', '1.0.0');
  const a2 = h.manifest('xa', '1.1.0', { requires: [r('xb')] });
  const b2 = h.manifest('xb', '1.1.0', { requires: [r('xa')] });
  const { ctrl, model, registryClient } = h.setup({ bundled: [a1, b1], regEntries: [reg(a2), reg(b2)], installed: [installed(a1), installed(b1)] });
  await registryClient.refresh();
  const res = await h.call(ctrl.updateAll, {});
  assert.equal(res.statusCode, 409);
  assert.deepEqual([model.get('xa').version, model.get('xb').version], ['1.0.0', '1.0.0']);
});

test('rule 59: update-all drops the requirement whose new major an active dependant (not updated) refuses', async () => {
  const a1 = h.manifest('xa', '1.0.0');
  const b1 = h.manifest('xb', '1.0.0', { requires: [r('xa')] });
  const a2 = h.manifest('xa', '2.0.0');
  const { ctrl, model, registryClient } = h.setup({ bundled: [a1, b1], regEntries: [reg(a2)], installed: [installed(a1), installed(b1)] });
  await registryClient.refresh();
  const res = await h.call(ctrl.updateAll, {});
  assert.equal(res.statusCode, 409);
  assert.equal(model.get('xa').version, '1.0.0');
});

test('rule 59: update-all lets a requirement and its dependant move together when the new ranges agree', async () => {
  const a1 = h.manifest('xa', '1.0.0');
  const b1 = h.manifest('xb', '1.0.0', { requires: [r('xa')] });
  const a2 = h.manifest('xa', '2.0.0');
  const b2 = h.manifest('xb', '2.0.0', { requires: [r('xa', '^2.0.0')] });
  const { ctrl, model, registryClient } = h.setup({ bundled: [a1, b1], regEntries: [reg(a2), reg(b2)], installed: [installed(a1), installed(b1)] });
  await registryClient.refresh();
  const res = await h.call(ctrl.updateAll, {});
  assert.equal(res.statusCode, 202);
  assert.deepEqual([model.get('xa').version, model.get('xb').version], ['2.0.0', '2.0.0']);
});

test('rule 59: the status label of a version past the range no longer calls it « plus récente »', () => {
  const g = createGraph({
    manifests: { xa: { id: 'xa' }, xb: { id: 'xb', requires: [r('xa')] }, xc: { id: 'xc', requires: [r('xa', '^1.7.0')] } },
    states: { xa: 'active', xb: 'active', xc: 'active' },
    versions: { xa: '2.0.0', xb: '1.0.0', xc: '1.0.0' },
  });
  assert.equal(g.requirementsOf('xb')[0].label, 'version 2.0.0 — compatible avec ^1.0.0 requise');
  const old = createGraph({
    manifests: { xa: { id: 'xa' }, xc: { id: 'xc', requires: [r('xa', '^1.7.0')] } },
    states: { xa: 'active', xc: 'active' },
    versions: { xa: '1.6.0' },
  });
  assert.equal(old.requirementsOf('xc')[0].label, 'version 1.6.0 — 1.7 ou plus récente requise');
});

test('rule 59 (review): activating an inactive dependant whose requirement left its range is refused, card and endpoint', async () => {
  const a1 = h.manifest('xa', '1.0.0');
  const b1 = h.manifest('xb', '1.0.0', { requires: [r('xa')] });
  const a2 = h.manifest('xa', '2.0.0');
  const { ctrl, model, registryClient, host } = h.setup({ bundled: [a1, b1], regEntries: [reg(a2)], installed: [installed(a1), installed(b1)] });
  model.setEnabled('xb', false);
  await registryClient.refresh();
  assert.equal((await h.call(ctrl.update, { params: { id: 'xa' } })).statusCode, 202);
  host.state().updating = false;
  const card = (await h.call(ctrl.list, {})).body.find((p) => p.id === 'xb');
  assert.equal(card.actions.activate.allowed, false);
  assert.match(card.actions.activate.blockedBy, /^Nécessite .* compatible avec \^1\.0\.0 \(installé : 2\.0\.0\)\.$/);
  const res = await h.call(ctrl.activate, { params: { id: 'xb' }, body: {} });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'REQUIREMENT_OUT_OF_RANGE');
  assert.equal(model.get('xb').enabled, false);
});

test('rule 59 (review): the install plan says « compatible avec » to a requirement past the range', () => {
  const b1 = h.manifest('xb', '1.0.0', { requires: [r('xa')] });
  const { refusal } = requirementPlan(b1, { sources: [], env: {}, installed: { xa: '2.0.0' }, nameOf: (id) => id, allows: () => true });
  assert.equal(refusal.code, 'REQUIREMENT_TOO_OLD');
  assert.equal(refusal.message, 'Nécessite xa compatible avec ^1.0.0 (installé : 2.0.0).');
});

test('rule 59 (review): when every target is refused, update-all gives the refusal, not « Aucune mise à jour »', async () => {
  const a1 = h.manifest('xa', '1.0.0');
  const b1 = h.manifest('xb', '1.0.0');
  const a2 = h.manifest('xa', '1.1.0', { requires: [r('xb')] });
  const b2 = h.manifest('xb', '1.1.0', { requires: [r('xa')] });
  const { ctrl, registryClient } = h.setup({ bundled: [a1, b1], regEntries: [reg(a2), reg(b2)], installed: [installed(a1), installed(b1)] });
  await registryClient.refresh();
  const res = await h.call(ctrl.updateAll, {});
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'REQUIREMENT_CYCLE');
  assert.match(res.body.message, /^Dépendance circulaire/);
});

test('rule 59 (review): a refused rollback names the right remedy', async () => {
  const a1 = h.manifest('xa', '1.0.0');
  const b1 = h.manifest('xb', '1.0.0', { requires: [r('xa')] });
  const { ctrl, registryClient, host } = h.setup({
    bundled: [a1, b1], regEntries: [reg(h.manifest('xa', '1.1.0')), reg(h.manifest('xb', '1.1.0', { requires: [r('xa', '^1.1.0')] }))],
    installed: [installed(a1), installed(b1)],
  });
  await registryClient.refresh();
  await h.call(ctrl.update, { params: { id: 'xa' } }); host.state().updating = false;
  await h.call(ctrl.update, { params: { id: 'xb' } }); host.state().updating = false;
  const card = (await h.call(ctrl.list, {})).body.find((p) => p.id === 'xa');
  assert.match(card.rollback.refusal.message, /à remettre à sa version précédente ou à désactiver d’abord\.$/);
  assert.doesNotMatch(card.rollback.refusal.message, /mettre à jour/);
});
