// specs/hosting-h2-account-security.md rules 23–24 — the bootstrap login becomes the company email of
// the start assistant, so « Mot de passe oublié » reaches someone (rule 23); the code that confirmed
// an authenticator app cannot also open a session in the same step (rule 24).

const test = require('node:test');
const assert = require('node:assert/strict');

const { setup, fakeRes, fakeSession, codeAt } = require('./accountSecurityFixture');
const authController = require('../controllers/authController');
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

const COMPANY = { name: 'Les Cabanes du Lac', email: 'Contact@Cabanes-du-Lac.fr', phone: '', address: '', siret: '' };

test('rule 23: the bootstrap login becomes the company email typed at step 1', async () => {
  const h = setup();
  const admin = h.addUser(DEFAULT_ADMIN_EMAIL);
  const res = await call(onboarding(h.users).saveCompany, { body: COMPANY, user: admin });
  assert.equal(res.status, 200);
  assert.equal(res.body.loginEmail, 'contact@cabanes-du-lac.fr');
  assert.equal(res.body.loginChanged, true);
  assert.equal(h.users.findById(admin.id).email, 'contact@cabanes-du-lac.fr');

  // « Mot de passe oublié » now mails the company address.
  await h.passwordReset.request({ email: 'contact@cabanes-du-lac.fr', ip: '10.0.0.1' }).delivery;
  assert.equal(h.mailer.sent.length, 1);
  assert.equal(h.mailer.sent[0].to, 'contact@cabanes-du-lac.fr');
});

test('rule 23: a login the owner chose, or an address another account holds, is kept', async () => {
  const h = setup();
  const own = h.addUser('claire@exemple.fr');
  const kept = await call(onboarding(h.users).saveCompany, { body: COMPANY, user: own });
  assert.deepEqual([kept.body.loginEmail, kept.body.loginChanged], ['claire@exemple.fr', false]);

  const other = setup();
  const admin = other.addUser(DEFAULT_ADMIN_EMAIL);
  other.addUser('contact@cabanes-du-lac.fr', { roles: ['reception'] });
  const clash = await call(onboarding(other.users).saveCompany, { body: COMPANY, user: admin });
  assert.equal(clash.status, 200);
  assert.deepEqual([clash.body.loginEmail, clash.body.loginChanged], [DEFAULT_ADMIN_EMAIL, false]);
});

test('rule 24: the code that confirmed the enrolment does not open a session in the same step', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const started = await h.twoFactor.start(marie, { method: 'totp', password: 'correct horse battery' });
  const secret = started.secret.replace(/\s/g, '');
  const code = codeAt(secret, h.now());
  h.twoFactor.confirm(marie, { code });

  const c = authController.create(h.users, { twoFactor: h.twoFactor, now: h.now });
  const session = fakeSession();
  const login = fakeRes();
  await Promise.resolve(c.login({ body: { email: 'marie@domaine-ombre.fr', password: 'correct horse battery' }, session, headers: { cookie: '' } }, login, (e) => { throw e; }));
  assert.equal(login.body.step, 'second-factor');
  const reused = fakeRes();
  c.verifySecondFactor({ body: { code }, session, headers: {} }, reused, (e) => { throw e; });
  assert.equal(reused.statusCode, 401);

  // The next step's code is accepted.
  h.now.advance(30000);
  const next = fakeRes();
  c.verifySecondFactor({ body: { code: codeAt(secret, h.now()) }, session, headers: {} }, next, (e) => { throw e; });
  assert.equal(next.statusCode, 200);
});
