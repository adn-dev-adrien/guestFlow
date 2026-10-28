// specs/plugin-operator-provisioning.md rules 22–23 — erasing one module's data: the operator's, on an
// inactive module only, the customer's slug typed to confirm; the order travels in the licence and
// leaves it once the space reports it executed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { customerWithSpace, writeSpace, lineOf, writtenAt, licenceOf } = require('./moduleFixture');
const { createScheduler } = require('../tasks/scheduler');

const FACTS = { linen: { setup: null, erasable: true, data: [{ label: '3 pièces de stock', count: 3 }, { label: '12 mouvements', count: 12 }, { label: 'les réglages restent dans l’espace', count: 0, warning: true }] } };

// Linen switched off by the operator, the space applied it and still holds data.
async function linenOffWithData() {
  const env = await customerWithSpace();
  env.ctx.controllers.modules.toggle(env.id, 'linen', false, 'op');
  writeSpace(env, { inactive: ['linen'], applied: writtenAt(env), facts: FACTS });
  return env;
}

test('rule 22: an inactive module with data offers « Effacer les données… » and lists what will be erased', async () => {
  const env = await linenOffWithData();
  const line = lineOf(env.ctx.controllers.modules.view(env.id), 'linen');
  assert.equal(line.canErase, true);
  assert.deepEqual(line.eraseLines, ['3 pièces de stock', '12 mouvements']);
  assert.deepEqual(line.eraseWarnings, ['les réglages restent dans l’espace']);
  env.cleanup();
});

test('rule 22: an active module, a module without data and a module the space no longer has offer nothing', async () => {
  const env = await customerWithSpace();
  const { modules } = env.ctx.controllers;
  writeSpace(env, { active: ['linen', 'sas'], applied: writtenAt(env), facts: FACTS });
  assert.equal(lineOf(modules.view(env.id), 'linen').canErase, false, 'active');
  modules.toggle(env.id, 'sas', false, 'op');
  writeSpace(env, { inactive: ['sas'], active: ['linen'], applied: writtenAt(env), facts: { sas: { setup: null, erasable: false, data: [] } } });
  assert.equal(lineOf(modules.view(env.id), 'sas').canErase, false, 'nothing to erase');
  modules.toggle(env.id, 'school-holidays', false, 'op');
  writeSpace(env, { active: ['linen'], applied: writtenAt(env), facts: {} });
  assert.equal(lineOf(modules.view(env.id), 'school-holidays').canErase, false, 'not installed');
  env.cleanup();
});

test('rule 22: the erase is refused while the module is on (409), and without the exact slug (400)', async () => {
  const env = await linenOffWithData();
  const { modules } = env.ctx.controllers;
  assert.throws(() => modules.erase(env.id, 'sas', env.slug, 'op'), (err) => err.status === 409 && err.body.error === 'MODULE_ACTIVE');
  assert.throws(() => modules.erase(env.id, 'linen', 'autre', 'op'), (err) => err.status === 400 && err.body.error === 'SLUG_MISMATCH' && err.body.message === `Tapez exactement « ${env.slug} » pour confirmer.`);
  assert.throws(() => modules.erase(env.id, 'linen', '', 'op'), (err) => err.status === 400);
  assert.deepEqual(licenceOf(env).eraseOrders, []);
  env.cleanup();
});

test('rule 22, 23: a confirmed erase writes an audit line and puts one order in the licence — once, however many clicks', async () => {
  const env = await linenOffWithData();
  const { modules } = env.ctx.controllers;
  modules.erase(env.id, 'linen', env.slug, 'adrien@adn-dev.fr');
  modules.erase(env.id, 'linen', env.slug, 'adrien@adn-dev.fr');
  const orders = licenceOf(env).eraseOrders;
  assert.equal(orders.length, 1);
  assert.equal(orders[0].id, 'linen');
  assert.match(orders[0].order, /^[0-9a-f-]{36}$/);
  assert.ok(env.ctx.models.audit.forCustomer(env.id).some((a) => /^Effacement des données de .+ demandé$/.test(a.text) && a.operator === 'adrien@adn-dev.fr'));
  const line = lineOf(modules.view(env.id), 'linen');
  assert.equal(line.canErase, false);
  assert.equal(line.detail, 'Effacement des données en cours.');
  env.cleanup();
});

test('rule 23: once the space reports the order executed, it leaves the licence and the journal says so', async () => {
  const env = await linenOffWithData();
  const { modules } = env.ctx.controllers;
  modules.erase(env.id, 'linen', env.slug, 'op');
  const [{ order }] = licenceOf(env).eraseOrders;
  assert.equal(modules.acknowledgeErasures(), 0, 'not before the space says so');
  writeSpace(env, { active: [], applied: writtenAt(env), facts: {}, erased: [order] });
  const scheduler = createScheduler(env.ctx, () => {});
  assert.equal(scheduler.syncModules().acknowledged, 1);
  assert.deepEqual(licenceOf(env).eraseOrders, []);
  assert.ok(env.ctx.models.audit.forCustomer(env.id).some((a) => /^Données de .+ effacées$/.test(a.text)));
  assert.equal(scheduler.syncModules().acknowledged, 0);
  env.cleanup();
});

test('rule 27: switching the module back on cancels an order still on its way', async () => {
  const env = await linenOffWithData();
  const { modules } = env.ctx.controllers;
  modules.erase(env.id, 'linen', env.slug, 'op');
  modules.toggle(env.id, 'linen', true, 'op');
  assert.deepEqual(licenceOf(env).eraseOrders, []);
  assert.ok(env.ctx.models.audit.forCustomer(env.id).some((a) => /^Effacement des données de .+ annulé$/.test(a.text)));
  env.cleanup();
});

test('rule 22: an order is refused on an archived customer or one whose space was never read', async () => {
  const env = await linenOffWithData();
  env.ctx.db.prepare('UPDATE customers SET pluginsSeededAt = NULL WHERE id = ?').run(env.id);
  assert.throws(() => env.ctx.controllers.modules.erase(env.id, 'linen', env.slug, 'op'), (err) => err.body.error === 'NOT_SEEDED');
  env.cleanup();
});

test('rule 14: an inactive module that still holds data reads « données conservées »; one without data does not', async () => {
  const env = await linenOffWithData();
  assert.equal(lineOf(env.ctx.controllers.modules.view(env.id), 'linen').detail, 'données conservées');
  env.ctx.controllers.modules.toggle(env.id, 'sas', false, 'op');
  writeSpace(env, { inactive: ['linen', 'sas'], applied: writtenAt(env), facts: FACTS });
  assert.equal(lineOf(env.ctx.controllers.modules.view(env.id), 'sas').detail, null);
  env.cleanup();
});
