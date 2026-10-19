// specs/plugins-phase-p-productisation.md rules 37–38 — step « Plugins » installs the ticked plugins
// one after the other, each after the previous one released the plugin lock; a refusal comes back
// with its reason in words, the last step reads « 2 plugins actifs », and an empty price is
// « Prix obligatoire ».

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb } = require('./guestEmailSequenceFixtures');
const { applyProductisationSchema } = require('../utils/productisationMigration');
const { buildController, activeSummary, failureReason } = require('../controllers/onboardingController');

function call(handler, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; },
    };
    Promise.resolve(handler({ body: {}, params: {}, query: {}, ...req }, res));
  });
}

// The plugin host's lock as pluginsController's `underLock` holds it: the answer is sent inside the
// work, and the lock is released only after the work's promise settled — a few ticks later.
function lockedPlugins(states, { refuse = {} } = {}) {
  const lock = { updating: false };
  const order = [];
  async function underLock(res, work) {
    if (lock.updating) return res.status(409).json({ error: 'UPDATE_IN_PROGRESS', message: 'Mise à jour déjà en cours.' });
    lock.updating = true;
    try {
      return await work();
    } finally {
      await new Promise((r) => setImmediate(r));
      lock.updating = false;
    }
  }
  return {
    order,
    lock,
    list: (req, res) => res.json(Object.entries(states).map(([id, state]) => ({ id, name: id, description: id, state, outOfPlan: false, planChip: null }))),
    install: (req, res) => {
      const { id } = req.params;
      if (refuse[id]) return res.status(409).json(refuse[id]);
      return underLock(res, async () => {
        order.push(id);
        states[id] = 'active';
        return res.json({ id, reload: true });
      });
    },
    activate: (req, res) => underLock(res, async () => {
      order.push(`activate:${req.params.id}`);
      states[req.params.id] = 'active';
      return res.json({ id: req.params.id });
    }),
  };
}

function setup(plugins) {
  const db = freshDb();
  applyProductisationSchema(db);
  db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  let row = {};
  const created = [];
  const controller = buildController({
    database: db,
    settingsModel: { read: () => row, upsert: (p) => { row = { ...row, ...p }; } },
    propertiesModel: { count: () => created.length, create: async (body) => { created.push(body); return { id: created.length }; } },
    plugins,
    ensureVapid: () => {},
  });
  return { db, controller };
}

test('rule 37: the two recommended plugins of a fresh install both go through on the first click', async () => {
  const plugins = lockedPlugins({ 'website-booking': 'available', sas: 'available', neat: 'available' });
  const { db, controller } = setup(plugins);
  const { body } = await call(controller.savePlugins, { body: { answers: { options: true, website: true } } });
  assert.deepEqual(body.results, [{ id: 'sas', ok: true }, { id: 'website-booking', ok: true }]);
  assert.deepEqual(plugins.order, ['sas', 'website-booking']);
  assert.equal(plugins.lock.updating, false);
  assert.equal(body.pluginsSummary, '2 plugins actifs');
  db.close();
});

test('rule 37: a refusal carries its reason in words, and the others still go through', async () => {
  const plugins = lockedPlugins({ 'website-booking': 'available', sas: 'inactive' }, {
    refuse: { 'website-booking': { error: 'CORE_TOO_OLD', message: 'Nécessite GuestFlow 3.11 ou plus récent.' } },
  });
  const { db, controller } = setup(plugins);
  const { body } = await call(controller.savePlugins, { body: { answers: { options: true, website: true } } });
  assert.deepEqual(body.results, [
    { id: 'sas', ok: true },
    { id: 'website-booking', ok: false, error: 'CORE_TOO_OLD', reason: 'nécessite GuestFlow 3.11 ou plus récent' },
  ]);
  assert.equal(body.pluginsSummary, '1 plugin actif');
  db.close();
});

test('rule 37: a lock held by another operation reads « activation en cours »', () => {
  assert.equal(failureReason('UPDATE_IN_PROGRESS', 'Mise à jour déjà en cours.'), 'activation en cours, réessayer dans un instant');
  assert.equal(failureReason('PLUGIN_MIGRATION_FAILED'), 'échec de l’activation');
});

test('rule 38: the summary of the last step is a real plural, from the server', async () => {
  assert.equal(activeSummary(0), 'Aucun plugin actif');
  assert.equal(activeSummary(1), '1 plugin actif');
  assert.equal(activeSummary(3), '3 plugins actifs');
  const { db, controller } = setup(lockedPlugins({ sas: 'active', neat: 'available' }));
  assert.equal((await call(controller.get, {})).body.pluginsSummary, '1 plugin actif');
  db.close();
});

test('rule 38: an empty price is « Prix obligatoire », a negative one « Prix positif ou nul »', async () => {
  const { db, controller } = setup(lockedPlugins({}));
  const base = { name: 'Gîte', doubleBeds: 1, singleBeds: 0, maxGuests: 2 };
  for (const empty of ['', '  ', null, undefined]) {
    const r = await call(controller.saveProperty, { body: { ...base, pricePerNight: empty } }); // eslint-disable-line no-await-in-loop
    assert.equal(r.body.errors.pricePerNight, 'Prix obligatoire');
  }
  const negative = await call(controller.saveProperty, { body: { ...base, pricePerNight: '-5' } });
  assert.equal(negative.body.errors.pricePerNight, 'Prix positif ou nul');
  db.close();
});

// Rule 42 — an install that ships new pages asks for a page load; the step passes it on.
test('rule 42: the step answers reload when an install asked for it, and not for an activation alone', async () => {
  const installed = setup(lockedPlugins({ sas: 'available' }));
  assert.equal((await call(installed.controller.savePlugins, { body: { answers: { options: true } } })).body.reload, true);
  installed.db.close();
  const activated = setup(lockedPlugins({ sas: 'inactive' }));
  assert.equal((await call(activated.controller.savePlugins, { body: { answers: { options: true } } })).body.reload, false);
  activated.db.close();
});
