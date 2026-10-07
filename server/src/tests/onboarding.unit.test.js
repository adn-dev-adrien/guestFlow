// specs/plugins-phase-p-productisation.md §3.D rules 20–22 — the start assistant: open for an admin
// until done, each step validated by the server, plugins outside the licence refused, a partial plugin
// failure named, « Plus tard » closes it with what was saved.

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb } = require('./guestEmailSequenceFixtures');
const { applyProductisationSchema } = require('../utils/productisationMigration');
const { buildController } = require('../controllers/onboardingController');
const authController = require('../controllers/authController');

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

function setup({ failing = [] } = {}) {
  const db = freshDb();
  applyProductisationSchema(db);
  db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  let row = {};
  const settingsModel = { read: () => row, upsert: (p) => { row = { ...row, ...p }; } };
  const created = [];
  const propertiesModel = { count: () => created.length, create: async (body) => { created.push(body); return { id: created.length }; } };
  const states = { 'website-booking': 'available', sas: 'inactive', neat: 'available', weather: 'active' };
  const installed = [];
  const plugins = {
    list: (req, res) => res.json(Object.entries(states).map(([id, state]) => ({
      id, name: id, description: `${id} en une ligne`, state, outOfPlan: id === 'neat', planChip: id === 'neat' ? 'Forfait Premium' : null,
    }))),
    install: (req, res) => {
      if (failing.includes(req.params.id)) return res.status(500).json({ error: 'PLUGIN_MIGRATION_FAILED' });
      installed.push(req.params.id);
      return res.json({ ok: true });
    },
    activate: (req, res) => { installed.push(`activate:${req.params.id}`); return res.json({ ok: true }); },
  };
  const vapid = [];
  const controller = buildController({ database: db, settingsModel, propertiesModel, plugins, ensureVapid: (s) => vapid.push(s.companyEmail) });
  return { db, controller, created, installed, vapid, settings: () => row };
}

test('rule 20: open until done, and only an admin is sent to it', async () => {
  const { db, controller } = setup();
  assert.equal((await call(controller.get, {})).body.open, true);
  const me = (roles, open) => authController.create({ findById: () => ({ id: 1, roles }) }, { onboardingOpen: () => open });
  let out;
  me(['admin'], true).me({ session: { user: { id: 1 } } }, { json: (b) => { out = b; } });
  assert.equal(out.onboardingOpen, true);
  me(['reception'], true).me({ session: { user: { id: 1 } } }, { json: (b) => { out = b; } });
  assert.equal(out.onboardingOpen, false);
  await call(controller.done, {});
  assert.equal((await call(controller.get, {})).body.open, false);
  assert.ok(db.prepare('SELECT onboardingCompletedAt FROM app_settings').get().onboardingCompletedAt);
});

test('rule 21, step 1: the company is validated by the server, then saved', async () => {
  const { controller, settings, vapid } = setup();
  const refused = await call(controller.saveCompany, { body: { name: '', email: 'nope', siret: '123' } });
  assert.equal(refused.status, 422);
  assert.deepEqual(refused.body.errors, { name: 'Nom obligatoire', email: 'Adresse invalide', siret: '14 chiffres' });
  assert.deepEqual((await call(controller.saveCompany, { body: { name: 'X' } })).body.errors, { email: 'Adresse obligatoire' });
  const ok = await call(controller.saveCompany, { body: { name: 'Les Tilleuls', email: 'bonjour@tilleuls.fr', siret: '123 456 789 00012' } });
  assert.equal(ok.status, 200);
  assert.equal(settings().companyName, 'Les Tilleuls');
  assert.equal(settings().companySiret, '12345678900012');
  assert.deepEqual(vapid, ['bonjour@tilleuls.fr'], 'push follows the company address (rule 18)');
});

test('rule 21, step 2: beds cover the capacity, 1 to 50 guests, a price ≥ 0', async () => {
  const { controller, created } = setup();
  const short = await call(controller.saveProperty, { body: { name: 'La Grange', doubleBeds: 1, singleBeds: 0, maxGuests: 4, pricePerNight: 90 } });
  assert.equal(short.status, 422);
  assert.match(short.body.errors.maxGuests, /Seulement 2 couchages/);
  const big = await call(controller.saveProperty, { body: { name: 'Gîte', doubleBeds: 30, singleBeds: 0, maxGuests: 60, pricePerNight: 90 } });
  assert.equal(big.body.errors.maxGuests, 'Entre 1 et 50');
  const noPrice = await call(controller.saveProperty, { body: { name: 'Gîte', doubleBeds: 1, maxGuests: 2, pricePerNight: '' } });
  assert.equal(noPrice.body.errors.pricePerNight, 'Prix positif ou nul');
  const ok = await call(controller.saveProperty, { body: { name: 'La Grange', doubleBeds: 1, singleBeds: 2, maxGuests: 4, checkIn: '16:00', checkOut: '10:00', pricePerNight: '90' } });
  assert.equal(ok.status, 200);
  assert.equal(created[0].pricePerNight, 90);
  assert.equal(created[0].defaultCheckIn, '16:00');
});

test('rule 21, step 3: allowed plugins go through, others are refused, a failure is named', async () => {
  const { controller, installed } = setup({ failing: ['website-booking'] });
  const list = (await call(controller.get, {})).body.plugins;
  assert.deepEqual(list.filter((p) => p.recommended).map((p) => p.id).sort(), ['sas', 'website-booking']);
  assert.equal(list.find((p) => p.id === 'neat').plan, 'Forfait Premium');
  const { body } = await call(controller.savePlugins, { body: { ids: ['website-booking', 'sas', 'neat', 'weather'] } });
  assert.deepEqual(body.results, [
    { id: 'website-booking', ok: false, error: 'PLUGIN_MIGRATION_FAILED' },
    { id: 'sas', ok: true },
    { id: 'neat', ok: false, error: 'PLAN_REQUIRED' },
    { id: 'weather', ok: true },
  ]);
  assert.deepEqual(installed, ['activate:sas']);
});

test('rule 22: « Plus tard » closes it and keeps what was saved', async () => {
  const { controller, settings } = setup();
  await call(controller.saveCompany, { body: { name: 'Les Tilleuls', email: 'b@t.fr' } });
  await call(controller.done, {});
  assert.equal((await call(controller.get, {})).body.open, false);
  assert.equal(settings().companyName, 'Les Tilleuls');
});
