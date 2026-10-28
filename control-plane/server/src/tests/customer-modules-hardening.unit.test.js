// specs/plugin-operator-provisioning.md rules 29, 31 — a space on a release before the reconciler is
// never seeded (the licence's choice would be taken for nothing); the console refuses an erase that
// an installed plugin would stop, and shows the space's refusal on the line.
const test = require('node:test');
const assert = require('node:assert/strict');
const { customerWithSpace, writeSpace, lineOf, writtenAt } = require('./moduleFixture');

const DATA = { 'website-booking': { setup: null, erasable: true, data: [{ label: '2 clés', count: 2 }] } };

async function unseeded() {
  const env = await customerWithSpace({ planCode: 'premium' });
  env.ctx.db.prepare('DELETE FROM customer_plugins WHERE customerId = ?').run(env.id);
  env.ctx.db.prepare('UPDATE customers SET pluginsSeededAt = NULL WHERE id = ?').run(env.id);
  env.ctx.controllers.customers.issueLicence(env.id);
  return env;
}

test('rule 29: a space on a release before the reconciler stays unseeded and says it must be updated', async () => {
  const env = await unseeded();
  writeSpace(env, { active: ['linen', 'sas'], provisioning: false });
  const { modules } = env.ctx.controllers;
  assert.equal(modules.seedPending(), 0);
  assert.equal(env.ctx.models.customerPlugins.chosen(env.id).length, 0);
  assert.equal('activePlugins' in require('./moduleFixture').licenceOf(env), false);
  const view = modules.view(env.id);
  assert.equal(view.seeded, false);
  assert.equal(view.seedLabel, 'Espace à mettre à jour : modules non relevés.');
  assert.throws(() => modules.retry(env.id, 'op'), (err) => err.body.error === 'NOT_SEEDED' && /à mettre à jour/.test(err.body.message));
  writeSpace(env, { active: ['linen', 'sas'] });
  assert.equal(modules.seedPending(), 1, 'seeded as soon as the space runs the reconciler');
  env.cleanup();
});

test('rule 31: the erase of a module an installed plugin requires is refused, naming the dependant', async () => {
  const env = await customerWithSpace({ planCode: 'premium' });
  const { modules } = env.ctx.controllers;
  env.ctx.models.customers.addGrandfathered(env.id, 'google-vacation-rentals', '2026-09-29');
  modules.toggle(env.id, 'google-vacation-rentals', false, 'op');
  modules.toggle(env.id, 'website-booking', false, 'op');
  writeSpace(env, { inactive: ['website-booking', 'google-vacation-rentals'], applied: writtenAt(env), facts: DATA });
  assert.throws(() => modules.erase(env.id, 'website-booking', env.slug, 'op'), (err) => {
    assert.equal(err.status, 422);
    assert.equal(err.body.error, 'REQUIRED_BY');
    assert.match(err.body.message, /^Nécessaire à .+ : à désinstaller d’abord\.$/);
    return true;
  });
  assert.equal(env.ctx.models.customerPlugins.pendingOrders(env.id).length, 0);
  writeSpace(env, { inactive: ['website-booking'], applied: writtenAt(env), facts: DATA });
  assert.doesNotThrow(() => modules.erase(env.id, 'website-booking', env.slug, 'op'));
  env.cleanup();
});

test('rule 31: an erase the space failed or blocked shows on the line, for the current licence only', async () => {
  const env = await customerWithSpace();
  const { modules } = env.ctx.controllers;
  modules.toggle(env.id, 'linen', false, 'op');
  writeSpace(env, { inactive: ['linen'], applied: writtenAt(env), facts: { linen: { setup: null, erasable: true, data: [{ label: '3 pièces', count: 3 }] } } });
  modules.erase(env.id, 'linen', env.slug, 'op');
  const row = (outcome, message) => ({ pluginId: 'linen', desired: 'inactive', outcome, message, licenceIssuedAt: writtenAt(env) });
  const facts = { linen: { setup: null, erasable: true, data: [{ label: '3 pièces', count: 3 }] } };
  writeSpace(env, { inactive: ['linen'], applied: writtenAt(env), facts, rows: [row('blocked', 'Nécessaire à Réservation depuis le site : à désinstaller d’abord.')] });
  assert.equal(lineOf(modules.view(env.id), 'linen').detail, 'Effacement bloqué : Nécessaire à Réservation depuis le site : à désinstaller d’abord.');
  writeSpace(env, { inactive: ['linen'], applied: writtenAt(env), facts, rows: [row('failed', 'Échec de l’effacement : rien n’a été effacé.')] });
  assert.equal(lineOf(modules.view(env.id), 'linen').detail, 'Échec de l’effacement : rien n’a été effacé.');
  writeSpace(env, { inactive: ['linen'], applied: writtenAt(env), facts, rows: [{ ...row('failed', 'x'), licenceIssuedAt: '2020-01-01T00:00:00.000Z' }] });
  assert.equal(lineOf(modules.view(env.id), 'linen').detail, 'Effacement des données en cours.');
  env.cleanup();
});
