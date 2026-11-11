// specs/plugins-phase-2-hosts.md rule 34 — the platform badge colours and names are non-sensitive
// display config that the shell loads for every role: the accountant reads them (as reception does),
// nothing else of the property routes, and no write.

const test = require('node:test');
const assert = require('node:assert/strict');
const enforceRoleAccess = require('../middleware/enforceRoleAccess');

const run = (user, method, path) => {
  let outcome = 'next';
  enforceRoleAccess({ user, method, path }, { status(code) { outcome = code; return { json() {} }; } }, () => { outcome = 'ok'; });
  return outcome;
};
const accountant = { roles: ['accountant'] };

test('rule 34: the accountant reads the platform colours', () => {
  assert.equal(run(accountant, 'GET', '/properties/platform-colors'), 'ok');
});

test('rule 34: the accountant still has no other property route and no write', () => {
  assert.equal(run(accountant, 'GET', '/properties'), 403);
  assert.equal(run(accountant, 'GET', '/properties/1'), 403);
  assert.equal(run(accountant, 'PUT', '/properties/platform-colors'), 403);
  assert.equal(run(accountant, 'POST', '/properties/platform-colors'), 403);
});
