/**
 * specs/shell-and-home-day-first.md rules 6, 8 — GET /api/dashboard/attention is an admin read, and
 * every core subject wired in routes/dashboard.js has a server summary and a client component.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const enforceRoleAccess = require('../middleware/enforceRoleAccess');
const { CORE_SUMMARIES } = require('../utils/dashboardAttention');
const { coreAttentionSources } = require('../routes/dashboard');

function call(roles) {
  const req = { user: { roles }, method: 'GET', path: '/dashboard/attention' };
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json() { return this; } };
  let passed = false;
  enforceRoleAccess(req, res, () => { passed = true; });
  return { passed, status: res.statusCode };
}

test('rule 8: reception and accountant are refused the attention read; an admin passes', () => {
  assert.deepEqual(call(['reception']), { passed: false, status: 403 });
  assert.deepEqual(call(['accountant']), { passed: false, status: 403 });
  assert.equal(call(['admin']).passed, true);
});

test('rule 8: a support session skips the 2FA nudge; an admin session reads it', () => {
  const twoFactor = coreAttentionSources().find((source) => source.key === 'two-factor');
  assert.equal(twoFactor.skip({ session: { user: { id: 1, isSupport: true } } }), true);
  assert.equal(twoFactor.skip({ session: { user: { id: 1, isSupport: false } } }), false);
});

test('rule 6: every core key has a server summary and a client component, and nothing more', () => {
  const keys = coreAttentionSources().map((source) => source.key).sort();
  assert.deepEqual(Object.keys(CORE_SUMMARIES).sort(), keys);
  const client = fs.readFileSync(path.join(__dirname, '../../../client/src/components/attentionSubjects.js'), 'utf8');
  const block = client.slice(client.indexOf('CORE_ATTENTION_SUBJECTS'));
  const clientKeys = [...block.matchAll(/^\s+'([a-z0-9-]+)':/gm)].map((m) => m[1]).sort();
  assert.deepEqual(clientKeys, keys);
});
