const test = require('node:test');
const assert = require('node:assert/strict');

const authController = require('../controllers/authController');

// Fake users model with two accounts.
function fakeUsers() {
  const passwords = { 1: 'ChangeMe!2026' };
  const flags = { 1: { mustChangePassword: true } };
  return {
    verifyCredentials(email, pw) {
      if (email !== 'admin@guestflow.local') return null;
      if (pw !== passwords[1]) return null;
      return { id: 1, email, role: 'admin', mustChangePassword: flags[1].mustChangePassword };
    },
    updatePassword(id, newPw) {
      passwords[id] = newPw;
      flags[id].mustChangePassword = false;
    },
  };
}

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    ended: false,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    end() { this.ended = true; return this; },
  };
}

test('login: success sets session.user and returns safe user', () => {
  const c = authController.create(fakeUsers());
  const req = { body: { email: 'admin@guestflow.local', password: 'ChangeMe!2026' }, session: {} };
  const res = fakeRes();
  c.login(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.email, 'admin@guestflow.local');
  assert.equal(req.session.user.id, 1);
  assert.equal(res.body.passwordHash, undefined);
});

test('login: wrong password and unknown email both → 401 INVALID_CREDENTIALS (no enumeration)', () => {
  const c = authController.create(fakeUsers());
  const r1 = fakeRes();
  c.login({ body: { email: 'admin@guestflow.local', password: 'nope' }, session: {} }, r1);
  const r2 = fakeRes();
  c.login({ body: { email: 'ghost@x.com', password: 'whatever' }, session: {} }, r2);
  assert.equal(r1.statusCode, 401);
  assert.equal(r2.statusCode, 401);
  assert.equal(r1.body.error, 'INVALID_CREDENTIALS');
  assert.deepEqual(r1.body, r2.body);
});

test('login: missing fields → 400', () => {
  const c = authController.create(fakeUsers());
  const res = fakeRes();
  c.login({ body: { email: '' }, session: {} }, res);
  assert.equal(res.statusCode, 400);
});

test('me: returns session user or 401', () => {
  const c = authController.create(fakeUsers());
  const ok = fakeRes();
  c.me({ session: { user: { id: 1, email: 'a@b.c' } } }, ok);
  assert.equal(ok.body.email, 'a@b.c');
  const no = fakeRes();
  c.me({ session: {} }, no);
  assert.equal(no.statusCode, 401);
});

test('change-password: enforces rules and clears mustChangePassword on success', () => {
  const c = authController.create(fakeUsers());
  const session = { user: { id: 1, email: 'admin@guestflow.local', role: 'admin', mustChangePassword: true } };

  // too short
  let res = fakeRes();
  c.changePassword({ session, body: { currentPassword: 'ChangeMe!2026', newPassword: 'short' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'PASSWORD_TOO_SHORT');

  // unchanged
  res = fakeRes();
  c.changePassword({ session, body: { currentPassword: 'ChangeMe!2026', newPassword: 'ChangeMe!2026' } }, res);
  assert.equal(res.body.error, 'PASSWORD_UNCHANGED');

  // wrong current
  res = fakeRes();
  c.changePassword({ session, body: { currentPassword: 'wrong', newPassword: 'a-good-new-password' } }, res);
  assert.equal(res.statusCode, 401);

  // success
  res = fakeRes();
  c.changePassword({ session, body: { currentPassword: 'ChangeMe!2026', newPassword: 'a-good-new-password' } }, res);
  assert.equal(res.statusCode, 204);
  assert.equal(session.user.mustChangePassword, false);
});
