const test = require('node:test');
const assert = require('node:assert/strict');

const authController = require('../controllers/authController');

// Fake users model. Tracks touchLastLogin calls so the test for the new behaviour can assert it.
function fakeUsers() {
  const passwords = { 1: 'ChangeMe!2026' };
  const flags = { 1: { mustChangePassword: true } };
  const calls = { touchLastLogin: [] };
  return {
    calls,
    verifyCredentials(email, pw) {
      if (email !== 'admin@guestflow.local') return null;
      if (pw !== passwords[1]) return null;
      return { id: 1, email, roles: ['admin'], mustChangePassword: flags[1].mustChangePassword };
    },
    updatePassword(id, newPw) {
      passwords[id] = newPw;
      flags[id].mustChangePassword = false;
    },
    touchLastLogin(id) {
      calls.touchLastLogin.push(id);
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

function fakeSession(initialUser = null) {
  return {
    user: initialUser,
    destroyed: false,
    destroy(cb) { this.destroyed = true; if (cb) cb(); },
  };
}

test('login: success sets session.user and returns safe user (now with roles array)', () => {
  const users = fakeUsers();
  const c = authController.create(users);
  const req = { body: { email: 'admin@guestflow.local', password: 'ChangeMe!2026' }, session: {} };
  const res = fakeRes();
  c.login(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.email, 'admin@guestflow.local');
  assert.deepEqual(res.body.roles, ['admin']);
  assert.equal(req.session.user.id, 1);
  assert.equal(res.body.passwordHash, undefined);
  // Last login timestamp is bumped on every successful auth (new behaviour from M2).
  assert.deepEqual(users.calls.touchLastLogin, [1]);
});

test('login: failed auth does NOT touch lastLoginAt', () => {
  const users = fakeUsers();
  const c = authController.create(users);
  const res = fakeRes();
  c.login({ body: { email: 'admin@guestflow.local', password: 'wrong' }, session: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(users.calls.touchLastLogin, []);
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

// ----- change-password: forced first-login flow (new in M2) -----

test('change-password (first login, mustChangePassword=true): destroys the session on success', () => {
  const c = authController.create(fakeUsers());
  const session = fakeSession({ id: 1, email: 'admin@guestflow.local', roles: ['admin'], mustChangePassword: true });
  const res = fakeRes();
  c.changePassword({ session, body: { currentPassword: 'ChangeMe!2026', newPassword: 'a-good-new-password' } }, res);
  assert.equal(res.statusCode, 204);
  assert.equal(session.destroyed, true, 'session destroyed → client must re-login');
});

test('change-password (voluntary, mustChangePassword=false): keeps the session active', () => {
  // Seed the fake users model with a different flag state (no forced change).
  const users = fakeUsers();
  users.verifyCredentials = (email, pw) => (email === 'admin@guestflow.local' && pw === 'OldPwd123456')
    ? { id: 1, email, roles: ['admin'], mustChangePassword: false } : null;
  const c = authController.create(users);
  const session = fakeSession({ id: 1, email: 'admin@guestflow.local', roles: ['admin'], mustChangePassword: false });
  const res = fakeRes();
  c.changePassword({ session, body: { currentPassword: 'OldPwd123456', newPassword: 'NewPwd1234567' } }, res);
  assert.equal(res.statusCode, 204);
  assert.equal(session.destroyed, false, 'session preserved for voluntary changes');
  assert.equal(session.user.mustChangePassword, false);
});

test('change-password: enforces input rules (length, unchanged, wrong current)', () => {
  const c = authController.create(fakeUsers());
  const session = fakeSession({ id: 1, email: 'admin@guestflow.local', roles: ['admin'], mustChangePassword: true });

  let res = fakeRes();
  c.changePassword({ session, body: { currentPassword: 'ChangeMe!2026', newPassword: 'short' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'PASSWORD_TOO_SHORT');

  res = fakeRes();
  c.changePassword({ session, body: { currentPassword: 'ChangeMe!2026', newPassword: 'ChangeMe!2026' } }, res);
  assert.equal(res.body.error, 'PASSWORD_UNCHANGED');

  res = fakeRes();
  c.changePassword({ session, body: { currentPassword: 'wrong', newPassword: 'a-good-new-password' } }, res);
  assert.equal(res.statusCode, 401);
});
