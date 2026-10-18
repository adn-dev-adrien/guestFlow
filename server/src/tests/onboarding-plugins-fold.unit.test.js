// specs/plugins-phase-p-productisation.md rule 36 — step « Plugins »: a plugin neither recommended nor
// active is marked `more`, so the assistant folds it under « Pour aller plus loin ».

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb } = require('./guestEmailSequenceFixtures');
const { applyProductisationSchema } = require('../utils/productisationMigration');
const { buildController } = require('../controllers/onboardingController');

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

test('rule 36: recommended or active plugins stay in front, the others are « more »', async () => {
  const db = freshDb();
  applyProductisationSchema(db);
  db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  let row = {};
  const states = { 'website-booking': 'available', sas: 'inactive', neat: 'available', weather: 'active' };
  const plugins = {
    list: (req, res) => res.json(Object.entries(states).map(([id, state]) => ({ id, name: id, description: id, state, outOfPlan: false, planChip: null }))),
  };
  const controller = buildController({
    database: db,
    settingsModel: { read: () => row, upsert: (p) => { row = { ...row, ...p }; } },
    propertiesModel: { count: () => 0, create: async () => ({ id: 1 }) },
    plugins,
    ensureVapid: () => {},
  });
  const list = (await call(controller.get, {})).body.plugins;
  const more = Object.fromEntries(list.map((p) => [p.id, p.more]));
  assert.deepEqual(more, { 'website-booking': false, sas: false, neat: true, weather: false });
  db.close();
});
