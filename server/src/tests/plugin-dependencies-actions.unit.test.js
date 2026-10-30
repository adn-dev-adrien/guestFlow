// specs/plugin-dependencies.md rules 6–8 and 11–15 — what a plugin view tells about its dependencies
// (lines, statuses, refusals said before the click) and the cascades it offers: activate takes the
// requirements that are off, deactivate takes the active dependants, all or nothing; uninstall never.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./pluginPackagesFixture');
const { skipWithout } = require('../plugins/sdk/testing');
const { createController } = require('../controllers/pluginsController');
const { findPlugin } = require('../constants/plugins');

const WB = 'website-booking';
const GVR = 'google-vacation-rentals';
const PAY = 'online-payment';
const SAS = 'sas';
const WEATHER = 'weather-alerts';

// Those tests read the website-booking and google-vacation-rentals cards, which the catalogue only lists while the folders ship.
const SITE_AND_FEED = { skip: skipWithout([WB, GVR]) };

const nm = (id) => findPlugin(id).name;
const req = (range) => [{ id: WB, range }];
const site = (version = '1.8.3') => h.manifest(WB, version);
const feed = (version = '1.0.2') => h.manifest(GVR, version, { requires: req('^1.7.1') });
const row = (id, version, extra = {}) => ({ id, version, source: 'bundled', ...extra });

function release({ installed = [], bundled = [site(), feed()], regEntries = [] } = {}) {
  const ctx = h.setup({ bundled, installed, regEntries });
  const views = async () => Object.fromEntries((await h.call(ctx.ctrl.list)).body.map((v) => [v.id, v]));
  return { ...ctx, views };
}

const both = [row(WB, '1.8.3', { manifest: site() }), row(GVR, '1.0.2', { manifest: feed() })];

test('rule 6: the dependant lists what it needs, with the status and the French label of an unmet one', SITE_AND_FEED, async () => {
  const { views, model } = release({ installed: both });
  assert.deepEqual((await views())[GVR].dependencies.requires.map(({ id, status, label }) => ({ id, status, label })), [{ id: WB, status: 'ok', label: null }]);
  model.setEnabled(WB, false);
  const off = (await views())[GVR].dependencies.requires[0];
  assert.deepEqual([off.status, off.label, off.name], ['inactive', 'inactif', nm(WB)]);
});

test('rule 6: a requirement not installed reads « non installé » on an available plugin; the range is shown only when unmet', SITE_AND_FEED, async () => {
  const { views } = release();
  const line = (await views())[GVR].dependencies.requires[0];
  assert.deepEqual([line.status, line.label], ['missing', 'non installé']);
  assert.equal(line.range, '^1.7.1');
});

test('rule 6: a requirement below the range says the version it has, and points at its own update when there is one', async () => {
  const wb16 = h.manifest(WB, '1.6.0');
  const wb19 = h.manifest(WB, '1.9.0');
  const old = release({
    installed: [row(WB, '1.6.0', { manifest: wb16 }), row(GVR, '1.0.2', { manifest: feed() })],
    bundled: [wb16, feed()],
  });
  const noFix = (await old.views())[GVR].dependencies.requires[0];
  assert.equal(noFix.status, 'outOfRange');
  assert.equal(noFix.label, 'version 1.6.0 — 1.7.1 ou plus récente requise');
  assert.equal(noFix.updateAvailable, false);

  const pkg = h.makePackage(wb19);
  const fixable = release({
    installed: [row(WB, '1.6.0', { manifest: wb16 }), row(GVR, '1.0.2', { manifest: feed() })],
    bundled: [wb16, feed()],
    regEntries: [{ m: wb19, buf: pkg.buf }],
  });
  await fixable.registryClient.refresh();
  assert.equal((await fixable.views())[GVR].dependencies.requires[0].updateAvailable, true, 'rule 15');
});

test('rule 7: the requirement lists who uses it, an inactive dependant suffixed; an available plugin lists no one', SITE_AND_FEED, async () => {
  const { views, model } = release({ installed: both });
  assert.deepEqual((await views())[WB].dependencies.usedBy.map((u) => u.label), [nm(GVR)]);
  model.setEnabled(GVR, false);
  const used = (await views())[WB].dependencies.usedBy[0];
  assert.deepEqual([used.id, used.state, used.label], [GVR, 'inactive', `${nm(GVR)} (inactif)`]);
  const bare = release();
  assert.deepEqual((await bare.views())[WB].dependencies.usedBy, []);
});

test('rule 7: the graph reads the installed row’s manifest, not the catalogue’s', async () => {
  const changed = h.manifest(GVR, '1.0.3', { requires: [] });
  const { views } = release({ installed: [row(WB, '1.8.3', { manifest: site() }), row(GVR, '1.0.3', { manifest: changed })] });
  const all = await views();
  assert.deepEqual(all[GVR].dependencies.requires, []);
  assert.deepEqual(all[WB].dependencies.usedBy, []);
});

test('rule 7: an orphan installed plugin still appears in used-by under its stored name', async () => {
  const orphan = h.manifest('old-extra', '1.0.0', { name: 'Ancien extra', requires: req('^1.7.1') });
  const { views } = release({ installed: [row(WB, '1.8.3', { manifest: site() }), row('old-extra', '1.0.0', { manifest: orphan })] });
  assert.deepEqual((await views())[WB].dependencies.usedBy.map((u) => u.name), ['Ancien extra']);
});

test('rule 8: activate is allowed with the requirements it would switch on listed, and refused up front when one is not installed', SITE_AND_FEED, async () => {
  const { views, model } = release({ installed: both });
  model.setEnabled(GVR, false);
  model.setEnabled(WB, false);
  const a = (await views())[GVR].actions.activate;
  assert.deepEqual([a.allowed, a.blockedBy, a.alsoActivates.map((x) => x.id)], [true, null, [WB]]);
  model.uninstall(WB);
  const refused = (await views())[GVR].actions.activate;
  assert.equal(refused.allowed, false);
  assert.equal(refused.blockedBy, `Nécessite ${nm(WB)} : à installer d’abord.`);
});

test('rule 8: deactivate lists the active dependants it takes along; an inactive one is not listed', async () => {
  const { views, model } = release({ installed: both });
  const d = (await views())[WB].actions.deactivate;
  assert.deepEqual([d.allowed, d.blockedBy, d.alsoDeactivates.map((x) => x.id)], [true, null, [GVR]]);
  model.setEnabled(GVR, false);
  assert.deepEqual((await views())[WB].actions.deactivate.alsoDeactivates, []);
});

// specs/plugin-removal-resilience.md rule 18 — reaches online-payment's blocker through the controller, so it skips without it.
test('rule 8: deactivate is refused up front when a plugin it would take along has a business blocker', { skip: skipWithout([PAY]) }, async () => {
  const pay = h.manifest(PAY, '1.0.0', { requires: req('^1.7.1') });
  const { views, db } = release({ installed: [row(WB, '1.8.3', { manifest: site() }), row(PAY, '1.0.0', { manifest: pay })], bundled: [site(), pay] });
  db.prepare("INSERT INTO payment_links (status) VALUES ('open')").run();
  const all = await views();
  assert.equal(all[WB].actions.deactivate.allowed, false);
  assert.equal(all[WB].actions.deactivate.blockedBy, `${nm(PAY)} ne peut pas être désactivé : 1 lien de paiement en attente : à payer ou annuler d’abord.`);
  assert.equal(all[PAY].actions.deactivate.blockedBy, '1 lien de paiement en attente : à payer ou annuler d’abord.');
});

test('rule 8, 14: uninstall is refused up front while an installed plugin uses the plugin, even an inactive one', SITE_AND_FEED, async () => {
  const { views, model } = release({ installed: both });
  const all = await views();
  assert.deepEqual(all[WB].actions.uninstall, { allowed: false, blockedBy: `Utilisé par ${nm(GVR)} : à désinstaller d’abord.` });
  assert.equal(all[GVR].actions.uninstall.allowed, true);
  model.setEnabled(GVR, false);
  assert.equal((await views())[WB].actions.uninstall.allowed, false);
});

test('rule 8: an available plugin has nothing to activate, deactivate or uninstall', SITE_AND_FEED, async () => {
  const { views } = release();
  const { actions } = (await views())[GVR];
  assert.deepEqual([actions.activate.allowed, actions.deactivate.allowed, actions.uninstall.allowed], [false, false, false]);
  assert.equal(actions.uninstall.blockedBy, null);
});

test('rule 11: activate without the flag is still refused 409 REQUIREMENT_INACTIVE, now naming the plugins to switch on', async () => {
  const { ctrl, model } = release({ installed: both });
  model.setEnabled(GVR, false);
  model.setEnabled(WB, false);
  const res = await h.call(ctrl.activate, { params: { id: GVR } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'REQUIREMENT_INACTIVE');
  assert.deepEqual(res.body.requires, [WB]);
  assert.deepEqual(res.body.requirements.map((r) => r.id), [WB]);
  assert.equal(model.get(GVR).enabled, false);
});

test('rule 11: withRequirements switches the requirements on first, then the plugin', async () => {
  const { ctrl, model } = release({ installed: both });
  model.setEnabled(GVR, false);
  model.setEnabled(WB, false);
  const order = [];
  const real = model.setEnabled;
  model.setEnabled = (id, on) => { if (on) order.push(id); return real(id, on); };
  const res = await h.call(ctrl.activate, { params: { id: GVR }, body: { withRequirements: [WB] } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(order, [WB, GVR]);
  assert.equal(model.get(WB).enabled, true);
  assert.equal(model.get(GVR).enabled, true);
});

test('rule 11: the cascade is transitive and ordered, deepest requirement first', async () => {
  const sasChain = h.manifest(SAS, '1.7.2', { requires: req('^1.7.1') });
  const weather = h.manifest(WEATHER, '1.3.0', { requires: [{ id: SAS, range: '^1.7.0' }] });
  const order = [];
  const ctx = release({
    installed: [row(WB, '1.8.3', { manifest: site() }), row(SAS, '1.7.2', { manifest: sasChain }), row(WEATHER, '1.3.0', { manifest: weather })],
    bundled: [site(), sasChain, weather],
  });
  ['sas', WEATHER, WB].forEach((id) => ctx.model.setEnabled(id, false));
  const real = ctx.model.setEnabled;
  ctx.model.setEnabled = (id, on) => { if (on) order.push(id); return real(id, on); };
  const res = await h.call(ctx.ctrl.activate, { params: { id: WEATHER }, body: { withRequirements: [WB, SAS] } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(order, [WB, SAS, WEATHER]);
});

test('rule 11: a requirement not installed is never installed by « Activer », flag or not', async () => {
  const { ctrl, model } = release({ installed: [row(GVR, '1.0.2', { manifest: feed() })] });
  model.setEnabled(GVR, false);
  const res = await h.call(ctrl.activate, { params: { id: GVR }, body: { withRequirements: [WB] } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'REQUIREMENT_MISSING');
  assert.match(res.body.message, /^Nécessite .+ : à installer d’abord\.$/);
  assert.equal(model.get(WB), null);
  assert.equal(model.get(GVR).enabled, false);
});

test('rule 11: a requirement the licence does not allow stops the cascade and nothing moves', async () => {
  const ctx = h.setup({ bundled: [site(), feed()], installed: both });
  const ctrl = createController(ctx.model, {
    registry: h.registry, host: () => ctx.host, db: () => ctx.db, loader: () => ({ migrate() {}, markInactive() {}, runActivateHooks() {} }),
    licence: () => ({ allowsPlugin: (id) => id !== WB, planFor: () => null }), coreVersion: () => '3.9.0',
  });
  ctx.model.setEnabled(GVR, false);
  ctx.model.setEnabled(WB, false);
  const res = await h.call(ctrl.activate, { params: { id: GVR }, body: { withRequirements: [WB] } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'REQUIREMENT_OUT_OF_PLAN');
  assert.equal(ctx.model.get(WB).enabled, false);
});

test('rule 11: all or nothing — a migration that fails switches back what the cascade had switched on', async () => {
  const ctx = h.setup({ bundled: [site(), feed()], installed: both });
  const known = { get: (id) => ({ id, settings: [] }), isLive: () => true };
  const down = [];
  const ctrl = createController(ctx.model, {
    registry: known,
    host: () => ctx.host,
    db: () => ctx.db,
    loader: () => ({
      migrate: (db, id) => { if (id === GVR) throw new Error('boom'); },
      markInactive: (id) => down.push(id),
      runActivateHooks() {},
    }),
    licence: () => ({ allowsPlugin: () => true, planFor: () => null }),
    coreVersion: () => '3.9.0',
  });
  ctx.model.setEnabled(GVR, false);
  ctx.model.setEnabled(WB, false);
  const quiet = console.error;
  console.error = () => {};
  const res = await h.call(ctrl.activate, { params: { id: GVR }, body: { withRequirements: [WB] } });
  console.error = quiet;
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, 'PLUGIN_MIGRATION_FAILED');
  assert.equal(ctx.model.get(WB).enabled, false);
  assert.equal(ctx.model.get(GVR).enabled, false);
  assert.deepEqual(down, [WB]);
});

test('rule 12: deactivate without the flag is still refused 409 REQUIRED_BY, now with the dependants to take along', SITE_AND_FEED, async () => {
  const { ctrl, model } = release({ installed: both });
  const res = await h.call(ctrl.deactivate, { params: { id: WB } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'REQUIRED_BY');
  assert.deepEqual(res.body.requiredBy, [GVR]);
  assert.deepEqual(res.body.dependents, [{ id: GVR, name: nm(GVR) }]);
  assert.equal(model.get(WB).enabled, true);
});

test('rule 12: withDependents switches the active dependants off first, deepest first, then the plugin', async () => {
  const sasChain = h.manifest(SAS, '1.7.2', { requires: req('^1.7.1') });
  const weather = h.manifest(WEATHER, '1.3.0', { requires: [{ id: SAS, range: '^1.7.0' }] });
  const ctx = release({
    installed: [row(WB, '1.8.3', { manifest: site() }), row(SAS, '1.7.2', { manifest: sasChain }), row(WEATHER, '1.3.0', { manifest: weather })],
    bundled: [site(), sasChain, weather],
  });
  const order = [];
  const real = ctx.model.setEnabled;
  ctx.model.setEnabled = (id, on) => { if (!on) order.push(id); return real(id, on); };
  const res = await h.call(ctx.ctrl.deactivate, { params: { id: WB }, body: { withDependents: [SAS, WEATHER] } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(order, [WEATHER, SAS, WB]);
  assert.deepEqual([WB, SAS, WEATHER].map((id) => ctx.model.get(id).enabled), [false, false, false]);
});

// specs/plugin-removal-resilience.md rule 18
test('rule 12: all or nothing — a business blocker on a dependant refuses the whole cascade and names it', { skip: skipWithout([PAY]) }, async () => {
  const pay = h.manifest(PAY, '1.0.0', { requires: req('^1.7.1') });
  const ctx = release({ installed: [row(WB, '1.8.3', { manifest: site() }), row(GVR, '1.0.2', { manifest: feed() }), row(PAY, '1.0.0', { manifest: pay })], bundled: [site(), feed(), pay] });
  ctx.db.prepare("INSERT INTO payment_links (status) VALUES ('open'), ('open')").run();
  const res = await h.call(ctx.ctrl.deactivate, { params: { id: WB }, body: { withDependents: [GVR, PAY] } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'PLUGIN_BLOCKED');
  assert.equal(res.body.plugin, PAY);
  assert.match(res.body.message, /ne peut pas être désactivé : 2 liens de paiement en attente : à payer ou annuler d’abord\.$/);
  assert.deepEqual([WB, GVR, PAY].map((id) => ctx.model.get(id).enabled), [true, true, true]);
});

test('rule 12: the reconciler never passes the flag — its deactivation keeps the 409', async () => {
  const { ctrl, model } = release({ installed: both });
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  ctrl.deactivate({ params: { id: WB }, body: { withDependents: [GVR] }, query: {}, reconciling: true }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'REQUIRED_BY');
  assert.equal(model.get(GVR).enabled, true);
});

test('rule 12: a dependant out of plan is not live, so it neither blocks nor follows a switch-off', async () => {
  const ctx = h.setup({ bundled: [site(), feed()], installed: both });
  const ctrl = createController(ctx.model, {
    registry: h.registry, host: () => ctx.host, db: () => ctx.db, loader: () => ({ markInactive() {} }),
    licence: () => ({ allowsPlugin: (id) => id !== GVR, planFor: () => null }), coreVersion: () => '3.9.0',
  });
  const res = await h.call(ctrl.deactivate, { params: { id: WB } });
  assert.equal(res.statusCode, 200);
  assert.equal(ctx.model.get(GVR).enabled, true, 'left as it was');
});

test('rule 13: after a cascade the dependants stay off — activating the requirement again re-activates no one', async () => {
  const { ctrl, model } = release({ installed: both });
  await h.call(ctrl.deactivate, { params: { id: WB }, body: { withDependents: [GVR] } });
  assert.equal(model.get(GVR).enabled, false);
  const res = await h.call(ctrl.activate, { params: { id: WB } });
  assert.equal(res.statusCode, 200);
  assert.equal(model.get(WB).enabled, true);
  assert.equal(model.get(GVR).enabled, false);
});

test('rule 14: uninstall never cascades — refused while a plugin uses it, with or without a flag, and nothing is erased', async () => {
  const { ctrl, model } = release({ installed: both });
  for (const body of [{}, { withDependents: true }]) {
    const res = await h.call(ctrl.uninstall, { params: { id: WB }, body });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, 'REQUIRED_BY');
    assert.match(res.body.message, /à désinstaller d’abord\.$/);
  }
  assert.ok(model.get(WB) && model.get(GVR));
  assert.equal((await h.call(ctrl.uninstall, { params: { id: GVR } })).statusCode, 200);
  assert.equal((await h.call(ctrl.uninstall, { params: { id: WB } })).statusCode, 200);
});

test('rule 15: an installed requirement below the range is refused with its version, pointing at the fix', SITE_AND_FEED, async () => {
  const wb16 = h.manifest(WB, '1.6.0');
  const { ctrl } = release({ installed: [row(WB, '1.6.0', { manifest: wb16 })], bundled: [wb16, feed()] });
  const res = await h.call(ctrl.install, { params: { id: GVR } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'REQUIREMENT_TOO_OLD');
  assert.equal(res.body.message, `Nécessite ${nm(WB)} 1.7.1 ou plus récent (installé : 1.6.0).`);
});

test('rule 8: the confirmation texts come from the server — activate, deactivate with and without followers', SITE_AND_FEED, async () => {
  const { views, model } = release({ installed: both });
  const all = await views();
  assert.deepEqual(all[WB].actions.deactivate.confirm, {
    title: `Désactiver ${nm(WB)} ?`,
    message: `Désactive aussi : ${nm(GVR)}. Réglages et données gardés. À réactiver ensuite un par un.`,
    label: 'Tout désactiver',
  });
  assert.equal(all[GVR].actions.deactivate.confirm.label, 'Désactiver');
  assert.match(all[GVR].actions.deactivate.confirm.message, /^Ce qu’il ajoute s’arrête\./);
  model.setEnabled(GVR, false);
  model.setEnabled(WB, false);
  assert.deepEqual((await views())[GVR].actions.activate.confirm, { title: `Activer ${nm(GVR)}`, message: `Active aussi : ${nm(WB)}.`, label: 'Tout activer' });
  assert.equal((await views())[WB].actions.activate.confirm, null, 'nothing to take along, the usual button');
});

test('rule 9: the offer carries the install confirmation, lines in order', SITE_AND_FEED, async () => {
  const { views } = release();
  assert.deepEqual((await views())[GVR].offer.confirm, { title: `Installer ${nm(GVR)}`, message: 'Installe aussi Plugin website-booking 1.8.3.'.replace('Plugin website-booking', nm(WB)), label: 'Tout installer' });
});

test('rule 11: out of plan is said before « à activer d’abord », flag or not', async () => {
  const ctx = h.setup({ bundled: [site(), feed()], installed: both });
  const ctrl = createController(ctx.model, {
    registry: h.registry, host: () => ctx.host, db: () => ctx.db, loader: () => ({ migrate() {}, markInactive() {}, runActivateHooks() {} }),
    licence: () => ({ allowsPlugin: (id) => id !== WB, planFor: () => null }), coreVersion: () => '3.9.0',
  });
  ctx.model.setEnabled(GVR, false);
  ctx.model.setEnabled(WB, false);
  const res = await h.call(ctrl.activate, { params: { id: GVR } });
  assert.equal(res.body.error, 'REQUIREMENT_OUT_OF_PLAN');
});
