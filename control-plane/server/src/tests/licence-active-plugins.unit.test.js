// specs/plugin-operator-provisioning.md rules 13, 15, 25 — the licence carries the operator's choice
// (and only once it is seeded), a new customer starts with the modules ticked in the form, and an
// existing customer is seeded from what its space runs before any licence carries activePlugins.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { customerWithSpace, writeSpace, lineOf, licenceOf } = require('./moduleFixture');
const { NEW_CUSTOMER } = require('./helpers');
const { createScheduler } = require('../tasks/scheduler');

async function existingCustomer(opts) {
  const env = await customerWithSpace(opts);
  env.ctx.db.prepare('DELETE FROM customer_plugins WHERE customerId = ?').run(env.id);
  env.ctx.db.prepare('UPDATE customers SET pluginsSeededAt = NULL WHERE id = ?').run(env.id);
  env.ctx.controllers.customers.issueLicence(env.id);
  return env;
}

test('rule 15: the licence carries activePlugins ⊆ plugins, in catalogue order, and an empty eraseOrders', async () => {
  const env = await customerWithSpace();
  const lic = licenceOf(env);
  assert.deepEqual(lic.eraseOrders, []);
  assert.ok(lic.activePlugins.length > 0);
  lic.activePlugins.forEach((id) => assert.ok(lic.plugins.includes(id), id));
  assert.deepEqual(lic.activePlugins, lic.plugins.filter((id) => lic.activePlugins.includes(id)));
  env.cleanup();
});

test('rule 15, 25: a customer not seeded yet gets a licence with no activePlugins — nothing is switched by surprise', async () => {
  const env = await existingCustomer();
  const lic = licenceOf(env);
  assert.equal('activePlugins' in lic, false);
  assert.equal('eraseOrders' in lic, false);
  assert.ok(lic.plugins.length > 0);
  env.cleanup();
});

test('rule 25: seeding takes what the space runs, within what is allowed, and only then does the licence carry it', async () => {
  const env = await existingCustomer();
  writeSpace(env, { active: ['linen', 'neat', 'sas'], inactive: ['online-payment'] });
  assert.equal(env.ctx.controllers.modules.seedPending(), 1);
  assert.deepEqual(env.ctx.models.customerPlugins.chosen(env.id).sort(), ['linen', 'sas']);
  assert.deepEqual(licenceOf(env).activePlugins, ['linen', 'sas']);
  const row = env.ctx.db.prepare('SELECT operator FROM customer_plugins WHERE customerId = ? AND pluginId = ?').get(env.id, 'linen');
  assert.equal(row.operator, 'migration');
  assert.equal(env.ctx.controllers.modules.seedPending(), 0, 'seeded once');
  env.cleanup();
});

test('rule 25: a space the console cannot read stays unseeded, says so, and refuses a switch', async () => {
  const env = await existingCustomer();
  fs.rmSync(path.join(env.root, env.slug, 'data', 'guestflow.db'));
  assert.equal(env.ctx.controllers.modules.seedPending(), 0);
  assert.equal('activePlugins' in licenceOf(env), false);
  const view = env.ctx.controllers.modules.view(env.id);
  assert.equal(view.seeded, false);
  assert.equal(view.seedLabel, 'Espace illisible : modules non relevés.');
  assert.throws(() => env.ctx.controllers.modules.toggle(env.id, 'linen', false, 'op'), (err) => err.status === 409 && err.body.error === 'NOT_SEEDED');
  assert.throws(() => env.ctx.controllers.modules.retry(env.id, 'op'), (err) => err.status === 409 && err.body.error === 'NOT_SEEDED');
  env.cleanup();
});

test('rule 25: « Relever maintenant » seeds a space that became readable', async () => {
  const env = await existingCustomer();
  writeSpace(env, { active: ['linen'] });
  const view = env.ctx.controllers.modules.retry(env.id, 'adrien@adn-dev.fr');
  assert.equal(view.seeded, true);
  assert.equal(lineOf(view, 'linen').on, true);
  assert.equal(lineOf(view, 'sas').on, false);
  env.cleanup();
});

test('rule 25: the console\'s minute tick seeds the customers it could not read before', async () => {
  const env = await existingCustomer();
  writeSpace(env, { active: ['sas'] });
  const scheduler = createScheduler(env.ctx, () => {});
  assert.equal(scheduler.syncModules().seeded, 1);
  assert.deepEqual(licenceOf(env).activePlugins, ['sas']);
  env.cleanup();
});

test('rule 13: the form lists every allowed module ticked, and a subset is what the first licence carries', async () => {
  const env = await customerWithSpace({ slug: 'preview-only' });
  const { customers } = env.ctx.controllers;
  const all = customers.preview({ ...NEW_CUSTOMER, slug: 'autre', addons: [] });
  assert.ok(all.moduleChoices.length > 0 && all.moduleChoices.every((m) => m.ticked && m.allowed));
  assert.equal(all.moduleSummary, `${all.moduleChoices.length} modules actifs à la création.`);
  const some = customers.preview({ ...NEW_CUSTOMER, slug: 'autre', modules: ['linen', 'sas'] });
  assert.deepEqual(some.moduleChoices.filter((m) => m.ticked).map((m) => m.id), ['linen', 'sas']);
  assert.equal(some.moduleChoices.length, all.moduleChoices.length, 'unticked lines stay visible');
  assert.equal(some.moduleSummary, '2 modules actifs à la création.');

  const created = await customers.create({ ...NEW_CUSTOMER, slug: 'autre', contactEmail: 'x@autre.fr', modules: ['linen', 'sas'] }, 'op');
  const lic = JSON.parse(Buffer.from(customers.licenceDownload(created.id).token.split('.')[1], 'base64url').toString());
  assert.deepEqual(lic.activePlugins, ['linen', 'sas']);
  env.cleanup();
});

test('rule 13: the add-ons chosen in the form widen the ticked set; a module outside plan and add-ons is refused with 422', async () => {
  const env = await customerWithSpace({ slug: 'preview-only' });
  const { customers } = env.ctx.controllers;
  const withAddon = customers.preview({ ...NEW_CUSTOMER, slug: 'autre', addons: ['gate-access'] });
  assert.ok(withAddon.moduleChoices.some((m) => m.id === 'gate-access' && m.ticked));
  assert.equal(customers.preview({ ...NEW_CUSTOMER, slug: 'autre' }).moduleChoices.some((m) => m.id === 'gate-access'), false);
  await assert.rejects(
    customers.create({ ...NEW_CUSTOMER, slug: 'autre', contactEmail: 'x@autre.fr', modules: ['neat'] }, 'op'),
    (err) => err.status === 422 && err.body.message === 'Hors forfait : à ajouter au forfait ou en option d’abord.',
  );
  assert.equal(env.ctx.models.customers.slugTaken('autre'), false, 'nothing was created');
  env.cleanup();
});
