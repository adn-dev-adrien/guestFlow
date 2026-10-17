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

// specs/security-auth-encryption.md rule 3 with specs/hosting-h2-account-security.md rule 21 — the
// support account is never active (no password login); the session its sign-in link opened carries the
// access id, and supportAudit decides whether that access still holds.
test('an open support session passes although the support account is inactive', () => {
  const support = { id: 9, email: 'support@guestflow.invalid', roles: ['admin'], isActive: false, isSupport: true, mustChangePassword: false };
  const users = fakeUsers({ 9: support });
  const res = fakeRes();
  let nextCalled = false;
  const session = { ...fakeSession({ id: 9 }), supportAccessId: 3 };
  const req = { session };
  requireAuth.create(users)(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.user.id, 9);
  assert.equal(session.destroyed, false);
});

test('the inactive support account without an open access is rejected like any deactivated user', () => {
  const users = fakeUsers({ 9: { id: 9, roles: ['admin'], isActive: false, isSupport: true, mustChangePassword: false } });
  const res = fakeRes();
  const session = fakeSession({ id: 9 });
  requireAuth.create(users)({ session }, res, () => assert.fail('next must not run'));
  assert.equal(res.statusCode, 401);
  assert.equal(session.destroyed, true);
});
