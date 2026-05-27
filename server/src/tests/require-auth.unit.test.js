const test = require('node:test');
const assert = require('node:assert/strict');

const requireAuth = require('../middleware/requireAuth');

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('no session → 401 UNAUTHENTICATED', () => {
  const res = fakeRes();
  let nextCalled = false;
  requireAuth({ session: undefined }, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'UNAUTHENTICATED');
  assert.equal(nextCalled, false);
});

test('restricted session (mustChangePassword) → 403 PASSWORD_CHANGE_REQUIRED', () => {
  const res = fakeRes();
  let nextCalled = false;
  requireAuth({ session: { user: { id: 1, email: 'a@b.c', mustChangePassword: true } } }, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal(nextCalled, false);
});

test('full session → next() and req.user attached', () => {
  const res = fakeRes();
  let nextCalled = false;
  const req = { session: { user: { id: 1, email: 'a@b.c', mustChangePassword: false } } };
  requireAuth(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
  assert.equal(req.user.email, 'a@b.c');
});
