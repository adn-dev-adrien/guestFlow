// specs/hosting-h2-account-security.md rule 68, reading of 2026-11-05 (audit R23-A4) — a role listed twice is one role:
// the stored list does not change, so the user's session stays open.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./inputShapeApp');

let app;
test.before(async () => {
  app = await startApp();
  // The reception role belongs to the arrival plugin; absent from the tree, these rows have no role to name.
  await app.activatePlugins(await app.login('admin@shape.test'), ['sas']);
});
test.after(async () => { if (app) await app.stop(); });

test('rule 68 — ["reception", "reception"] on a reception user changes nothing and logs nobody out', async () => {
  const admin = await app.login('admin@shape.test');
  const reception = await app.login('reception@shape.test');
  const [{ id }] = app.readDb("SELECT id FROM users WHERE email = 'reception@shape.test'");
  const res = await app.call(admin, 'PUT', `/api/users/${id}`, { roles: ['reception', 'reception'] });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.json.user.roles, ['reception']);
  assert.equal((await app.call(reception, 'GET', '/api/auth/me')).status, 200);
});

test('rule 68 — a real change of role still ends the open session', async () => {
  const admin = await app.login('admin@shape.test');
  const accountant = await app.login('accountant@shape.test');
  const [{ id }] = app.readDb("SELECT id FROM users WHERE email = 'accountant@shape.test'");
  const res = await app.call(admin, 'PUT', `/api/users/${id}`, { roles: ['admin', 'admin'] });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.json.user.roles, ['admin']);
  assert.equal((await app.call(accountant, 'GET', '/api/auth/me')).status, 401);
});
