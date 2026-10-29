// specs/platform-settings-relay-and-review.md rule 8 and specs/plugins-phase-3b-neat.md rule 25 (the core
// names no Neat) — a plugin brings its own push toggle
// (`ctx.pushChannel`): the core lists it with the plugin's label while the plugin is live and never names
// it; the « Souscriptions Neat » choices of the former `neat` column survive the move (audit 2026-10-27).
const path = require('path');
const os = require('os');
const fs = require('fs');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-push-channels-')), 'p.db');

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const silent = console.log;
console.log = () => {};
const registry = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');
const pushController = require('../controllers/pushController');
const { create: createModel } = require('../models/pushSubscriptionsModel');
const { applyPushChannelPrefsSchema, runPushChannelPrefsMigration } = require('../utils/pushChannelPrefsMigration');
console.log = silent;

let live = new Set();
registry.configure({ isActive: (id) => live.has(id), allows: () => true });

function res() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

test('ctx.pushChannel: a key and a French label; a core key or a taken one is refused', () => {
  const ctx = createContext('insurer', {});
  ctx.pushChannel({ key: 'insurer', label: 'Souscriptions de l’assureur' });
  assert.throws(() => createContext('other', {}).pushChannel({ key: 'insurer', label: 'x' }), /already declared/);
  assert.throws(() => createContext('other', {}).pushChannel({ key: 'arrivals', label: 'x' }), /already declared/);
  assert.throws(() => createContext('other', {}).pushChannel({ key: 'Bad Key', label: 'x' }), /needs a key/);
  assert.throws(() => createContext('other', {}).pushChannel({ key: 'other' }), /needs a label/);
});

test('preferences: the plugin toggle is listed with its label while the plugin is live, never otherwise', () => {
  live = new Set(['insurer']);
  const on = res();
  pushController.getPreferences({ user: { id: 1 } }, on);
  assert.deepEqual(on.body.available, ['newReservation', 'arrivals', 'departures', 'breakfast', 'insurer']);
  assert.deepEqual(on.body.channels.at(-1), { key: 'insurer', label: 'Souscriptions de l’assureur' });
  assert.equal(on.body.insurer, true, 'default ON');
  live = new Set();
  const off = res();
  pushController.getPreferences({ user: { id: 1 } }, off);
  assert.deepEqual(off.body.available, ['newReservation', 'arrivals', 'departures', 'breakfast']);
  assert.equal(off.body.insurer, undefined);
  assert.equal(JSON.stringify(off.body).includes('Neat'), false, 'the core names no plugin');
});

test('preferences: a live plugin toggle is saved and read back', () => {
  live = new Set(['insurer']);
  const saved = res();
  pushController.updatePreferences({ user: { id: 1 }, body: { insurer: false } }, saved);
  assert.equal(saved.body.insurer, false);
  const read = res();
  pushController.getPreferences({ user: { id: 1 } }, read);
  assert.equal(read.body.insurer, false);
  live = new Set();
});

function legacyDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE migrations (name TEXT PRIMARY KEY);
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    INSERT INTO users (id) VALUES (1), (2), (3);
    CREATE TABLE push_subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER NOT NULL, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL);
    CREATE TABLE user_push_prefs (userId INTEGER PRIMARY KEY, newReservation INTEGER NOT NULL DEFAULT 1, arrivals INTEGER NOT NULL DEFAULT 1,
      departures INTEGER NOT NULL DEFAULT 1, breakfast INTEGER NOT NULL DEFAULT 1, neat INTEGER NOT NULL DEFAULT 1);
    INSERT INTO user_push_prefs (userId, neat) VALUES (1, 0), (2, 1);
  `);
  applyPushChannelPrefsSchema(db);
  return db;
}

test('migration: a « Souscriptions Neat » switched off stays off, once', () => {
  const db = legacyDb();
  assert.deepEqual(runPushChannelPrefsMigration(db), { action: 'migrated', carried: 1 });
  assert.equal(runPushChannelPrefsMigration(db).action, 'skipped');
  createContext('neat', {}).pushChannel({ key: 'neat', label: 'Souscriptions Neat' });
  const model = createModel(db);
  [1, 2, 3].forEach((u) => model.subscribe(u, { endpoint: `https://push/u${u}`, keys: { p256dh: 'p', auth: 'a' } }));
  assert.deepEqual(model.subscriptionsForPref('neat').map((s) => s.endpoint), ['https://push/u2', 'https://push/u3']);
  assert.equal(model.getPreferences(1, ['neat']).neat, false);
  assert.deepEqual(model.subscriptionsForPref('undeclared'), [], 'a channel no plugin declared reaches nobody');
});
