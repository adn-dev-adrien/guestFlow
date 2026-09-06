const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { create: createModel } = require('../models/pushSubscriptionsModel');

// specs/pwa-push-notifications.md §5 — per-(user,device) subscriptions + per-user prefs (default ON).

function freshModel() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER NOT NULL, endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL, auth TEXT NOT NULL, createdAt TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE user_push_prefs (
      userId INTEGER PRIMARY KEY, newReservation INTEGER NOT NULL DEFAULT 1,
      arrivals INTEGER NOT NULL DEFAULT 1, departures INTEGER NOT NULL DEFAULT 1,
      breakfast INTEGER NOT NULL DEFAULT 1,
      neat INTEGER NOT NULL DEFAULT 1
    );
  `);
  return { db, model: createModel(db) };
}

const sub = (endpoint) => ({ endpoint, keys: { p256dh: `p-${endpoint}`, auth: `a-${endpoint}` } });

test('subscribe stores a (user, device) row; re-subscribe upserts by endpoint', () => {
  const { db, model } = freshModel();
  assert.equal(model.subscribe(1, sub('https://push/aaa')).ok, true);
  model.subscribe(1, sub('https://push/bbb'));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM push_subscriptions WHERE userId = 1').get().c, 2);
  // Same endpoint, different user → upsert (no duplicate row, userId updated).
  model.subscribe(2, sub('https://push/aaa'));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM push_subscriptions').get().c, 2);
  assert.equal(db.prepare("SELECT userId FROM push_subscriptions WHERE endpoint = 'https://push/aaa'").get().userId, 2);
});

test('subscribe rejects a malformed subscription', () => {
  const { model } = freshModel();
  assert.equal(model.subscribe(1, { endpoint: 'x' }).error, 'INVALID_SUBSCRIPTION');
  assert.equal(model.subscribe(1, null).error, 'INVALID_SUBSCRIPTION');
});

test('unsubscribe / removeByEndpoint delete the row (idempotent)', () => {
  const { db, model } = freshModel();
  model.subscribe(1, sub('https://push/aaa'));
  model.unsubscribe('https://push/aaa');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM push_subscriptions').get().c, 0);
  model.removeByEndpoint('https://push/aaa'); // no throw on absent
});

test('preferences default to all-ON with no row; setPreferences is a partial update', () => {
  const { model } = freshModel();
  assert.deepEqual(model.getPreferences(1), { newReservation: true, arrivals: true, departures: true, breakfast: true, neat: true });
  model.setPreferences(1, { arrivals: false });
  assert.deepEqual(model.getPreferences(1), { newReservation: true, arrivals: false, departures: true, breakfast: true, neat: true });
  model.setPreferences(1, { newReservation: false, breakfast: false, neat: false });
  assert.deepEqual(model.getPreferences(1), { newReservation: false, arrivals: false, departures: true, breakfast: false, neat: false });
});

test('subscriptionsForPref returns subs of users whose pref is ON (default ON when no prefs row)', () => {
  const { model } = freshModel();
  model.subscribe(1, sub('https://push/u1')); // no prefs row → all ON
  model.subscribe(2, sub('https://push/u2'));
  model.setPreferences(2, { arrivals: false });

  const arrivals = model.subscriptionsForPref('arrivals').map((s) => s.endpoint).sort();
  assert.deepEqual(arrivals, ['https://push/u1'], 'user 2 opted out of arrivals');
  const news = model.subscriptionsForPref('newReservation').map((s) => s.endpoint).sort();
  assert.deepEqual(news, ['https://push/u1', 'https://push/u2']);
  // Breakfast pref: default ON, individually opt-out-able (specs/sas-breakfast-bread-and-push.md rule 6).
  assert.deepEqual(model.subscriptionsForPref('breakfast').map((s) => s.endpoint).sort(), ['https://push/u1', 'https://push/u2']);
  model.setPreferences(1, { breakfast: false });
  assert.deepEqual(model.subscriptionsForPref('breakfast').map((s) => s.endpoint), ['https://push/u2']);
  assert.deepEqual(model.subscriptionsForPref('bogus'), []);
});
