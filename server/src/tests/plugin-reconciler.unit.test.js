// specs/plugin-operator-provisioning.md rules 16–19 — the space brings its plugins to the licence's
// activePlugins through the controller's own handlers, reports each outcome, and never loops on a failure.
const test = require('node:test');
const assert = require('node:assert/strict');

const { space } = require('./pluginOperatorFixture');
const { planSteps, BLOCKED_RETRY_MS } = require('../utils/pluginReconciler');

const ids = (steps) => steps.map((s) => `${s.op}:${s.id}`);
const enabled = (s) => s.model.list().filter((r) => r.enabled).map((r) => r.id).sort();

test('rule 16: a plugin in activePlugins and not installed is installed and active', async () => {
  const s = space({ active: ['linen'] });
  const out = await s.reconciler.run();
  assert.deepEqual(ids(out.steps), ['install:linen']);
  assert.deepEqual(enabled(s), ['linen']);
  assert.equal(s.provisioning.get('linen').outcome, 'applied');
});

test('rule 16: an installed, inactive plugin in activePlugins is activated', async () => {
  const s = space({ installed: [['linen', false]], active: ['linen'] });
  const out = await s.reconciler.run();
  assert.deepEqual(ids(out.steps), ['activate:linen']);
  assert.deepEqual(enabled(s), ['linen']);
});

test('rule 16: an active plugin missing from activePlugins is deactivated, its data and settings kept', async () => {
  const s = space({ installed: ['linen', 'sas'], active: ['sas'] });
  s.db.prepare('INSERT INTO linen_stock (n) VALUES (3)').run();
  const out = await s.reconciler.run();
  assert.deepEqual(ids(out.steps), ['deactivate:linen']);
  assert.equal(s.model.get('linen').enabled, false);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM linen_stock').get().n, 1);
});

test('rule 16: already as wanted → nothing to do, and the licence is stamped as applied', async () => {
  const s = space({ installed: ['linen'], active: ['linen'] });
  const out = await s.reconciler.run();
  assert.deepEqual(out.steps, []);
  assert.equal(s.provisioning.appliedLicence(), '2026-10-28T08:00:00.000Z');
});

test('rule 15: a licence without activePlugins changes nothing on the space', async () => {
  const s = space({ installed: ['linen', 'sas'], active: null });
  const out = await s.reconciler.run();
  assert.equal(out.skipped, true);
  assert.deepEqual(enabled(s), ['linen', 'sas']);
  assert.equal(s.provisioning.list().length, 0);
});

test('rule 16: order — a requirement is installed before its dependant', () => {
  const steps = planSteps({
    desired: ['google-vacation-rentals', 'website-booking'], states: {},
    requires: { 'google-vacation-rentals': ['website-booking'] },
    order: ['website-booking', 'google-vacation-rentals'],
  });
  assert.deepEqual(ids(steps), ['install:website-booking', 'install:google-vacation-rentals']);
  const reversed = planSteps({
    desired: ['google-vacation-rentals', 'website-booking'], states: {},
    requires: { 'google-vacation-rentals': ['website-booking'] },
    order: ['google-vacation-rentals', 'website-booking'],
  });
  assert.deepEqual(ids(reversed), ['install:website-booking', 'install:google-vacation-rentals']);
});

test('rule 16: order — a dependant is deactivated before its requirement, and deactivations come first', () => {
  const steps = planSteps({
    desired: ['sas'], states: { 'website-booking': 'active', 'google-vacation-rentals': 'active', sas: 'inactive' },
    requires: { 'google-vacation-rentals': ['website-booking'] },
    order: ['website-booking', 'google-vacation-rentals', 'sas'],
  });
  assert.deepEqual(ids(steps), ['deactivate:google-vacation-rentals', 'deactivate:website-booking', 'activate:sas']);
});

test('rule 16: the real catalogue — switching the pair on installs website-booking first', async () => {
  const s = space({ active: ['google-vacation-rentals', 'website-booking'] });
  const out = await s.reconciler.run();
  assert.deepEqual(ids(out.steps), ['install:website-booking', 'install:google-vacation-rentals']);
  assert.deepEqual(enabled(s), ['google-vacation-rentals', 'website-booking']);
});

test('rule 16: the real catalogue — switching the pair off deactivates the dependant first', async () => {
  const s = space({ installed: ['google-vacation-rentals', 'website-booking'], active: [] });
  const out = await s.reconciler.run();
  assert.deepEqual(ids(out.steps), ['deactivate:google-vacation-rentals', 'deactivate:website-booking']);
  assert.deepEqual(enabled(s), []);
});

test('rule 17: a package that needs a restart is reported, never switched', async () => {
  const s = space({ active: ['linen'] });
  s.controller.install = async (req, res) => {
    assert.equal(req.noRestart, true);
    return res.status(409).json({ error: 'RESTART_REQUIRED', message: 'Redémarrage nécessaire — passer par Versions › Plugins.' });
  };
  const rec = s.rebuild();
  await rec.run();
  const row = s.provisioning.get('linen');
  assert.equal(row.outcome, 'failed');
  assert.equal(row.message, 'Redémarrage nécessaire — passer par Versions › Plugins.');
});

test('rule 21: a plugin outside the plan is never installed, even when activePlugins names it', async () => {
  const s = space({ plugins: ['linen'], active: ['linen', 'sas'] });
  await s.reconciler.run();
  assert.deepEqual(enabled(s), ['linen']);
  assert.equal(s.model.get('sas'), null);
});

test('rule 18: a failure is not retried for the same licence, and is retried for a new one', async () => {
  const s = space({ active: ['linen'] });
  let calls = 0;
  const real = s.controller.install;
  s.controller.install = async (req, res) => {
    calls += 1;
    if (calls === 1) return res.status(500).json({ error: 'PLUGIN_REGISTER_FAILED', message: 'Échec du démarrage.' });
    return real(req, res);
  };
  const rec = s.rebuild();
  await rec.run();
  assert.equal(s.provisioning.get('linen').outcome, 'failed');
  assert.equal(s.provisioning.get('linen').message, 'Échec du démarrage.');
  await rec.run();
  await rec.run();
  assert.equal(calls, 1);
  s.licence.state.issuedAt = '2026-10-29T08:00:00.000Z';
  await rec.run();
  assert.equal(calls, 2);
  assert.equal(s.provisioning.get('linen').outcome, 'applied');
  assert.deepEqual(enabled(s), ['linen']);
});

test('rule 19: a deactivation refused by a business guard is blocked, the plugin stays active, retried each hour', async () => {
  const s = space({ installed: ['online-payment'], active: [], blockers: { 'online-payment': 2 } });
  await s.reconciler.run();
  const row = s.provisioning.get('online-payment');
  assert.equal(row.outcome, 'blocked');
  assert.equal(row.code, 'OPEN_PAYMENT_LINKS');
  assert.match(row.message, /2 liens de paiement en attente/);
  assert.equal(s.model.get('online-payment').enabled, true);

  s.db.prepare("UPDATE payment_links SET status = 'paid'").run();
  s.clock.t = new Date(s.clock.t.getTime() + 10 * 60 * 1000);
  await s.reconciler.run();
  assert.equal(s.model.get('online-payment').enabled, true, 'not retried before the hour');

  s.clock.t = new Date(s.clock.t.getTime() + BLOCKED_RETRY_MS);
  await s.reconciler.run();
  assert.equal(s.model.get('online-payment').enabled, false);
  assert.equal(s.provisioning.get('online-payment').outcome, 'applied');
});

test('rule 19: a new licence retries a blocked deactivation at once', async () => {
  const s = space({ installed: ['online-payment'], active: [], blockers: { 'online-payment': 1 } });
  await s.reconciler.run();
  s.db.prepare("UPDATE payment_links SET status = 'paid'").run();
  s.licence.state.issuedAt = '2026-10-28T09:00:00.000Z';
  await s.reconciler.run();
  assert.equal(s.model.get('online-payment').enabled, false);
});

test('rule 18: one plugin failing never stops the others', async () => {
  const s = space({ installed: ['online-payment'], active: ['linen'], blockers: { 'online-payment': 1 } });
  await s.reconciler.run();
  assert.equal(s.provisioning.get('online-payment').outcome, 'blocked');
  assert.equal(s.model.get('linen').enabled, true);
  assert.equal(s.provisioning.appliedLicence(), '2026-10-28T08:00:00.000Z');
});

test('rule 16: an update in progress is not recorded — the pass tries again, the licence stays unapplied', async () => {
  const s = space({ active: ['linen'] });
  const real = s.controller.install;
  let busy = true;
  s.controller.install = async (req, res) => (busy
    ? res.status(409).json({ error: 'UPDATE_IN_PROGRESS' })
    : real(req, res));
  const rec = s.rebuild();
  await rec.run();
  assert.equal(s.provisioning.get('linen'), null);
  assert.equal(s.provisioning.appliedLicence(), null);
  busy = false;
  await rec.run();
  assert.equal(s.model.get('linen').enabled, true);
  assert.equal(s.provisioning.appliedLicence(), '2026-10-28T08:00:00.000Z');
});

test('rules 14, 22, 28: the pass publishes the setup a plugin lacks and the data it would erase', async () => {
  const s = space({
    installed: ['linen', 'weather-alerts'], active: ['linen', 'weather-alerts'],
    data: { linen: { tables: ['linen_stock'], describe: () => [{ label: '3 pièces de stock', count: 3 }] } },
    setup: { 'weather-alerts': 'clé API manquante' },
  });
  await s.reconciler.run();
  const facts = Object.fromEntries(s.db.prepare("SELECT key, value FROM plugin_provisioning_meta WHERE key LIKE 'facts:%'").all().map((r) => [r.key, JSON.parse(r.value)]));
  assert.deepEqual(facts['facts:linen'], { setup: null, erasable: true, data: [{ label: '3 pièces de stock', count: 3 }] });
  assert.equal(facts['facts:weather-alerts'].setup, 'clé API manquante');
  assert.equal(facts['facts:neat'], undefined, 'a plugin that is not installed publishes nothing');
});

test('rule 21: a plugin the licence does not allow keeps its stored state — a plan that takes it back finds it as it was', async () => {
  const s = space({ installed: ['linen', 'booking-intake', ['airbnb-intake', false]], plugins: ['linen', 'sas'], active: ['sas'] });
  const out = await s.reconciler.run();
  assert.deepEqual(ids(out.steps), ['deactivate:linen', 'install:sas']);
  assert.equal(s.model.get('booking-intake').enabled, true);
  assert.equal(s.model.get('airbnb-intake').enabled, false);
  assert.equal(s.provisioning.get('booking-intake'), null);
});
