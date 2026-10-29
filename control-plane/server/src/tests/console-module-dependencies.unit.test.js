// specs/plugin-dependencies.md rules 17–19 — the console reads the space's graph: « Nécessite » and
// « Utilisé par » under each module, switches that take the linked modules along (one journal line per
// module, one licence), and a plan or option that allows a plugin without its requirement is refused.
const test = require('node:test');
const assert = require('node:assert/strict');
const { customerWithSpace, lineOf, writtenAt, licenceOf } = require('./moduleFixture');
const { NEW_CUSTOMER, makeContext } = require('./helpers');
const { plugins: gfPlugins } = require('../utils/gf');

const name = (id) => gfPlugins.findPlugin(id).name;
const WB = 'website-booking';
const GVR = 'google-vacation-rentals';
const moduleLines = (env) => env.ctx.models.audit.forCustomer(env.id).filter((a) => a.kind === 'module').map((a) => a.text);

// Essentiel carries the SAS and the weather plugin (which requires it); Premium carries the website,
// and the feed is grandfathered the way the existing module suites do.
async function essentiel() {
  const env = await customerWithSpace({ planCode: 'essentiel' });
  assert.deepEqual(lineOf(env.ctx.controllers.modules.view(env.id), 'weather-alerts').requires.map((r) => r.id), ['sas']);
  return env;
}
async function premiumWithFeed() {
  const env = await customerWithSpace({ planCode: 'premium' });
  env.ctx.models.customers.addGrandfathered(env.id, GVR, '2026-09-29');
  env.ctx.controllers.modules.toggle(env.id, GVR, true, 'op');
  return env;
}

test('rule 17: a line says what it requires, with the status in the switch’s words, and who uses it', async () => {
  const env = await essentiel();
  const { modules } = env.ctx.controllers;
  let view = modules.view(env.id);
  assert.deepEqual(lineOf(view, 'weather-alerts').requires, [{ id: 'sas', name: name('sas'), status: 'ok', label: null }]);
  assert.deepEqual(lineOf(view, 'sas').usedBy, [{ id: 'weather-alerts', name: name('weather-alerts'), state: 'active', label: name('weather-alerts') }]);
  modules.toggle(env.id, 'weather-alerts', false, 'op');
  modules.toggle(env.id, 'sas', false, 'op');
  view = modules.view(env.id);
  assert.deepEqual(lineOf(view, 'weather-alerts').requires.map(({ status, label }) => [status, label]), [['inactive', 'éteint']]);
  assert.equal(lineOf(view, 'sas').usedBy[0].label, `${name('weather-alerts')} (éteint)`);
  assert.deepEqual(lineOf(view, 'linen').requires, []);
  env.cleanup();
});

test('rule 17: a line lists the modules a switch would take along, so the confirmation is the server’s', async () => {
  const env = await essentiel();
  const { modules } = env.ctx.controllers;
  assert.deepEqual(lineOf(modules.view(env.id), 'sas').alsoOff, [{ id: 'weather-alerts', name: name('weather-alerts') }]);
  assert.deepEqual(lineOf(modules.view(env.id), 'sas').alsoOn, []);
  modules.toggle(env.id, 'weather-alerts', false, 'op');
  modules.toggle(env.id, 'sas', false, 'op');
  assert.deepEqual(lineOf(modules.view(env.id), 'weather-alerts').alsoOn, [{ id: 'sas', name: name('sas') }]);
  env.cleanup();
});

test('rule 18: without the flag the 422s of the switch stay as they were', async () => {
  const env = await essentiel();
  const { modules } = env.ctx.controllers;
  assert.throws(() => modules.toggle(env.id, 'sas', false, 'op'), (e) => e.status === 422 && e.body.error === 'REQUIRED_BY'
    && e.body.message === `Nécessaire à ${name('weather-alerts')} : à désactiver d’abord.`);
  modules.toggle(env.id, 'weather-alerts', false, 'op');
  modules.toggle(env.id, 'sas', false, 'op');
  assert.throws(() => modules.toggle(env.id, 'weather-alerts', true, 'op'), (e) => e.status === 422 && e.body.error === 'REQUIREMENT_OFF'
    && e.body.message === `Nécessite ${name('sas')} : à activer d’abord.`);
  env.cleanup();
});

test('rule 18: switching on with withRequirements switches the requirement on first, one journal line each, one licence', async () => {
  const env = await essentiel();
  const { modules } = env.ctx.controllers;
  modules.toggle(env.id, 'weather-alerts', false, 'op');
  modules.toggle(env.id, 'sas', false, 'op');
  const before = moduleLines(env).length;
  env.now.set('2026-09-29T11:00:00Z');
  const view = modules.toggle(env.id, 'weather-alerts', true, 'adrien@adn-dev.fr', { withRequirements: ['sas'] });
  assert.equal(lineOf(view, 'sas').on && lineOf(view, 'weather-alerts').on, true);
  const added = moduleLines(env).slice(0, moduleLines(env).length - before);
  assert.deepEqual(added.sort(), [`${name('weather-alerts')} activé`, `${name('sas')} activé`].sort());
  const licence = licenceOf(env);
  assert.ok(licence.activePlugins.includes('sas') && licence.activePlugins.includes('weather-alerts'));
  assert.equal(writtenAt(env), licence.issuedAt, 'a single licence carries both');
  env.cleanup();
});

test('rule 18: switching off with withDependents switches the dependants off first, then the module', async () => {
  const env = await essentiel();
  const { modules } = env.ctx.controllers;
  const before = moduleLines(env).length;
  const view = modules.toggle(env.id, 'sas', false, 'op', { withDependents: ['weather-alerts'] });
  assert.equal(lineOf(view, 'sas').on || lineOf(view, 'weather-alerts').on, false);
  const lines = moduleLines(env);
  assert.equal(lines.length - before, 2);
  assert.ok(lines.includes(`${name('weather-alerts')} désactivé`) && lines.includes(`${name('sas')} désactivé`));
  assert.deepEqual(licenceOf(env).activePlugins.filter((id) => id === 'sas' || id === 'weather-alerts'), []);
  env.cleanup();
});

test('rule 18: a flag changes nothing when there is nothing to take along', async () => {
  const env = await essentiel();
  const { modules } = env.ctx.controllers;
  const view = modules.toggle(env.id, 'school-holidays', false, 'op', { withDependents: ['x'], withRequirements: ['y'] });
  assert.equal(lineOf(view, 'school-holidays').on, false);
  assert.equal(moduleLines(env).filter((t) => t.endsWith('désactivé')).length, 1);
  env.cleanup();
});

test('rule 19: a plan matrix click that leaves a plan with a plugin and not its requirement is refused', async () => {
  const ctx = makeContext().ctx;
  const { catalogue } = ctx.controllers;
  const { lowest } = catalogue.view();
  const refused = (fn) => assert.throws(fn, (e) => e.status === 422 && e.body.error === 'REQUIREMENT_NOT_IN_PLAN'
    && e.body.message === `${name(GVR)} nécessite ${name(WB)} : à inclure aussi.`);
  refused(() => catalogue.toggle({ lowest, pluginId: GVR, planCode: 'essentiel' }));
  const ok = catalogue.toggle({ lowest, pluginId: GVR, planCode: 'pro' });
  assert.equal(ok.lowest[GVR], 'pro');
  refused(() => catalogue.toggle({ lowest: ok.lowest, pluginId: WB, planCode: 'pro' }));
});

test('rule 19: saving a catalogue where a plan allows a plugin without its requirement is refused, nothing is written', async () => {
  const ctx = makeContext().ctx;
  const { catalogue } = ctx.controllers;
  const { lowest } = catalogue.view();
  assert.throws(
    () => catalogue.save({ lowest: { ...lowest, [GVR]: 'essentiel' }, reason: 'Flux Google dans Essentiel' }, 'op'),
    (e) => e.status === 422 && e.body.error === 'REQUIREMENT_NOT_IN_PLAN',
  );
  assert.equal(catalogue.view().version, 1);
  const saved = catalogue.save({ lowest: { ...lowest, [GVR]: 'pro' }, reason: 'Flux Google en Pro' }, 'op');
  assert.equal(saved.version, 2);
});

test('rule 19: an option that brings a plugin without its requirement is refused at creation and on a plan change', async () => {
  const env = makeContext();
  env.ctx.db.prepare('INSERT INTO addons (pluginId, priceMonthlyCents) VALUES (?, ?)').run(GVR, 900);
  const { customers } = env.ctx.controllers;
  await assert.rejects(
    customers.create({ ...NEW_CUSTOMER, planCode: 'essentiel', addons: [GVR] }, 'op'),
    (e) => e.body.errors.addons === `${name(GVR)} nécessite ${name(WB)} : à inclure aussi.`,
  );
  const created = await customers.create({ ...NEW_CUSTOMER, planCode: 'pro', addons: [] }, 'op');
  assert.throws(
    () => customers.changePlan(created.id, { planCode: 'essentiel', billing: 'monthly', addons: [GVR] }, 'op'),
    (e) => e.status === 422 && e.body.error === 'REQUIREMENT_NOT_IN_PLAN',
  );
});

test('rule 19: a plan change that takes a requirement away drops its chosen dependant with it, one audit line each', async () => {
  const env = await customerWithSpace({ planCode: 'premium' });
  env.ctx.db.prepare('INSERT INTO addons (pluginId, priceMonthlyCents) VALUES (?, ?)').run(GVR, 900);
  const { modules } = env.ctx.controllers;
  const { customers } = env.ctx.models;
  // The option stays with the customer while the plan loses the website (a catalogue change, not a console form).
  customers.changePlan({
    id: env.id, planCode: 'premium', billing: 'monthly', periodMonths: 1, catalogueVersion: 1, addons: [GVR], since: '2026-10-01',
  });
  modules.toggle(env.id, GVR, true, 'op');
  assert.ok(licenceOf(env).activePlugins.includes(GVR));
  env.ctx.db.prepare('DELETE FROM plan_plugins WHERE pluginId = ?').run(WB);
  const dropped = modules.dropNotAllowed(env.id, 'op');
  assert.deepEqual(dropped.sort(), [GVR, WB].sort());
  const texts = env.ctx.models.audit.forCustomer(env.id).map((a) => a.text);
  assert.ok(texts.includes(`${name(WB)} retiré (hors forfait)`));
  assert.ok(texts.includes(`${name(GVR)} retiré (nécessite ${name(WB)})`));
  assert.equal(env.ctx.models.customerPlugins.chosen(env.id).includes(GVR), false);
  env.cleanup();
});

test('rule 18: the flags travel in the body of the switch route, and only a literal true counts', async () => {
  const session = require('express-session');
  const { passwordHash } = require('../utils/gf');
  const { createApp } = require('../app');
  const env = await essentiel();
  env.ctx.models.operators.create({ email: 'adrien@adn-dev.fr', name: 'Adrien', passwordHash: passwordHash.hashPassword('correct horse battery') });
  const app = createApp(env.ctx, { sessionSecret: 'test', sessionStore: new session.MemoryStore() });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  let cookie = '';
  const call = async (url, body) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
  try {
    await call('/api/auth/login', { email: 'adrien@adn-dev.fr', password: 'correct horse battery' });
    const code = /Votre code : (\d{6})/.exec(env.mailer.sent[env.mailer.sent.length - 1].text)[1];
    await call('/api/auth/verify', { code });
    const url = `/api/customers/${env.id}/modules/sas`;
    assert.equal((await call(url, { on: false, withDependents: 'true' })).status, 422);
    const done = await call(url, { on: false, withDependents: ['weather-alerts'] });
    assert.equal(done.status, 200);
    assert.equal(lineOf(done.body, 'weather-alerts').on, false);
  } finally {
    await new Promise((r) => server.close(r));
    env.cleanup();
  }
});

test('rule 19: a plan change leaves a legacy incoherent choice alone — only what lost its requirement in THIS change follows it', async () => {
  const env = await essentiel();
  const { modules } = env.ctx.controllers;
  // Legacy: the weather module runs while the SAS is off (a space seeded from what it ran).
  env.ctx.models.customerPlugins.remove(env.id, 'sas');
  assert.equal(env.ctx.models.customerPlugins.chosen(env.id).includes('weather-alerts'), true);
  const dropped = modules.dropNotAllowed(env.id, 'op');
  assert.deepEqual(dropped, []);
  assert.equal(env.ctx.models.customerPlugins.chosen(env.id).includes('weather-alerts'), true, 'still switched on');
  assert.deepEqual(lineOf(modules.view(env.id), 'weather-alerts').requires.map((r) => r.label), ['éteint']);
  env.cleanup();
});

test('rule 18: the line carries the server’s confirmation texts, for a switch that follows and for one that does not', async () => {
  const env = await essentiel();
  const { modules } = env.ctx.controllers;
  assert.deepEqual(lineOf(modules.view(env.id), 'sas').confirm, {
    title: `Désactiver ${name('sas')} ?`,
    message: `Désactive aussi : ${name('weather-alerts')}. Ses pages disparaissent de l’espace ; ses données sont conservées.`,
    label: 'Tout désactiver',
  });
  assert.equal(lineOf(modules.view(env.id), 'school-holidays').confirm.label, 'Désactiver');
  modules.toggle(env.id, 'weather-alerts', false, 'op');
  modules.toggle(env.id, 'sas', false, 'op');
  assert.deepEqual(lineOf(modules.view(env.id), 'weather-alerts').confirm, { title: `Activer ${name('weather-alerts')} ?`, message: `Active aussi : ${name('sas')}.`, label: 'Tout activer' });
  assert.equal(lineOf(modules.view(env.id), 'school-holidays').confirm.label, 'Désactiver');
  env.cleanup();
});

test('rule 19: a requirement the plan does not license is never offered in « Active aussi » — the line says why before the click', async () => {
  const env = await essentiel();
  const { modules } = env.ctx.controllers;
  modules.toggle(env.id, 'weather-alerts', false, 'op');
  modules.toggle(env.id, 'sas', false, 'op');
  env.ctx.db.prepare("DELETE FROM plan_plugins WHERE pluginId = 'sas'").run();
  const line = lineOf(modules.view(env.id), 'weather-alerts');
  assert.deepEqual(line.alsoOn, []);
  assert.equal(line.confirm, null);
  assert.equal(line.switchBlockedBy, `Nécessite ${name('sas')}, hors forfait.`);
  assert.throws(() => modules.toggle(env.id, 'weather-alerts', true, 'op', { withRequirements: ['sas'] }), (e) => e.status === 422);
  env.cleanup();
});

test('rule 22: the confirmed ids must be the closure now — a different list, or a bare flag, takes nobody along', async () => {
  const env = await essentiel();
  const { modules } = env.ctx.controllers;
  for (const given of [['sas', 'school-holidays'], [], true, 'sas']) {
    assert.throws(() => modules.toggle(env.id, 'sas', false, 'op', { withDependents: given }), (e) => e.status === 422 && /weather-alerts|Nécessaire|La liste a changé/.test(e.message), JSON.stringify(given));
  }
  assert.throws(() => modules.toggle(env.id, 'sas', false, 'op', { withDependents: ['school-holidays'] }), (e) => e.status === 422 && e.body.error === 'CONFIRMATION_STALE');
  assert.equal(moduleLines(env).filter((t) => t.endsWith('désactivé')).length, 0);
  env.cleanup();
});
