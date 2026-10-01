// specs/plugins-phase-2-hosts.md §3.A — what the SDK gains in phase 2: a reviewed list of core modules
// a plugin may call, and allowlist entries for every restricted role, not only reception. The four
// moved plugins carry their own tests in `plugins/<id>/tests/`.
const test = require('node:test');
const assert = require('node:assert/strict');

const registry = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');
const loader = require('../plugins/loader');
const sdk = require('../plugins/sdk');
const enforceRoleAccess = require('../middleware/enforceRoleAccess');

function guard(user, method, path) {
  let passed = false;
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json() { return this; } };
  enforceRoleAccess({ user, method, path }, res, () => { passed = true; });
  return passed;
}

test('rule 2 — a plugin reaches only the core modules of the reviewed list', () => {
  assert.ok(sdk.CORE_MODULE_NAMES.includes('database'));
  assert.equal(sdk.coreModule('settingsModel'), require('../models/settingsModel'));
  assert.throws(() => sdk.coreModule('usersModel'), /not exposed to plugins/);
  assert.throws(() => sdk.coreModule('../../models/usersModel'), /not exposed to plugins/);
});

test('rule 3 — roleAccess entries join the guard of their role only; reception() is its shorthand', () => {
  registry.reset();
  const ctx = createContext('accounting-export', {});
  ctx.roleAccess('accountant', [{ method: 'GET', re: /^\/phase2-probe$/ }]);
  ctx.reception([{ method: 'GET', re: /^\/phase2-reception-probe$/ }]);
  assert.throws(() => ctx.roleAccess('admin', []), /unknown role/);

  assert.deepEqual(loader.roleMatchers('accountant').map((m) => m.pluginId), ['accounting-export']);
  assert.equal(loader.receptionMatchers().length, 1);

  const accountant = { roles: ['accountant'] };
  const reception = { roles: ['reception'] };
  assert.equal(guard(accountant, 'GET', '/phase2-probe'), true);
  assert.equal(guard(reception, 'GET', '/phase2-probe'), false);
  assert.equal(guard(reception, 'GET', '/phase2-reception-probe'), true);
  assert.equal(guard(accountant, 'GET', '/phase2-reception-probe'), false);
  registry.reset();
});
