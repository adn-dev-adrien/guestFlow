// specs/plugin-operator-provisioning.md rules 29, 31, 37, 38 — a space on a release before the reconciler is
// never seeded (the licence's choice would be taken for nothing); the console refuses an erase that
// an installed plugin would stop (the line says so and offers the way out), shows the space's refusal
// on the line, and stamps each licence after the one before it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { customerWithSpace, writeSpace, lineOf, writtenAt, licenceOf } = require('./moduleFixture');

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

test('rule 37: each licence is stamped after the one before it, even when the console clock stepped back', async () => {
  const env = await customerWithSpace();
  const { modules } = env.ctx.controllers;
  env.now.set('2026-09-29T12:00:00Z');
  modules.toggle(env.id, 'linen', false, 'op');
  const first = writtenAt(env);
  assert.equal(first, '2026-09-29T12:00:00.000Z');
  env.now.set('2026-09-29T10:00:00Z');
  modules.toggle(env.id, 'linen', true, 'op');
  const second = writtenAt(env);
  assert.ok(Date.parse(second) > Date.parse(first), `${second} after ${first}`);
  assert.equal(second, '2026-09-29T12:00:00.001Z');
  assert.equal(licenceOf(env).issuedAt, second, 'a download reuses the last stamp');
  env.now.set('2026-09-29T13:00:00Z');
  modules.toggle(env.id, 'linen', false, 'op');
  assert.equal(writtenAt(env), '2026-09-29T13:00:00.000Z', 'a clock that moves on is followed');
  env.cleanup();
});

test('rule 38: a module an installed plugin requires shows why on its line and offers neither erase nor removal', async () => {
  const env = await customerWithSpace({ planCode: 'premium' });
  const { modules } = env.ctx.controllers;
  env.ctx.models.customers.addGrandfathered(env.id, 'google-vacation-rentals', '2026-09-29');
  modules.toggle(env.id, 'google-vacation-rentals', false, 'op');
  modules.toggle(env.id, 'website-booking', false, 'op');
  writeSpace(env, { inactive: ['website-booking', 'google-vacation-rentals'], applied: writtenAt(env), facts: DATA });
  const view = modules.view(env.id);
  const booking = lineOf(view, 'website-booking');
  assert.equal(booking.canErase, false);
  assert.equal(booking.canUninstall, false);
  assert.deepEqual(booking.eraseLines, []);
  assert.match(booking.detail, /^Nécessaire à .+ : à désinstaller d’abord\.$/);
  assert.equal(booking.blockedBy, booking.detail);
  const dependant = lineOf(view, 'google-vacation-rentals');
  assert.equal(dependant.canErase, false, 'it holds no data');
  assert.equal(dependant.canUninstall, true, 'the way out: remove it first');
  env.cleanup();
});

test('rule 38: removing a data-less module is an erase order the space settles by uninstalling; the dependency then lifts', async () => {
  const env = await customerWithSpace({ planCode: 'premium' });
  const { modules } = env.ctx.controllers;
  env.ctx.models.customers.addGrandfathered(env.id, 'google-vacation-rentals', '2026-09-29');
  modules.toggle(env.id, 'google-vacation-rentals', false, 'op');
  modules.toggle(env.id, 'website-booking', false, 'op');
  writeSpace(env, { inactive: ['website-booking', 'google-vacation-rentals'], applied: writtenAt(env), facts: DATA });
  assert.throws(() => modules.erase(env.id, 'google-vacation-rentals', 'wrong', 'op'), (err) => err.status === 400);
  modules.erase(env.id, 'google-vacation-rentals', env.slug, 'op');
  assert.equal(env.ctx.models.customerPlugins.pendingOrders(env.id).length, 1);
  assert.equal(lineOf(modules.view(env.id), 'google-vacation-rentals').detail, 'Désinstallation en cours.');
  writeSpace(env, { inactive: ['website-booking'], applied: writtenAt(env), facts: DATA, erased: [env.ctx.models.customerPlugins.pendingOrders(env.id)[0].orderId] });
  modules.acknowledgeErasures();
  const journal = env.ctx.models.audit.forCustomer(env.id).filter((a) => a.kind === 'module').map((a) => a.text);
  assert.ok(journal.includes('Désinstallation de Google Vacation Rentals demandée'), journal.join(' | '));
  assert.ok(journal.includes('Google Vacation Rentals désinstallé'), journal.join(' | '));
  assert.equal(journal.some((t) => /Effacement|Données de Google/.test(t)), false);
  const booking = lineOf(modules.view(env.id), 'website-booking');
  assert.equal(booking.canErase, true);
  assert.equal(booking.blockedBy, null);
  env.cleanup();
});

test('rule 38: a data erase keeps its wording, and cancelling a removal says so', async () => {
  const env = await customerWithSpace({ planCode: 'premium' });
  const { modules } = env.ctx.controllers;
  env.ctx.models.customers.addGrandfathered(env.id, 'google-vacation-rentals', '2026-09-29');
  modules.toggle(env.id, 'google-vacation-rentals', false, 'op');
  writeSpace(env, { inactive: ['google-vacation-rentals'], applied: writtenAt(env) });
  modules.erase(env.id, 'google-vacation-rentals', env.slug, 'op');
  modules.toggle(env.id, 'google-vacation-rentals', true, 'op');
  const journal = () => env.ctx.models.audit.forCustomer(env.id).filter((a) => a.kind === 'module').map((a) => a.text);
  assert.ok(journal().includes('Désinstallation de Google Vacation Rentals annulée'), journal().join(' | '));
  modules.toggle(env.id, 'school-holidays', false, 'op');
  writeSpace(env, { inactive: ['school-holidays'], applied: writtenAt(env), facts: { 'school-holidays': { setup: null, erasable: true, data: [{ label: '2 périodes', count: 2 }] } } });
  modules.erase(env.id, 'school-holidays', env.slug, 'op');
  assert.equal(lineOf(modules.view(env.id), 'school-holidays').detail, 'Effacement des données en cours.');
  assert.ok(journal().some((t) => /^Effacement des données de .+ demandé$/.test(t)));
  env.cleanup();
});

test('rule 38: a data-less module that is not installed offers nothing to remove', async () => {
  const env = await customerWithSpace();
  const { modules } = env.ctx.controllers;
  modules.toggle(env.id, 'linen', false, 'op');
  writeSpace(env, { active: [], inactive: [], applied: writtenAt(env) });
  const linen = lineOf(modules.view(env.id), 'linen');
  assert.equal(linen.canUninstall, false);
  assert.throws(() => modules.erase(env.id, 'linen', env.slug, 'op'), (err) => err.status === 409);
  env.cleanup();
});
