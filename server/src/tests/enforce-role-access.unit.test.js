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

function call({ role, roles, method = 'GET', path }) {
  // Backwards-compat shim for the legacy single-role tests below: a `role` arg becomes a 1-item
  // roles array (the production middleware now reads req.user.roles only).
  const userRoles = roles || (role ? [role] : null);
  const req = { user: userRoles ? { roles: userRoles } : null, method, path };
  const res = fakeRes();
  let nextCalled = false;
  enforceRoleAccess(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

test('admin: any method / any path → passes', () => {
  assert.equal(call({ role: 'admin', method: 'GET', path: '/reservations' }).nextCalled, true);
  assert.equal(call({ role: 'admin', method: 'DELETE', path: '/clients/9' }).nextCalled, true);
});

// specs/plugins-phase-2-hosts.md rule 3 — the journal, the CSV and the account plan are entries of the
// accounting-export plugin (plugins/accounting-export/tests/phase-2-accounting-export.unit.test.js).
// No plugin is registered here: the core alone grants the accountant none of them.
test('accountant: the core alone does not open the export routes', () => {
  for (const [method, path] of [
    ['GET', '/accounting/sales.csv'], ['GET', '/accounting/sales'], ['GET', '/accounting/platforms'],
    ['GET', '/accounting/platform-accounts'], ['PUT', '/accounting/platform-accounts'],
    ['POST', '/accounting/platform-accounts/refresh'],
  ]) {
    const { res, nextCalled } = call({ role: 'accountant', method, path });
    assert.equal(nextCalled, false, `${method} ${path}`);
    assert.equal(res.statusCode, 403);
  }
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

// specs/cancellation-compensation.md §3.3 rule 21 — the accountant reads the compensations, but never
// writes them. The read is core (specs/plugins-phase-2-hosts.md rules 3 and 21).
test('accountant: GET the cancellation compensations → passes, every write → 403', () => {
  assert.equal(call({ role: 'accountant', method: 'GET', path: '/accounting/cancellation-compensations' }).nextCalled, true);
  const writes = [
    ['POST', '/accounting/cancellation-compensations'],
    ['PUT', '/accounting/cancellation-compensations/3'],
    ['POST', '/accounting/cancellation-compensations/3/receive'],
    ['POST', '/accounting/cancellation-compensations/3/reopen'],
    ['DELETE', '/accounting/cancellation-compensations/3'],
  ];
  for (const [method, path] of writes) {
    const { res, nextCalled } = call({ role: 'accountant', method, path });
    assert.equal(nextCalled, false, `${method} ${path}`);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'FORBIDDEN_ROLE');
  }
});

// specs/accountant-accounting-export.md rule 18
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

// Multi-role coverage (specs/admin-account-management.md): the middleware reads `req.user.roles`.
test('multi-role: admin + accountant combined → admin wins (unrestricted)', () => {
  assert.equal(call({ roles: ['admin', 'accountant'], method: 'DELETE', path: '/reservations/9' }).nextCalled, true);
  assert.equal(call({ roles: ['accountant', 'admin'], method: 'POST', path: '/clients' }).nextCalled, true);
});

test('multi-role: empty roles array → 403 (fail-closed, treated like no known role)', () => {
  const { res, nextCalled } = call({ roles: [], method: 'GET', path: '/accounting/sales.csv' });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test('multi-role: accountant-only reaches /users/me (self route) but not /users', () => {
  assert.equal(call({ roles: ['accountant'], method: 'GET', path: '/users/me' }).nextCalled, true);
  const { res, nextCalled } = call({ roles: ['accountant'], method: 'GET', path: '/users' });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});
