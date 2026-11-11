// specs/security-auth-encryption.md rule 3 — a session waiting for the second step belongs to its user
// too: revoking that user's sessions (deactivation, password reset, role change) ends it, and a user
// deactivated between the password and the code is refused at the code. A session store that fails to
// regenerate the id leaves the login refused, with no user in the session.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const sessionsModelModule = require('../models/sessionsModel');
const authController = require('../controllers/authController');
const { setup, fakeRes, fakeSession, codeAt, enableTotp } = require('./accountSecurityFixture');

function sessionsDb() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE sessions (sid TEXT NOT NULL PRIMARY KEY, sess JSON NOT NULL, expire TEXT NOT NULL)');
  const insert = db.prepare('INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)');
  const add = (sid, sess) => insert.run(sid, JSON.stringify({ cookie: { maxAge: 1000 }, ...sess }), '2099-01-01T00:00:00.000Z');
  const sids = () => db.prepare('SELECT sid FROM sessions ORDER BY sid').all().map((r) => r.sid);
  return { db, add, sids };
}

test('rule 3 — revokeAllForUser also ends the sessions waiting for that user’s second step', () => {
  const { db, add, sids } = sessionsDb();
  add('logged-1', { user: { id: 1 } });
  add('pending-1', { pendingTwoFactor: { userId: 1, at: 0 } });
  add('pending-2', { pendingTwoFactor: { userId: 2, at: 0 } });
  add('logged-2', { user: { id: 2 } });
  add('anonymous', {});
  const removed = sessionsModelModule.buildModel(db).revokeAllForUser(1);
  assert.equal(removed, 2);
  assert.deepEqual(sids(), ['anonymous', 'logged-2', 'pending-2']);
});

test('rule 3 — revokeOtherSessionsForUser keeps the caller’s session and ends a pending one elsewhere', () => {
  const { db, add, sids } = sessionsDb();
  add('current', { user: { id: 1 } });
  add('pending-elsewhere', { pendingTwoFactor: { userId: 1, at: 0 } });
  add('other-user', { pendingTwoFactor: { userId: 3, at: 0 } });
  assert.equal(sessionsModelModule.buildModel(db).revokeOtherSessionsForUser(1, 'current'), 1);
  assert.deepEqual(sids(), ['current', 'other-user']);
});

test('rule 3 — a user deactivated between the password and the code is refused at the code', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const { secret } = await enableTotp(h, marie);
  h.now.advance(60000);
  h.users.softDelete(marie.id);
  assert.throws(() => h.twoFactor.verifyLogin(marie.id, { code: codeAt(secret, h.now()) }), (e) => e.status === 401 && e.body.error === 'NO_PENDING_LOGIN');
  await assert.rejects(() => h.twoFactor.resendLogin(marie.id), (e) => e.body.error === 'NO_PENDING_LOGIN');
});

test('rule 3 — a session id that cannot be regenerated fails the login closed: an error, no user in the session', () => {
  const h = setup();
  h.addUser('marie@domaine-ombre.fr');
  const c = authController.create(h.users, { twoFactor: h.twoFactor, now: h.now });
  const session = fakeSession();
  session.regenerate = (cb) => cb(new Error('store unavailable'));
  const res = fakeRes();
  let passed = null;
  c.login({ body: { email: 'marie@domaine-ombre.fr', password: 'correct horse battery' }, session, headers: {} }, res, (err) => { passed = err; });
  assert.match(String(passed && passed.message), /store unavailable/);
  assert.equal(session.user, undefined);
});
