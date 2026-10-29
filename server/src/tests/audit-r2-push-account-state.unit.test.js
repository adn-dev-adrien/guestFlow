// specs/pwa-push-notifications.md rule 13 (audit R2, finding N1) — a push device receives guest data
// only while its owner is an active, non-support administrator; the devices go with the account's
// standing.

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, fakeRes } = require('./accountSecurityFixture');
const { applyPushChannelPrefsSchema } = require('../utils/pushChannelPrefsMigration');
const pushModelModule = require('../models/pushSubscriptionsModel');
const pushControllerModule = require('../controllers/pushController');

function world() {
  const h = setup();
  h.db.exec(`
    CREATE TABLE push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER NOT NULL, endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL, auth TEXT NOT NULL, FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE user_push_prefs (userId INTEGER PRIMARY KEY, newReservation INTEGER NOT NULL DEFAULT 1,
      arrivals INTEGER NOT NULL DEFAULT 1, departures INTEGER NOT NULL DEFAULT 1, breakfast INTEGER NOT NULL DEFAULT 1);
  `);
  applyPushChannelPrefsSchema(h.db);
  const push = pushModelModule.create(h.db);
  const sub = (endpoint) => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } });
  const endpoints = (pref = 'newReservation') => push.subscriptionsForPref(pref).map((s) => s.endpoint).sort();
  const support = Number(h.db.prepare("INSERT INTO users (email, passwordHash, isSupportAccount) VALUES ('support@x.invalid', 'x', 1)").run().lastInsertRowid);
  h.db.prepare("INSERT INTO user_roles (userId, role) VALUES (?, 'admin')").run(support);
  return { ...h, push, sub, endpoints, support };
}

test('rule 13 — the fan-out skips a support account, a deactivated user and a user without the admin role', () => {
  const w = world();
  const admin = w.addUser('admin@x.invalid');
  const gone = w.addUser('gone@x.invalid');
  const reception = w.addUser('desk@x.invalid', { roles: ['reception'] });
  [admin, gone, reception].forEach((u) => w.push.subscribe(u.id, w.sub(`https://push/${u.id}`)));
  w.push.subscribe(w.support, w.sub('https://push/support'));
  w.db.prepare('UPDATE users SET isActive = 0 WHERE id = ?').run(gone.id);

  assert.deepEqual(w.endpoints('newReservation'), [`https://push/${admin.id}`]);
  assert.deepEqual(w.endpoints('arrivals'), [`https://push/${admin.id}`]);
  assert.deepEqual(w.push.listByUser(w.support), [], 'sendToUser reads listByUser: nothing for the support account');
  assert.deepEqual(w.push.listByUser(gone.id), []);
  assert.deepEqual(w.push.listByUser(reception.id), []);
  assert.equal(w.push.listByUser(admin.id).length, 1);
});

test('rule 13 — POST /push/subscribe is refused in a support session and stores nothing', () => {
  const w = world();
  const controller = pushControllerModule;
  const res = fakeRes();
  controller.subscribe({ user: { id: w.support, isSupport: true }, body: { subscription: w.sub('https://push/support') } }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'SUPPORT_FORBIDDEN');
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n, 0);
});

test('rule 13 — deactivating a user deletes their devices', () => {
  const w = world();
  const a = w.addUser('a@x.invalid');
  const b = w.addUser('b@x.invalid');
  w.push.subscribe(a.id, w.sub('https://push/a'));
  w.push.subscribe(b.id, w.sub('https://push/b'));
  w.users.softDelete(a.id);
  assert.deepEqual(w.db.prepare('SELECT endpoint FROM push_subscriptions').all().map((r) => r.endpoint), ['https://push/b']);
});

test('rule 13 — removing the admin role deletes the devices; keeping it keeps them', () => {
  const w = world();
  const a = w.addUser('a@x.invalid', { roles: ['admin', 'reception'] });
  w.push.subscribe(a.id, w.sub('https://push/a'));
  w.users.updateUser(a.id, { roles: ['admin'] });
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n, 1);
  w.users.updateUser(a.id, { roles: ['accountant'] });
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n, 0);
});

test('rule 13 — revoking a support access deletes the support account\'s devices only', () => {
  const w = world();
  const admin = w.addUser('a@x.invalid');
  w.push.subscribe(admin.id, w.sub('https://push/admin'));
  w.push.subscribe(w.support, w.sub('https://push/support'));
  const id = Number(w.db.prepare("INSERT INTO support_access (requestId, reason, requestedAt, decision, decidedBy, decidedAt, expiresAt) VALUES ('r', 'x', '2026-10-08T09:00:00.000Z', 'accepted', ?, '2026-10-08T09:30:00.000Z', '2026-10-09T09:30:00.000Z')").run(admin.id).lastInsertRowid);
  assert.equal(w.supportAccessModel.revoke(id, admin.id, '2026-10-08T10:00:00.000Z'), true);
  assert.deepEqual(w.db.prepare('SELECT endpoint FROM push_subscriptions').all().map((r) => r.endpoint), ['https://push/admin']);
});

test('rule 13 — the boot cleanup deletes the devices of an ineligible owner, once', () => {
  const { pruneIneligiblePushSubscriptions } = require('../utils/pushSubscriptionsCleanup');
  const w = world();
  const admin = w.addUser('a@x.invalid');
  const gone = w.addUser('gone@x.invalid');
  const desk = w.addUser('desk@x.invalid', { roles: ['reception'] });
  [admin, gone, desk].forEach((u) => w.push.subscribe(u.id, w.sub(`https://push/${u.id}`)));
  w.push.subscribe(w.support, w.sub('https://push/support'));
  w.db.prepare('UPDATE users SET isActive = 0 WHERE id = ?').run(gone.id);
  assert.equal(pruneIneligiblePushSubscriptions(w.db), 3);
  assert.deepEqual(w.db.prepare('SELECT endpoint FROM push_subscriptions').all().map((r) => r.endpoint), [`https://push/${admin.id}`]);
  w.db.prepare('UPDATE users SET isActive = 1 WHERE id = ?').run(gone.id);
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE userId = ?').get(gone.id).n, 0, 'reactivation brings nothing back');
  assert.equal(pruneIneligiblePushSubscriptions(w.db), 0);
});
