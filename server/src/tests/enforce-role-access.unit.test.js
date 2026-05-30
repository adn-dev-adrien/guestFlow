const test = require('node:test');
const assert = require('node:assert/strict');

const enforceRoleAccess = require('../middleware/enforceRoleAccess');

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function call({ role, method = 'GET', path }) {
  const req = { user: role ? { role } : null, method, path };
  const res = fakeRes();
  let nextCalled = false;
  enforceRoleAccess(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

test('admin: any method / any path → passes', () => {
  assert.equal(call({ role: 'admin', method: 'GET', path: '/reservations' }).nextCalled, true);
  assert.equal(call({ role: 'admin', method: 'DELETE', path: '/clients/9' }).nextCalled, true);
});

test('accountant: GET /accounting/sales.csv → passes', () => {
  const { res, nextCalled } = call({ role: 'accountant', method: 'GET', path: '/accounting/sales.csv' });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test('accountant: GET /accounting/platforms → passes', () => {
  assert.equal(call({ role: 'accountant', method: 'GET', path: '/accounting/platforms' }).nextCalled, true);
});

test('accountant: self endpoints (me / logout / change-password / version) → pass', () => {
  for (const path of ['/auth/me', '/auth/logout', '/auth/change-password', '/version']) {
    assert.equal(call({ role: 'accountant', method: 'GET', path }).nextCalled, true, path);
    // Self endpoints are reachable by any method (POST for logout/change-password etc).
    assert.equal(call({ role: 'accountant', method: 'POST', path }).nextCalled, true, `POST ${path}`);
  }
});

test('accountant: POST or DELETE on accounting → 403 (read-only role)', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const { res, nextCalled } = call({ role: 'accountant', method, path: '/accounting/sales.csv' });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'FORBIDDEN_ROLE');
  }
});

test('accountant: any non-accounting / non-self route → 403', () => {
  for (const path of ['/reservations', '/clients', '/settings', '/finance', '/properties/1']) {
    const { res, nextCalled } = call({ role: 'accountant', method: 'GET', path });
    assert.equal(nextCalled, false, path);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'FORBIDDEN_ROLE');
  }
});

test('unknown role → 403 (fail-closed)', () => {
  const { res, nextCalled } = call({ role: 'guest', method: 'GET', path: '/accounting/sales.csv' });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test('no user object → 403 (fail-closed; requireAuth should have caught it but defense in depth)', () => {
  const { res, nextCalled } = call({ role: null, method: 'GET', path: '/accounting/sales.csv' });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});
