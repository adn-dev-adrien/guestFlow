// specs/gate-access-sowel-connector.md §3.4 rule 22 — reception runs the SAS, so it READS the gate
// access (the code and its QR). It can change nothing: nobody can from here, the actions live in
// Sowel.

const test = require('node:test');
const assert = require('node:assert/strict');

const enforceRoleAccess = require('../middleware/enforceRoleAccess');

function call({ roles, method, path }) {
  const req = { user: { roles }, method, path };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json() { return this; },
  };
  let nextCalled = false;
  enforceRoleAccess(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

test('reception reads a reservation gate access', () => {
  const { nextCalled } = call({ roles: ['reception'], method: 'GET', path: '/reservations/42/gate-access' });
  assert.equal(nextCalled, true);
});

test('it can write nothing there — there is nothing to write anyway', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const { nextCalled, res } = call({ roles: ['reception'], method, path: '/reservations/42/gate-access' });
    assert.equal(nextCalled, false, method);
    assert.equal(res.statusCode, 403, method);
  }
});

test('the accountant has no business with a gate code', () => {
  const { nextCalled } = call({ roles: ['accountant'], method: 'GET', path: '/reservations/42/gate-access' });
  assert.equal(nextCalled, false);
});

test('a sibling route does not pass for all that', () => {
  assert.equal(
    call({ roles: ['reception'], method: 'GET', path: '/reservations/42/gate-access/journal' }).nextCalled,
    false,
  );
});
