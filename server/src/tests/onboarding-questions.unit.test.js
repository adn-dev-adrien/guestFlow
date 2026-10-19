// specs/plugins-phase-p-productisation.md rule 43 (UI/UX review 2026-10-18, proposal 13) — the plugin
// step asks three yes/no questions; the server maps each « oui » to its plugins, the plan decides
// which may go, and a « non » never switches anything off.

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb } = require('./guestEmailSequenceFixtures');
const { applyProductisationSchema } = require('../utils/productisationMigration');
const { buildController } = require('../controllers/onboardingController');
const { ONBOARDING_QUESTIONS } = require('../constants/onboardingQuestions');
const { PLUGIN_IDS } = require('../constants/plugins');

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

const NAMES = {
  'hourly-resources': 'Ressources à l’heure', linen: 'Linge et blanchisserie', sas: 'Arrivée et départ guidés',
  'website-booking': 'Réservation depuis le site', 'online-payment': 'Paiement en ligne (Qonto)', neat: 'Assurance annulation Neat',
};

function setup(states, { outOfPlan = [] } = {}) {
  const db = freshDb();
  applyProductisationSchema(db);
  db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  const calls = [];
  const plugins = {
    list: (req, res) => res.json(Object.entries(states).map(([id, state]) => ({
      id, name: NAMES[id] || id, description: id, state, outOfPlan: outOfPlan.includes(id), planChip: outOfPlan.includes(id) ? 'Forfait Premium' : null,
    }))),
    install: (req, res) => { calls.push(`install:${req.params.id}`); states[req.params.id] = 'active'; return res.json({ ok: true }); },
    activate: (req, res) => { calls.push(`activate:${req.params.id}`); states[req.params.id] = 'active'; return res.json({ ok: true }); },
    deactivate: (req, res) => { calls.push(`deactivate:${req.params.id}`); return res.json({ ok: true }); },
  };
  let row = {};
  const controller = buildController({
    database: db,
    settingsModel: { read: () => row, upsert: (p) => { row = { ...row, ...p }; } },
    propertiesModel: { count: () => 0, create: async () => ({ id: 1 }) },
    plugins,
    ensureVapid: () => {},
  });
  return { db, controller, calls };
}

const fresh = () => ({
  'hourly-resources': 'available', linen: 'available', sas: 'available', 'website-booking': 'available', 'online-payment': 'available', neat: 'available',
});

test('rule 43: three questions, each naming the plugins its « oui » turns on', async () => {
  assert.deepEqual(ONBOARDING_QUESTIONS.map((q) => q.id), ['options', 'website', 'payment']);
  ONBOARDING_QUESTIONS.forEach((q) => q.plugins.forEach((id) => assert.ok(PLUGIN_IDS.includes(id), `${id} is a catalogued plugin`)));
  const { db, controller } = setup(fresh());
  const { questions } = (await call(controller.get, {})).body;
  assert.deepEqual(questions.map((q) => [q.id, q.answer, q.allowed]), [['options', true, true], ['website', true, true], ['payment', false, true]]);
  assert.equal(questions[0].hint, 'Active : Ressources à l’heure, Linge et blanchisserie, Arrivée et départ guidés.');
  assert.equal(questions[2].hint, 'Active : Paiement en ligne (Qonto).');
  db.close();
});

test('rule 43: a question whose plugins are active is settled — on, disabled, and says where it changes', async () => {
  const states = fresh();
  states['online-payment'] = 'active';
  states.sas = 'active';
  const { db, controller } = setup(states);
  const { questions } = (await call(controller.get, {})).body;
  const payment = questions.find((q) => q.id === 'payment');
  assert.deepEqual([payment.answer, payment.settled, payment.hint], [true, true, 'Déjà actif ; se désactive dans Paramètres › Plugins.']);
  const options = questions.find((q) => q.id === 'options');
  assert.deepEqual([options.settled, options.hint], [true, 'Déjà en partie actif ; le reste se règle dans Paramètres › Plugins.']);
  assert.equal(questions.find((q) => q.id === 'website').settled, false);
  db.close();
});

test('rule 43: a « oui » to a settled question installs nothing (a SAS-only instance gets no hourly resources nor linen)', async () => {
  const states = fresh();
  states.sas = 'active';
  const { db, controller, calls } = setup(states);
  await call(controller.savePlugins, { body: { answers: { options: true, website: false, payment: false } } });
  assert.deepEqual(calls, []);
  db.close();
});

test('rule 43: a question whose plugins the plan excludes is off, with the plan that includes them', async () => {
  const { db, controller } = setup(fresh(), { outOfPlan: ['online-payment'] });
  const payment = (await call(controller.get, {})).body.questions.find((q) => q.id === 'payment');
  assert.deepEqual([payment.allowed, payment.answer, payment.plan, payment.hint], [false, false, 'Forfait Premium', null]);
  db.close();
});

test('rule 43: each « oui » installs its plugins in order; a « non » switches nothing off', async () => {
  const states = fresh();
  states.neat = 'active';
  states['website-booking'] = 'active';
  const { db, controller, calls } = setup(states);
  const { body } = await call(controller.savePlugins, { body: { answers: { options: true, website: false, payment: true } } });
  assert.deepEqual(calls, ['install:hourly-resources', 'install:linen', 'install:sas', 'install:online-payment']);
  assert.ok(body.results.every((r) => r.ok));
  assert.equal(states['website-booking'], 'active', 'a « non » leaves an active plugin alone');
  db.close();
});

test('rule 43: anything but true installs nothing; a body without answers is refused', async () => {
  const { db, controller, calls } = setup(fresh());
  await call(controller.savePlugins, { body: { answers: { options: 'yes', website: 1 } } });
  assert.deepEqual(calls, []);
  const refused = await call(controller.savePlugins, { body: { ids: ['neat'] } });
  assert.deepEqual([refused.status, refused.body.error], [400, 'ONBOARDING_ANSWERS_REQUIRED']);
  assert.equal((await call(controller.savePlugins, { body: { answers: [] } })).status, 400);
  assert.deepEqual(calls, []);
  db.close();
});
