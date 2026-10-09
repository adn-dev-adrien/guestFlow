const test = require('node:test');
const assert = require('node:assert/strict');

const requireAuth = require('../middleware/requireAuth');

// requireAuth now RE-VALIDATES the session against the DB on every call (2026-10-08 audit AUTH-1),
// so the tests inject a fake users model through the factory. `rows` can be mutated between calls
// to simulate a side-channel change (deactivation, demotion, deletion) landing mid-session.
function fakeUsers(rows) {
  const store = rows || {
    1: { id: 1, email: 'a@b.c', roles: ['admin'], isActive: true, mustChangePassword: false },
  };
  return {
    calls: { findById: [] },
    store,
    findById(id) {
      this.calls.findById.push(id);
      return store[id] ? { ...store[id] } : null;
    },
  };
}

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function fakeSession(user) {
  return {
    user,
    destroyed: false,
    destroy(cb) { this.destroyed = true; this.user = null; if (cb) cb(); },
  };
}

test('no session → 401 UNAUTHENTICATED (no DB lookup)', () => {
  const users = fakeUsers();
  const res = fakeRes();
  let nextCalled = false;
  requireAuth.create(users)({ session: undefined }, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'UNAUTHENTICATED');
  assert.equal(nextCalled, false);
  assert.deepEqual(users.calls.findById, []);
});

test('fresh row requires password change → 403 PASSWORD_CHANGE_REQUIRED', () => {
  const users = fakeUsers({ 1: { id: 1, email: 'a@b.c', roles: ['admin'], isActive: true, mustChangePassword: true } });
  const res = fakeRes();
  let nextCalled = false;
  const req = { session: fakeSession({ id: 1, email: 'a@b.c', mustChangePassword: false }) };
  requireAuth.create(users)(req, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal(nextCalled, false);
});

test('full session → next() and req.user rebuilt from the DB row', () => {
  const users = fakeUsers();
  const res = fakeRes();
  let nextCalled = false;
  const req = { session: fakeSession({ id: 1, email: 'a@b.c', mustChangePassword: false }) };
  requireAuth.create(users)(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
  assert.equal(req.user.email, 'a@b.c');
  assert.deepEqual(users.calls.findById, [1]);
});

test('deactivated mid-session → 401 and the session is destroyed', () => {
  const users = fakeUsers({ 1: { id: 1, email: 'a@b.c', roles: ['reception'], isActive: false, mustChangePassword: false } });
  const res = fakeRes();
  let nextCalled = false;
  const req = { session: fakeSession({ id: 1, email: 'a@b.c', mustChangePassword: false }) };
  requireAuth.create(users)(req, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'UNAUTHENTICATED');
  assert.equal(req.session.destroyed, true);
  assert.equal(nextCalled, false);
});

test('deleted mid-session (no row) → 401 and the session is destroyed', () => {
  const users = fakeUsers({});
  const res = fakeRes();
  let nextCalled = false;
  const req = { session: fakeSession({ id: 1, email: 'a@b.c', mustChangePassword: false }) };
  requireAuth.create(users)(req, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(req.session.destroyed, true);
  assert.equal(nextCalled, false);
});

test('demoted mid-session → req.user carries the CURRENT roles, not the login snapshot', () => {
  // Session was opened as an admin; the DB row has since been demoted to reception.
  const users = fakeUsers({ 1: { id: 1, email: 'a@b.c', roles: ['reception'], isActive: true, mustChangePassword: false } });
  const res = fakeRes();
  let nextCalled = false;
  const req = { session: fakeSession({ id: 1, email: 'a@b.c', roles: ['admin'], mustChangePassword: false }) };
  requireAuth.create(users)(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.deepEqual(req.user.roles, ['reception']);
  // The persisted snapshot is refreshed too, so enforceRoleAccess downstream sees the new roles.
  assert.deepEqual(req.session.user.roles, ['reception']);
});
