// specs/plugins-phase-2-hosts.md rule 33 (authz L4, amends rule 3) — a plugin's role allowlist
// entries and webhook exemptions count while the plugin is live, and the allowlist only on paths the
// plugin serves itself: an entry aimed at a core route stays inert.
const test = require('node:test');
const assert = require('node:assert/strict');

const registry = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');
const loader = require('../plugins/loader');

const matches = (role, method, path) => loader.roleMatchers(role).some((m) => m.method === method && m.re.test(path));

function declare(live) {
  registry.reset();
  registry.configure({ isActive: () => live, allows: () => true });
  const ctx = createContext('accounting-export', {});
  ctx.route('get', '/api/accounting/own/:id', () => {});
  ctx.roleAccess('accountant', [
    { method: 'GET', re: /^\/accounting\/own\/\d+$/ },
    { method: 'GET', re: /^\/clients/ },
  ]);
  ctx.webhook('/api/accounting/hook', () => {});
  return ctx;
}

test('authz L4: an entry on the plugin\'s own route counts, one on a core route does not', () => {
  declare(true);
  assert.equal(matches('accountant', 'GET', '/accounting/own/12'), true);
  assert.equal(matches('accountant', 'GET', '/clients'), false);
  assert.equal(matches('accountant', 'GET', '/clients/3'), false);
  registry.reset();
});

test('authz L4: an inactive plugin contributes neither role entries nor a webhook exemption', () => {
  declare(false);
  assert.equal(matches('accountant', 'GET', '/accounting/own/12'), false);
  assert.equal(loader.isWebhook('POST', '/accounting/hook'), false);
  registry.reset();
  declare(true);
  assert.equal(loader.isWebhook('POST', '/accounting/hook'), true);
  assert.equal(loader.isWebhook('GET', '/accounting/hook'), false);
  registry.reset();
});
