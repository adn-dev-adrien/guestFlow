/**
 * Session revalidation + revocation — 2026-10-08 infrastructure audit, findings AUTH-1, AUTH-2, AUTH-6.
 *
 * Covers:
 *   - sessionsModel: revoke all of a user's sessions / all-but-current, keyed on sess.user.id,
 *     and a graceful no-op when the `sessions` table is absent.
 *   - usersController: deactivate, admin password reset and a ROLE change revoke the target's
 *     sessions; a name-only edit does NOT.
 *   - authController: login regenerates the session id; `me` rejects a deactivated user; a
 *     voluntary password change revokes every OTHER session but keeps the caller's.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const sessionsModelModule = require('../models/sessionsModel');
const authController = require('../controllers/authController');
const { buildController } = require('../controllers/usersController');

// ---------- sessionsModel against a real in-memory SQLite, same shape as the store ----------

function makeSessionsDb() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE sessions (sid TEXT NOT NULL PRIMARY KEY, sess JSON NOT NULL, expire TEXT NOT NULL)');
  const insert = db.prepare('INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)');
  const add = (sid, userId) =>
    insert.run(sid, JSON.stringify({ cookie: { maxAge: 1000 }, user: { id: userId, email: `u${userId}@x` } }), '2099-01-01T00:00:00.000Z');
  const count = () => db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
  const sids = () => db.prepare('SELECT sid FROM sessions ORDER BY sid').all().map((r) => r.sid);
  return { db, add, count, sids };
}

test('sessionsModel.revokeAllForUser deletes only that user’s rows', () => {
  const { db, add, count, sids } = makeSessionsDb();
  add('a', 1); add('b', 1); add('c', 2);
  const model = sessionsModelModule.buildModel(db);
  assert.equal(count(), 3);
  const removed = model.revokeAllForUser(1);
  assert.equal(removed, 2);
  assert.deepEqual(sids(), ['c']);
});

test('sessionsModel.revokeOtherSessionsForUser keeps the current session', () => {
  const { db, add, sids } = makeSessionsDb();
  add('cur', 1); add('other1', 1); add('other2', 1); add('x', 2);
  const model = sessionsModelModule.buildModel(db);
  const removed = model.revokeOtherSessionsForUser(1, 'cur');
  assert.equal(removed, 2);
  assert.deepEqual(sids(), ['cur', 'x']);
});

test('sessionsModel: non-integer id is a no-op; absent table does not throw', () => {
  const { db, add, count } = makeSessionsDb();
  add('a', 1);
  const model = sessionsModelModule.buildModel(db);
  assert.equal(model.revokeAllForUser('nope'), 0);
  assert.equal(count(), 1);

  const empty = new Database(':memory:'); // no sessions table at all
  const model2 = sessionsModelModule.buildModel(empty);
  assert.equal(model2.revokeAllForUser(1), 0);
  assert.equal(model2.revokeAll(), 0);
});

// ---------- usersController wiring ----------

function recordingSessions() {
  const calls = [];
  return {
    calls,
    revokeAllForUser(id) { calls.push(['all', Number(id)]); return 0; },
    revokeOtherSessionsForUser(id, keep) { calls.push(['others', Number(id), keep]); return 0; },
    revokeAll() { calls.push(['allGlobal']); return 0; },
  };
}

function usersCtrlFixture(rows) {
  const users = new Map(rows.map((u) => [u.id, { ...u }]));
  const usersModel = {
    findById(id) { const u = users.get(Number(id)); return u ? { ...u } : null; },
    findActiveAdminCount() {
      let n = 0;
      for (const u of users.values()) if (u.isActive && u.roles.includes('admin')) n += 1;
      return n;
    },
    updateUser(id, payload) {
      const u = users.get(Number(id)); if (!u) return null;
      const next = { ...u, ...payload };
      if (Array.isArray(payload.roles)) next.roles = [...payload.roles];
      users.set(Number(id), next); return next;
    },
    softDelete(id) { const u = users.get(Number(id)); if (u) u.isActive = false; },
    hardDelete() {},
    resetUserPassword() {},
  };
  const sessionsModel = recordingSessions();
  const settingsModel = {
    smtpConfigured: () => true,
    publicUrl: () => 'https://app.example',
    decryptedSmtpSettings: () => ({ fromName: 'GuestFlow' }),
  };
  const emailService = { send: async () => {} };
  const emailTemplates = { passwordResetEmailBody: () => ({ subject: 's', text: 't' }) };
  const controller = buildController({
    usersModel, settingsModel, emailService, emailTemplates,
    passwordGenerator: () => 'Temp!2026xyz', sessionsModel,
  });
  return { controller, sessionsModel };
}

function res() {
  return { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; }, end() { this.ended = true; return this; } };
}

test('softDelete revokes the deactivated user’s sessions', () => {
  const { controller, sessionsModel } = usersCtrlFixture([
    { id: 1, email: 'admin@x', roles: ['admin'], isActive: true },
    { id: 2, email: 'rec@x', roles: ['reception'], isActive: true },
  ]);
  controller.softDelete({ params: { id: '2' }, user: { id: 1 } }, res());
  assert.deepEqual(sessionsModel.calls, [['all', 2]]);
});

test('admin password reset revokes the target’s sessions', async () => {
  const { controller, sessionsModel } = usersCtrlFixture([
    { id: 1, email: 'admin@x', roles: ['admin'], isActive: true },
    { id: 2, email: 'rec@x', firstName: 'R', lastName: 'X', roles: ['reception'], isActive: true },
  ]);
  const r = res();
  await controller.resetPassword({ params: { id: '2' }, user: { id: 1 } }, r);
  assert.equal(r.statusCode, 204);
  assert.deepEqual(sessionsModel.calls, [['all', 2]]);
});

test('a ROLE change revokes sessions; a name-only edit does not', () => {
  const base = () => usersCtrlFixture([
    { id: 1, email: 'admin@x', roles: ['admin'], isActive: true },
    { id: 2, email: 'u@x', roles: ['admin', 'reception'], isActive: true },
  ]);

  const a = base();
  a.controller.update({ params: { id: '2' }, user: { id: 1 }, body: { roles: ['reception'] } }, res());
  assert.deepEqual(a.sessionsModel.calls, [['all', 2]], 'demotion should revoke');

  const b = base();
  b.controller.update({ params: { id: '2' }, user: { id: 1 }, body: { firstName: 'New' } }, res());
  assert.deepEqual(b.sessionsModel.calls, [], 'name-only edit should NOT revoke');

  const c = base();
  c.controller.update({ params: { id: '2' }, user: { id: 1 }, body: { roles: ['reception', 'admin'] } }, res());
  assert.deepEqual(c.sessionsModel.calls, [], 'same roles reordered should NOT revoke');
});

// ---------- authController ----------

function authFixture({ isActive = true, mustChangePassword = false } = {}) {
  const row = { id: 7, email: 'a@b.c', roles: ['admin'], isActive, mustChangePassword };
  const sessionCalls = [];
  const users = {
    verifyCredentials: (email, pw) => (email === 'a@b.c' && pw === 'good' ? { ...row } : null),
    findById: () => ({ ...row }),
    updatePassword: () => {},
    touchLastLogin: () => {},
  };
  const sessions = {
    revokeOtherSessionsForUser: (id, keep) => sessionCalls.push(['others', id, keep]),
    revokeAllForUser: (id) => sessionCalls.push(['all', id]),
    revokeAll: () => {},
  };
  return { controller: authController.create(users, sessions), sessionCalls };
}

test('login regenerates the session id before storing the user', () => {
  const { controller } = authFixture();
  let regenerated = false;
  const session = {
    user: null,
    regenerate(cb) { regenerated = true; this.user = null; cb(); },
  };
  const r = res();
  controller.login({ body: { email: 'a@b.c', password: 'good' }, session }, r);
  assert.equal(regenerated, true);
  assert.equal(r.statusCode, 200);
  assert.equal(session.user.id, 7);
});

test('login still works when the session store exposes no regenerate (unit path)', () => {
  const { controller } = authFixture();
  const r = res();
  const session = {};
  controller.login({ body: { email: 'a@b.c', password: 'good' }, session }, r);
  assert.equal(r.statusCode, 200);
  assert.equal(session.user.id, 7);
});

test('me rejects a deactivated user and destroys the session', () => {
  const { controller } = authFixture({ isActive: false });
  let destroyed = false;
  const session = { user: { id: 7 }, destroy(cb) { destroyed = true; cb(); } };
  const r = res();
  controller.me({ session }, r);
  assert.equal(r.statusCode, 401);
  assert.equal(destroyed, true);
});

test('voluntary password change revokes every OTHER session, keeping the caller’s', () => {
  const { controller, sessionCalls } = authFixture({ mustChangePassword: false });
  const session = { user: { id: 7, email: 'a@b.c', mustChangePassword: false } };
  const r = res();
  controller.changePassword(
    { body: { currentPassword: 'good', newPassword: 'brandNewPass!' }, session, sessionID: 'cur-sid' },
    r,
  );
  assert.equal(r.statusCode, 204);
  assert.deepEqual(sessionCalls, [['others', 7, 'cur-sid']]);
});
