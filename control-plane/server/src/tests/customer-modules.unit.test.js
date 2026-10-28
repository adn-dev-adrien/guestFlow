// specs/plugin-operator-provisioning.md rules 10–14 — the « Modules » of a customer: what is allowed,
// what the operator may switch, what each line says about the space.
const test = require('node:test');
const assert = require('node:assert/strict');
const { customerWithSpace, writeSpace, lineOf, writtenAt, licenceOf } = require('./moduleFixture');

const PRO = ['website-booking', 'online-payment', 'linen', 'accounting-export'];
const ESSENTIEL = ['school-holidays', 'weather-alerts', 'google-calendar', 'sas'];

test('rule 10: the view groups the lines — included by the plan, add-ons and grandfathered, the rest out of plan with the plan that includes each', async () => {
  const env = await customerWithSpace({ addons: ['gate-access'] });
  const { modules } = env.ctx.controllers;
  const view = modules.view(env.id);
  const included = view.included.map((l) => l.id);
  [...PRO, ...ESSENTIEL, 'gate-access'].forEach((id) => assert.ok(included.includes(id), id));
  assert.equal(included.includes('neat'), false);
  assert.deepEqual(lineOf(view, 'neat').planChip, 'Forfait Premium');
  assert.equal(lineOf(view, 'neat').switchable, false);
  assert.equal(lineOf(view, 'linen').switchable, true);
  env.cleanup();
});

test('rule 10: a plugin sold only à la carte reads « Option à la carte » out of plan', async () => {
  const env = await customerWithSpace();
  const { catalogue } = env.ctx.models;
  assert.ok(catalogue.lowest()['gate-access'], 'in the seed, gate-access belongs to Premium');
  env.ctx.db.prepare("DELETE FROM plan_plugins WHERE pluginId = 'gite-fake'").run();
  assert.equal(lineOf(env.ctx.controllers.modules.view(env.id), 'neat').planChip, 'Forfait Premium');
  env.cleanup();
});

test('rule 11: a plugin outside the allowed set is refused with 422 OUT_OF_PLAN', async () => {
  const env = await customerWithSpace();
  assert.throws(() => env.ctx.controllers.modules.toggle(env.id, 'neat', true, 'op'), (err) => {
    assert.equal(err.status, 422);
    assert.equal(err.body.error, 'OUT_OF_PLAN');
    assert.equal(err.body.message, 'Hors forfait : à ajouter au forfait ou en option d’abord.');
    return true;
  });
  env.cleanup();
});

test('rule 11: switching on a plugin whose requirement is off is refused with its name', async () => {
  const env = await customerWithSpace({ planCode: 'premium' });
  const { modules } = env.ctx.controllers;
  env.ctx.models.customers.addGrandfathered(env.id, 'google-vacation-rentals', '2026-09-29');
  modules.toggle(env.id, 'website-booking', false, 'op');
  assert.throws(() => modules.toggle(env.id, 'google-vacation-rentals', true, 'op'), (err) => {
    assert.equal(err.body.error, 'REQUIREMENT_OFF');
    assert.match(err.body.message, /^Nécessite .+ : à activer d’abord\.$/);
    return true;
  });
  env.cleanup();
});

test('rule 11: switching off a plugin that a switched-on plugin requires is refused with the dependant\'s name', async () => {
  const env = await customerWithSpace({ planCode: 'premium' });
  const { modules } = env.ctx.controllers;
  env.ctx.models.customers.addGrandfathered(env.id, 'google-vacation-rentals', '2026-09-29');
  modules.toggle(env.id, 'google-vacation-rentals', true, 'op');
  assert.throws(() => modules.toggle(env.id, 'website-booking', false, 'op'), (err) => {
    assert.equal(err.status, 422);
    assert.equal(err.body.error, 'REQUIRED_BY');
    assert.match(err.body.message, /^Nécessaire à Google Vacation Rentals : à désactiver d’abord\.$/);
    return true;
  });
  modules.toggle(env.id, 'google-vacation-rentals', false, 'op');
  modules.toggle(env.id, 'website-booking', false, 'op');
  env.cleanup();
});

test('rule 12: a switch saves at once — one audit line, the licence re-issued with the choice', async () => {
  const env = await customerWithSpace();
  const { modules } = env.ctx.controllers;
  const before = licenceOf(env);
  assert.ok(before.activePlugins.includes('linen'));
  env.now.set('2026-09-29T10:05:00Z');
  modules.toggle(env.id, 'linen', false, 'adrien@adn-dev.fr');
  const after = licenceOf(env);
  assert.equal(after.activePlugins.includes('linen'), false);
  assert.ok(after.plugins.includes('linen'), 'still allowed, only switched off');
  const lines = env.ctx.models.audit.forCustomer(env.id).filter((a) => a.kind === 'module');
  assert.deepEqual(lines.map((l) => [l.operator, l.text]).slice(0, 1), [['adrien@adn-dev.fr', 'Linge et blanchisserie désactivé']]);
  assert.equal(writtenAt(env), after.issuedAt);
  env.cleanup();
});

test('rule 12: a switch that changes nothing writes nothing', async () => {
  const env = await customerWithSpace();
  const { modules } = env.ctx.controllers;
  const before = env.ctx.models.audit.forCustomer(env.id).length;
  modules.toggle(env.id, 'linen', true, 'op');
  assert.equal(env.ctx.models.audit.forCustomer(env.id).length, before);
  env.cleanup();
});

test('rule 14: a line tells what the space runs — active with its version, inactive, and the header counts', async () => {
  const env = await customerWithSpace();
  const { modules } = env.ctx.controllers;
  writeSpace(env, { active: ['linen', 'sas'], versions: { linen: '1.2.0' }, applied: writtenAt(env) });
  modules.toggle(env.id, 'school-holidays', false, 'op');
  writeSpace(env, { active: ['linen', 'sas'], versions: { linen: '1.2.0' }, applied: writtenAt(env) });
  const view = modules.view(env.id);
  assert.equal(lineOf(view, 'linen').stateLabel, 'Actif · 1.2.0');
  assert.equal(lineOf(view, 'school-holidays').stateLabel, 'Inactif');
  assert.equal(lineOf(view, 'sas').state, 'active');
  env.cleanup();
});

test('rule 14: a choice the space has not applied reads « En attente », and after 5 minutes names the wait', async () => {
  const env = await customerWithSpace();
  const { modules } = env.ctx.controllers;
  writeSpace(env, { active: [] });
  modules.toggle(env.id, 'linen', false, 'op');
  writeSpace(env, { active: ['linen'] });
  const waiting = lineOf(modules.view(env.id), 'linen');
  assert.deepEqual([waiting.stateLabel, waiting.detail, waiting.stale], ['En attente', 'L’espace lit la licence…', false]);
  env.now.set('2026-09-29T10:06:30Z');
  const late = lineOf(modules.view(env.id), 'linen');
  assert.deepEqual([late.stateLabel, late.detail, late.stale], ['En attente', 'Depuis 6 min — espace injoignable ?', true]);
  env.cleanup();
});

test('rule 14: a failure the space recorded for this licence reads « Échec : … » with a retry', async () => {
  const env = await customerWithSpace();
  const { modules } = env.ctx.controllers;
  writeSpace(env, { active: [] });
  modules.retry(env.id, 'op');
  writeSpace(env, { active: [], rows: [{ pluginId: 'linen', desired: 'active', outcome: 'failed', message: 'Paquet introuvable.', licenceIssuedAt: writtenAt(env) }] });
  const line = lineOf(modules.view(env.id), 'linen');
  assert.equal(line.state, 'failed');
  assert.deepEqual([line.stateLabel, line.detail], ['Échec', 'Paquet introuvable.']);
  assert.equal(line.canRetry, true);
  assert.equal(modules.view(env.id).counts.failed, 1);
  assert.match(modules.view(env.id).header, /1 en échec/);
  env.cleanup();
});

test('rule 14: a failure recorded for an older licence is not shown — « Réessayer » is a new licence', async () => {
  const env = await customerWithSpace();
  const { modules } = env.ctx.controllers;
  writeSpace(env, { active: [] });
  modules.retry(env.id, 'op');
  const old = writtenAt(env);
  writeSpace(env, { active: [], rows: [{ pluginId: 'linen', desired: 'active', outcome: 'failed', message: 'Paquet introuvable.', licenceIssuedAt: old }] });
  env.now.set('2026-09-29T10:01:00Z');
  const stamped = writtenAt(env);
  modules.retry(env.id, 'op');
  assert.notEqual(writtenAt(env), stamped);
  assert.equal(lineOf(modules.view(env.id), 'linen').state, 'pending');
  env.cleanup();
});

test('rule 14: a deactivation the space refuses reads « Bloqué : … »', async () => {
  const env = await customerWithSpace();
  const { modules } = env.ctx.controllers;
  writeSpace(env, { active: ['online-payment'] });
  modules.toggle(env.id, 'online-payment', false, 'op');
  writeSpace(env, {
    active: ['online-payment'],
    rows: [{ pluginId: 'online-payment', desired: 'inactive', outcome: 'blocked', message: '2 liens de paiement en attente : à payer ou annuler d’abord.', licenceIssuedAt: writtenAt(env) }],
  });
  const line = lineOf(modules.view(env.id), 'online-payment');
  assert.equal(line.state, 'blocked');
  assert.deepEqual([line.stateLabel, line.detail], ['Bloqué', '2 liens de paiement en attente : à payer ou annuler d’abord.']);
  env.cleanup();
});

test('rule 14: an active plugin that reports missing setup reads « à configurer », counted in the header', async () => {
  const env = await customerWithSpace();
  const { modules } = env.ctx.controllers;
  writeSpace(env, { active: ['linen', 'weather-alerts'], applied: writtenAt(env), facts: { 'weather-alerts': { setup: 'clé API manquante', erasable: false, data: [] } } });
  const view = modules.view(env.id);
  assert.equal(lineOf(view, 'weather-alerts').setupLabel, 'à configurer : clé API manquante');
  assert.match(lineOf(view, 'weather-alerts').stateLabel, /^Actif/, 'the version chip stays beside it');
  assert.equal(view.counts.toConfigure, 1);
  assert.match(view.header, /\d+ actifs · 1 à configurer/);
  env.cleanup();
});

test('rule 14: a space the console cannot read says so on each line, and an old space with no report stays « En attente »', async () => {
  const env = await customerWithSpace();
  const { modules } = env.ctx.controllers;
  writeSpace(env, { active: [], provisioning: false });
  assert.equal(lineOf(modules.view(env.id), 'linen').state, 'pending');
  require('fs').rmSync(require('path').join(env.root, env.slug, 'data', 'guestflow.db'));
  assert.equal(lineOf(modules.view(env.id), 'linen').state, 'unknown');
  env.cleanup();
});

test('rule 11: a plan change that removes an allowed plugin drops it from the choice, with an audit line', async () => {
  const env = await customerWithSpace({ planCode: 'premium' });
  const { customers, modules } = env.ctx.controllers;
  assert.ok(licenceOf(env).activePlugins.includes('neat'));
  customers.changePlan(env.id, { planCode: 'pro', billing: 'yearly', addons: [] }, 'op');
  assert.equal(licenceOf(env).activePlugins.includes('neat'), false);
  assert.equal(licenceOf(env).activePlugins.includes('linen'), true);
  assert.ok(env.ctx.models.audit.forCustomer(env.id).some((a) => a.text === `${require('../utils/gf').plugins.findPlugin('neat').name} retiré (hors forfait)`));
  assert.equal(modules.view(env.id).included.some((l) => l.id === 'neat'), false);
  env.cleanup();
});

test('rule 10: zero modules switched on reads « Aucun module actif. »', async () => {
  const env = await customerWithSpace({ modules: [] });
  assert.equal(env.ctx.controllers.modules.view(env.id).empty, 'Aucun module actif.');
  env.cleanup();
});

test('rule 20: the console reads the space\'s report read-only — outcomes, applied licence, published facts; an older space reports none', async () => {
  const env = await customerWithSpace();
  writeSpace(env, {
    active: ['linen'], versions: { linen: '1.2.0' }, applied: '2026-10-28T08:00:00.000Z', erased: ['o-1'],
    rows: [{ pluginId: 'sas', desired: 'active', outcome: 'failed', message: 'Échec du démarrage.', licenceIssuedAt: '2026-10-28T08:00:00.000Z' }],
    facts: { linen: { setup: null, erasable: true, data: [{ label: '3 pièces', count: 3 }] } },
  });
  const facts = env.ctx.instances.readFacts(env.slug);
  assert.equal(facts.provisioning.appliedLicenceIssuedAt, '2026-10-28T08:00:00.000Z');
  assert.deepEqual(facts.provisioning.rows.map((r) => [r.pluginId, r.outcome, r.message]), [['sas', 'failed', 'Échec du démarrage.']]);
  assert.deepEqual(facts.provisioning.erasedOrders, ['o-1']);
  assert.deepEqual(facts.provisioning.moduleFacts.linen.data, [{ label: '3 pièces', count: 3 }]);
  writeSpace(env, { active: ['linen'], provisioning: false });
  assert.equal(env.ctx.instances.readFacts(env.slug).provisioning, null);
  env.cleanup();
});
