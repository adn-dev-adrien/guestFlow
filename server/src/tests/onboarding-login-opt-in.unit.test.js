// specs/hosting-h2-account-security.md rule 37 (audit 2026-10-27) — saving « Entreprise » in the start
// assistant used to replace the bootstrap login with the company e-mail silently; an operator who kept
// typing the old login was locked out. The login now changes only on an explicit opt-in.
const test = require('node:test');
const assert = require('node:assert/strict');

const { setup } = require('./accountSecurityFixture');
const { buildController } = require('../controllers/onboardingController');
const { freshDb } = require('./guestEmailSequenceFixtures');
const { applyProductisationSchema } = require('../utils/productisationMigration');
const { DEFAULT_ADMIN_EMAIL } = require('../constants/authDefaults');

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

function onboarding(users) {
  const db = freshDb();
  applyProductisationSchema(db);
  db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  let row = {};
  const settingsModel = { read: () => row, upsert: (p) => { row = { ...row, ...p }; } };
  return buildController({ database: db, settingsModel, propertiesModel: {}, plugins: { list: (q, r) => r.json([]) }, usersModel: users });
}

const COMPANY = { name: 'Les Cabanes du Lac', email: 'contact@cabanes-du-lac.fr', phone: '', address: '', siret: '' };

test('rule 37: without the opt-in, saving the company keeps the bootstrap login', async () => {
  const h = setup();
  const admin = h.addUser(DEFAULT_ADMIN_EMAIL);
  const res = await call(onboarding(h.users).saveCompany, { body: COMPANY, user: admin });
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.loginEmail, res.body.loginChanged], [DEFAULT_ADMIN_EMAIL, false]);
  assert.equal(h.users.findById(admin.id).email, DEFAULT_ADMIN_EMAIL);
});

test('rule 37: only a literal `useAsLogin: true` changes it — a truthy string does not', async () => {
  const h = setup();
  const admin = h.addUser(DEFAULT_ADMIN_EMAIL);
  await call(onboarding(h.users).saveCompany, { body: { ...COMPANY, useAsLogin: 'yes' }, user: admin });
  assert.equal(h.users.findById(admin.id).email, DEFAULT_ADMIN_EMAIL);
  const res = await call(onboarding(h.users).saveCompany, { body: { ...COMPANY, useAsLogin: true }, user: admin });
  assert.equal(res.body.loginChanged, true);
  assert.equal(h.users.findById(admin.id).email, 'contact@cabanes-du-lac.fr');
});

test('rule 37: GET /api/onboarding tells the step whether to offer the opt-in', async () => {
  const h = setup();
  const admin = h.addUser(DEFAULT_ADMIN_EMAIL);
  const own = h.addUser('claire@exemple.fr');
  const ctrl = onboarding(h.users);
  assert.equal((await call(ctrl.get, { user: admin })).body.login.canAdopt, true);
  assert.equal((await call(ctrl.get, { user: own })).body.login.canAdopt, false);
});
