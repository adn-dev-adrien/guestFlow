// specs/hosting-h2-account-security.md rule 67 (audit R21, public finding 3) — anonymous, no key: a login or a
// reset whose fields are not strings is the normal refusal, not a 500 thrown by String({"toString":1}).
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, fakeRes, fakeSession } = require('./accountSecurityFixture');
const authController = require('../controllers/authController');

const EVIL = JSON.parse('{"toString":1}');
const NOT_STRINGS = [EVIL, {}, [], ['a@b.fr'], true, 1];

function login(h, body) {
  const c = authController.create(h.users, { passwordReset: h.passwordReset });
  const res = fakeRes();
  c.login({ body, ip: '1.1.1.1', session: fakeSession(), headers: {} }, res, (err) => { throw err; });
  return res;
}

test('rule 67 — login: an email or a password that is not a string is MISSING_CREDENTIALS', () => {
  const h = setup();
  h.addUser('marie@domaine-ombre.fr');
  for (const value of NOT_STRINGS) {
    const noEmail = login(h, { email: value, password: 'x' });
    assert.equal(noEmail.statusCode, 400, JSON.stringify(value));
    assert.deepEqual(noEmail.body, { error: 'MISSING_CREDENTIALS' });
    const noPassword = login(h, { email: 'marie@domaine-ombre.fr', password: value });
    assert.equal(noPassword.statusCode, 400, JSON.stringify(value));
    assert.deepEqual(noPassword.body, { error: 'MISSING_CREDENTIALS' });
  }
  assert.equal(login(h, { email: 'marie@domaine-ombre.fr', password: 'wrong password' }).statusCode, 401);
});

test('rule 67 — the model itself never throws on such a value', () => {
  const h = setup();
  for (const value of NOT_STRINGS) {
    assert.equal(h.users.verifyCredentials(value, 'x'), null);
    assert.equal(h.users.verifyCredentials('marie@domaine-ombre.fr', value), null);
  }
});

test('rule 67 — reset: a password or a token that is not a string is the normal 400, and spends no token', async () => {
  const h = setup();
  h.addUser('marie@domaine-ombre.fr');
  await h.passwordReset.request({ email: 'marie@domaine-ombre.fr', ip: '1.1.1.1' }).delivery;
  const token = /token=([A-Za-z0-9_-]+)/.exec(h.mailer.sent[0].text)[1];
  for (const value of NOT_STRINGS) {
    assert.throws(() => h.passwordReset.reset({ token, password: value }), (e) => e.status === 400 && e.body.error === 'PASSWORD_TOO_SHORT', JSON.stringify(value));
    assert.throws(() => h.passwordReset.reset({ token: value, password: 'a brand new password' }), (e) => e.status === 400 && e.body.error === 'INVALID_TOKEN', JSON.stringify(value));
  }
  assert.equal(h.passwordReset.check(token).valid, true);
});

test('rule 67 — over the controller, reset answers its 400 as JSON', () => {
  const h = setup();
  const c = authController.create(h.users, { passwordReset: h.passwordReset });
  const res = fakeRes();
  c.resetPassword({ body: { token: 'x', password: EVIL }, session: fakeSession() }, res, (err) => { throw err; });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'PASSWORD_TOO_SHORT');
});
