// specs/hosting-h2-account-security.md rule 37 (audit 2026-10-27) — saving « Entreprise » in the start
// assistant used to replace the bootstrap login with the company e-mail silently; an operator who kept
// typing the old login was locked out. The login now changes only on an explicit opt-in.
const test = require('node:test');
const assert = require('node:assert/strict');

const sessionsModel = require('../models/sessionsModel');
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

function onboarding(h, sessionsOverride) {
  const db = freshDb();
  applyProductisationSchema(db);
  db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  let row = {};
  const settingsModel = { read: () => row, upsert: (p) => { row = { ...row, ...p }; } };
  return buildController({ database: db, settingsModel, propertiesModel: {}, plugins: { list: (q, r) => r.json([]) }, usersModel: h.users, sessionsModel: { ...sessionsModel.buildModel(h.db), ...sessionsOverride }, reauthenticate: h.twoFactor.reauthenticateForChange });
}

const COMPANY = { name: 'Les Cabanes du Lac', email: 'contact@cabanes-du-lac.fr', phone: '', address: '', siret: '' };

test('rule 37: without the opt-in, saving the company keeps the bootstrap login', async () => {
  const h = setup();
  const admin = h.addUser(DEFAULT_ADMIN_EMAIL);
  const res = await call(onboarding(h).saveCompany, { body: COMPANY, user: admin });
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.loginEmail, res.body.loginChanged], [DEFAULT_ADMIN_EMAIL, false]);
  assert.equal(h.users.findById(admin.id).email, DEFAULT_ADMIN_EMAIL);
});

test('rule 37: only a literal `useAsLogin: true` changes it — a truthy string does not', async () => {
  const h = setup();
  const admin = h.addUser(DEFAULT_ADMIN_EMAIL);
  await call(onboarding(h).saveCompany, { body: { ...COMPANY, useAsLogin: 'yes' }, user: admin });
  assert.equal(h.users.findById(admin.id).email, DEFAULT_ADMIN_EMAIL);
  const res = await call(onboarding(h).saveCompany, { body: { ...COMPANY, useAsLogin: true, currentPassword: 'correct horse battery' }, user: admin });
  assert.equal(res.body.loginChanged, true);
  assert.equal(h.users.findById(admin.id).email, 'contact@cabanes-du-lac.fr');
});

test('rule 37: GET /api/onboarding tells the step whether to offer the opt-in', async () => {
  const h = setup();
  const admin = h.addUser(DEFAULT_ADMIN_EMAIL);
  const own = h.addUser('claire@exemple.fr');
  const ctrl = onboarding(h);
  assert.equal((await call(ctrl.get, { user: admin })).body.login.canAdopt, true);
  assert.equal((await call(ctrl.get, { user: own })).body.login.canAdopt, false);
});

test('rule 59: adopting the company email as the login needs the current password — nothing is written without it', async () => {
  const h = setup();
  const admin = h.addUser(DEFAULT_ADMIN_EMAIL);
  const ctrl = onboarding(h);
  const missing = await call(ctrl.saveCompany, { body: { ...COMPANY, useAsLogin: true }, user: admin });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error, 'BAD_PASSWORD');
  const wrong = await call(ctrl.saveCompany, { body: { ...COMPANY, useAsLogin: true, currentPassword: 'nope' }, user: admin });
  assert.equal(wrong.body.error, 'BAD_PASSWORD');
  assert.equal(h.users.findById(admin.id).email, DEFAULT_ADMIN_EMAIL);
  assert.equal(ctrl && (await call(ctrl.get, { user: admin })).body.company.email, '', 'the company was not saved either');
});

test('rule 59: without the opt-in the password is not asked', async () => {
  const h = setup();
  const admin = h.addUser(DEFAULT_ADMIN_EMAIL);
  assert.equal((await call(onboarding(h).saveCompany, { body: COMPANY, user: admin })).status, 200);
});

test('rule 64: adopting the company email as login ends the other sessions and keeps this one', async () => {
  const h = setup();
  const admin = h.addUser(DEFAULT_ADMIN_EMAIL);
  const other = h.addUser('claire@exemple.fr');
  const insert = h.db.prepare('INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)');
  insert.run('here', JSON.stringify({ user: { id: admin.id } }), '2099-01-01');
  insert.run('elsewhere', JSON.stringify({ user: { id: admin.id } }), '2099-01-01');
  insert.run('claire', JSON.stringify({ user: { id: other.id } }), '2099-01-01');
  const session = { user: admin };
  const res = await call(onboarding(h).saveCompany, {
    body: { ...COMPANY, useAsLogin: true, currentPassword: 'correct horse battery' }, user: admin, session, sessionID: 'here',
  });
  assert.equal(res.body.loginChanged, true);
  assert.deepEqual(h.db.prepare('SELECT sid FROM sessions ORDER BY sid').all().map((r) => r.sid), ['claire', 'here']);
  assert.equal(session.user.email, COMPANY.email);
});

test('rule 64: without the opt-in no session is touched', async () => {
  const h = setup();
  const admin = h.addUser(DEFAULT_ADMIN_EMAIL);
  h.db.prepare('INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)').run('elsewhere', JSON.stringify({ user: { id: admin.id } }), '2099-01-01');
  await call(onboarding(h).saveCompany, { body: COMPANY, user: admin, session: { user: admin }, sessionID: 'here' });
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
});

test('rule 65: a failed revoke after the email was written still answers loginChanged: true, and logs it', async () => {
  const h = setup();
  const admin = h.addUser(DEFAULT_ADMIN_EMAIL);
  const ctrl = onboarding(h, { revokeOtherSessionsForUser() { throw new Error('disk I/O error'); } });
  const logged = [];
  const error = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    const session = { user: admin };
    const res = await call(ctrl.saveCompany, {
      body: { ...COMPANY, useAsLogin: true, currentPassword: 'correct horse battery' }, user: admin, session, sessionID: 'here',
    });
    assert.equal(res.status, 200);
    assert.deepEqual([res.body.loginEmail, res.body.loginChanged], [COMPANY.email, true]);
    assert.equal(h.users.findById(admin.id).email, COMPANY.email);
    assert.equal(session.user.email, COMPANY.email);
    assert.ok(logged.some((l) => /disk I\/O error/.test(l)), 'the revoke failure is logged');
  } finally { console.error = error; }
});
