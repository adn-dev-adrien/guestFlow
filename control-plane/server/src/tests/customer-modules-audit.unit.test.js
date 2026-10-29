// specs/plugin-operator-provisioning.md rules 41–42 (audit 2026-10-28, H2 and L1): what « Désinstaller »
// may promise, the removal flag in the licence, and an order the space already ran.
const test = require('node:test');
const assert = require('node:assert/strict');
const { customerWithSpace, writeSpace, lineOf, writtenAt, licenceOf } = require('./moduleFixture');

const PAID = { label: '2 réservations hors séjour, 140,00 € encaissés, absents de la compta', count: 2, warning: true };
const NOTE = { label: 'les réglages restent dans l’espace', count: 0, warning: true };

async function offWith(facts, spaceOptions = {}) {
  const env = await customerWithSpace({ planCode: 'premium' });
  const { modules } = env.ctx.controllers;
  if (lineOf(modules.view(env.id), 'hourly-resources').on) modules.toggle(env.id, 'hourly-resources', false, 'op');
  writeSpace(env, { inactive: ['hourly-resources'], applied: writtenAt(env), facts, ...spaceOptions });
  return env;
}

test('rule 41: a warning line that carries a count is data — erase is offered, uninstall is not', async () => {
  const env = await offWith({ 'hourly-resources': { setup: null, erasable: true, data: [PAID] } });
  const line = lineOf(env.ctx.controllers.modules.view(env.id), 'hourly-resources');
  assert.equal(line.canUninstall, false);
  assert.equal(line.canErase, true);
  assert.deepEqual(line.eraseLines, [PAID.label]);
  env.cleanup();
});

test('rule 41: a note-only module (zero-count warning) and an erasable:false module can be uninstalled', async () => {
  let env = await offWith({ 'hourly-resources': { setup: null, erasable: true, data: [NOTE] } });
  assert.equal(lineOf(env.ctx.controllers.modules.view(env.id), 'hourly-resources').canUninstall, true);
  env.cleanup();
  env = await offWith({ 'hourly-resources': { setup: null, erasable: false, data: [] } });
  assert.equal(lineOf(env.ctx.controllers.modules.view(env.id), 'hourly-resources').canUninstall, true);
  env.cleanup();
});

test('rule 41: a space that cannot count the data (dataUnknown, null data, no facts) offers no action', async () => {
  for (const facts of [
    { 'hourly-resources': { setup: null, erasable: true, data: [], dataUnknown: true } },
    { 'hourly-resources': { setup: null, erasable: true, data: null } },
    {},
  ]) {
    const env = await offWith(facts);
    const line = lineOf(env.ctx.controllers.modules.view(env.id), 'hourly-resources');
    assert.equal(line.canErase, false);
    assert.equal(line.canUninstall, false);
    assert.equal(line.detail, 'Données non relevées : ni effacement ni désinstallation.');
    assert.throws(() => env.ctx.controllers.modules.erase(env.id, 'hourly-resources', env.slug, 'op'), (e) => e.body.error === 'NOTHING_TO_ERASE');
    env.cleanup();
  }
});

test('rule 42: the licence carries removal:true for an uninstall and nothing for a data erase', async () => {
  let env = await offWith({ 'hourly-resources': { setup: null, erasable: false, data: [] } });
  env.ctx.controllers.modules.erase(env.id, 'hourly-resources', env.slug, 'op');
  assert.deepEqual(licenceOf(env).eraseOrders.map((o) => [o.id, o.removal]), [['hourly-resources', true]]);
  env.cleanup();
  env = await offWith({ 'hourly-resources': { setup: null, erasable: true, data: [PAID] } });
  env.ctx.controllers.modules.erase(env.id, 'hourly-resources', env.slug, 'op');
  assert.deepEqual(licenceOf(env).eraseOrders.map((o) => [o.id, o.removal]), [['hourly-resources', undefined]]);
  env.cleanup();
});

test('rule 42 (L1): switching a module on after the space ran its order says so instead of « annulé »', async () => {
  const env = await offWith({ 'hourly-resources': { setup: null, erasable: true, data: [PAID] } });
  const { modules } = env.ctx.controllers;
  modules.erase(env.id, 'hourly-resources', env.slug, 'op');
  const [{ order }] = licenceOf(env).eraseOrders;
  writeSpace(env, { active: [], applied: writtenAt(env), facts: {}, erased: [order] });
  modules.toggle(env.id, 'hourly-resources', true, 'op');
  const texts = env.ctx.models.audit.forCustomer(env.id).map((a) => a.text);
  assert.ok(texts.some((t) => /^Données de .+ déjà effacées$/.test(t)), texts.join(' | '));
  assert.ok(!texts.some((t) => /annulé$/.test(t)));
  assert.deepEqual(licenceOf(env).eraseOrders, []);
  env.cleanup();
});

test('rule 42 (L1): an order the space has not run is still reported cancelled', async () => {
  const env = await offWith({ 'hourly-resources': { setup: null, erasable: true, data: [PAID] } });
  const { modules } = env.ctx.controllers;
  modules.erase(env.id, 'hourly-resources', env.slug, 'op');
  modules.toggle(env.id, 'hourly-resources', true, 'op');
  assert.ok(env.ctx.models.audit.forCustomer(env.id).some((a) => /^Effacement des données de .+ annulé$/.test(a.text)));
  env.cleanup();
});

test('rule 41: « Désinstaller » is offered only to a space that declares removalOrders; erase is unaffected', async () => {
  const noData = { 'hourly-resources': { setup: null, erasable: false, data: [] } };
  for (const capabilities of [null, { removalOrders: false }, { coreVersion: '3.18.0' }]) {
    const env = await offWith(noData, { capabilities });
    const line = lineOf(env.ctx.controllers.modules.view(env.id), 'hourly-resources');
    assert.equal(line.canUninstall, false, JSON.stringify(capabilities));
    assert.throws(() => env.ctx.controllers.modules.erase(env.id, 'hourly-resources', env.slug, 'op'), (e) => e.body.error === 'NOTHING_TO_ERASE');
    assert.deepEqual(licenceOf(env).eraseOrders, [], 'no removal order is ever sent to an old core');
    env.cleanup();
  }
  const env = await offWith({ 'hourly-resources': { setup: null, erasable: true, data: [PAID] } }, { capabilities: null });
  assert.equal(lineOf(env.ctx.controllers.modules.view(env.id), 'hourly-resources').canErase, true);
  env.cleanup();
});
