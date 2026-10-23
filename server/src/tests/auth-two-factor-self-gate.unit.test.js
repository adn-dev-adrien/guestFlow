// specs/hosting-h2-account-security.md rule 6 — the user's own second-step routes (/api/auth/2fa/
// status|start|confirm|disable|backup-codes|snooze) are mounted outside requireAuth, so they apply
// its gate themselves: a deleted or deactivated account, or one still on its default password, is
// refused even though its session is still open, and never falls back to the stale session copy.
const test = require('node:test');
const assert = require('node:assert/strict');
const authController = require('../controllers/authController');
const { setup, fakeRes, fakeSession } = require('./accountSecurityFixture');

function call(handler, session, body = {}) {
  const res = fakeRes();
  let passed = null;
  return Promise.resolve(handler({ session, body, headers: {} }, res, (err) => { passed = err; }))
    .then(() => new Promise((resolve) => setImmediate(resolve)))
    .then(() => ({ res, passed }));
}

function harness() {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const c = authController.create(h.users, { twoFactor: h.twoFactor, now: h.now });
  return { h, marie, c };
}

test('rule 6 — an active user reads their own second-step status', async () => {
  const { marie, c } = harness();
  const { res } = await call(c.twoFactorStatus, fakeSession({ user: marie }));
  assert.equal(res.statusCode, 200);
  assert.ok(res.body && typeof res.body === 'object');
});

test('rule 6 — a deactivated account with an open session cannot start, disable or regenerate, and the session ends', async () => {
  const { h, marie, c } = harness();
  h.users.softDelete(marie.id);
  for (const handler of [c.twoFactorStart, c.twoFactorDisable, c.twoFactorRegenerate, c.twoFactorSnooze, c.twoFactorStatus]) {
    const session = fakeSession({ user: marie });
    const { res } = await call(handler, session);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'UNAUTHENTICATED');
    assert.equal(session.destroyed, true);
  }
});

test('rule 6 — a deleted user row never falls back to the session copy', async () => {
  const { h, marie, c } = harness();
  h.db.prepare('DELETE FROM users WHERE id = ?').run(marie.id);
  const { res } = await call(c.twoFactorRegenerate, fakeSession({ user: marie }));
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'UNAUTHENTICATED');
});

test('rule 6 — an account still on its default password gets PASSWORD_CHANGE_REQUIRED', async () => {
  const { h, marie, c } = harness();
  h.db.prepare('UPDATE users SET mustChangePassword = 1 WHERE id = ?').run(marie.id);
  const { res } = await call(c.twoFactorStart, fakeSession({ user: marie }));
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'PASSWORD_CHANGE_REQUIRED');
});

test('rule 6 — no session at all is UNAUTHENTICATED', async () => {
  const { c } = harness();
  const { res } = await call(c.twoFactorStatus, fakeSession({}));
  assert.equal(res.statusCode, 401);
});
