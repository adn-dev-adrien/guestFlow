const test = require('node:test');
const assert = require('node:assert/strict');

const authController = require('../controllers/authController');

// Fake users model. Tracks touchLastLogin calls so the test for the new behaviour can assert it.
// Each user row is stored under its id so tests can mutate the "DB" between calls and verify
// that `me` re-reads from it (regression 2026-06-02 — the "Mes informations" form on /account
// was returning the stale session snapshot instead of the fresh row).
function fakeUsers(initialRows = null) {
  const passwords = { 1: 'ChangeMe!2026' };
  const flags = { 1: { mustChangePassword: true } };
  const calls = { touchLastLogin: [], findById: [] };
  const rows = initialRows || {
    1: { id: 1, email: 'admin@guestflow.local', firstName: '', lastName: '', companyName: '', notes: '', roles: ['admin'], mustChangePassword: true },
  };
  return {
    calls,
    rows, // tests can mutate this between calls to simulate side-channel updates
    verifyCredentials(email, pw) {
      if (email !== 'admin@guestflow.local') return null;
      if (pw !== passwords[1]) return null;
      return { ...rows[1], mustChangePassword: flags[1].mustChangePassword };
    },
    findById(id) {
      calls.findById.push(id);
      return rows[id] ? { ...rows[id] } : null;
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

test('me: returns the fresh DB row (NOT the stale session snapshot) — 2026-06-02 regression', () => {
  // Regression: pre-2026-06-02, `me` returned `req.session.user` verbatim. Because sessions
  // are persisted in SQLite across deploys, long-lived sessions held a snapshot of the user
  // taken at LOGIN time — any subsequent edit (admin updating the user, the user's own
  // companyName/notes being filled later, even the addition of new safe-user fields after
  // a schema migration) wouldn't reach the response. The "Mes informations" form on
  // /account stayed pre-filled with the stale values. Now `me` always re-reads from DB and
  // refreshes `req.session.user` so the next middleware pass sees the new shape too.
  const users = fakeUsers();
  // Session was set at login when the user had no companyName / notes; an admin then
  // edited the row in the DB (or the columns were added later). Without the fix the form
  // would render empty fields.
  users.rows[1].companyName = 'Adn Dev SARL';
  users.rows[1].notes = 'Note ajoutée par l\'admin après la connexion.';
  const c = authController.create(users);

  const session = { user: { id: 1, email: 'admin@guestflow.local' /* stale, no companyName */ } };
  const res = fakeRes();
  c.me({ session }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.companyName, 'Adn Dev SARL', 'response must reflect the fresh DB row');
  assert.equal(res.body.notes, 'Note ajoutée par l\'admin après la connexion.');
  // Side-effect: session refreshed inline so next request reads the fresh shape too.
  assert.equal(session.user.companyName, 'Adn Dev SARL');
  // findById was called exactly once with the session user's id.
  assert.deepEqual(users.calls.findById, [1]);
});

test('me: no session → 401 UNAUTHENTICATED', () => {
  const c = authController.create(fakeUsers());
  const res = fakeRes();
  c.me({ session: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'UNAUTHENTICATED');
});

test('me: session user has been deleted in DB → destroy session + 401', () => {
  // Defense in depth: if the underlying user was hard-deleted by an admin while the session
  // was still live, the session becomes stale + invalid. We tear it down so the next
  // request lands on the login screen instead of churning on a phantom session.
  const users = fakeUsers();
  delete users.rows[1];
  const c = authController.create(users);
  const session = fakeSession({ id: 1, email: 'gone@x.com' });
  const res = fakeRes();
  c.me({ session }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(session.destroyed, true, 'session must be destroyed when the user is gone');
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
