// specs/guest-app.md rule 22 — while the plugin is off nothing answers, its rows stay, and the core is untouched.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');

const { applyPluginSchema } = require('../../sdk/testing');
const requirePlugin = require('../../../middleware/requirePlugin');
const { MIGRATIONS, TABLES } = require('../migrations');
const { freshDb } = require('./guestAppFixtures');

const SRC = path.join(__dirname, '..', '..', '..');

async function statusOf(isActive) {
  const app = express();
  app.use('/public/v1/guest', requirePlugin('guest-app', { isActive: () => isActive }), (req, res) => res.json({ reached: true }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/public/v1/guest/me`);
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise((resolve) => { server.close(resolve); });
  }
}

test('rule 22: inactive → 404 PLUGIN_INACTIVE, active → the route answers', async () => {
  assert.deepEqual(await statusOf(false), { status: 404, body: { error: 'PLUGIN_INACTIVE', plugin: 'guest-app' } });
  assert.equal((await statusOf(true)).status, 200);
});

test('rule 22: the plugin mounts its two trees through the loader’s gate', () => {
  const mounts = [];
  const noop = new Proxy(function noop() {}, { get: () => noop, apply: () => noop });
  const ctx = new Proxy({}, {
    get(_, key) {
      if (key === 'mount') return (at, router, options) => mounts.push({ at, public: Boolean(options && options.public) });
      if (key === 'db') return null;
      return noop;
    },
  });
  require('..').register(ctx);
  assert.deepEqual(mounts, [{ at: '/public/v1/guest', public: true }, { at: '/api/guest-app', public: false }]);
});

test('rule 22: the rows survive a second run of the migrations (a reactivation changes nothing)', () => {
  const db = freshDb();
  db.prepare("INSERT INTO guest_app_items (kind, itemId, sold) VALUES ('option', 1, 1)").run();
  MIGRATIONS.forEach((m) => m.up(db));
  assert.equal(applyPluginSchema(db, 'guest-app'), 0);
  assert.equal(db.prepare('SELECT sold FROM guest_app_items').get().sold, 1);
});

test('§5: every declared table exists, and no core file names one (no core column, no core table)', () => {
  const db = freshDb();
  const existing = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
  TABLES.forEach((table) => assert.ok(existing.includes(table), table));
  const core = ['schema.sql', 'database.js'].map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
  ['guest_app_', 'guest_sessions', 'guest_orders', 'guest_booklet', 'guest_media'].forEach((name) => {
    assert.equal(core.includes(name), false, name);
  });
});

test('§5: nothing is sold and no lodging is on by default', () => {
  const db = freshDb();
  db.prepare("INSERT INTO guest_app_items (kind, itemId) VALUES ('option', 1)").run();
  db.prepare('INSERT INTO guest_app_lodgings (propertyId) VALUES (1)').run();
  assert.equal(db.prepare('SELECT sold FROM guest_app_items').get().sold, 0);
  assert.equal(db.prepare('SELECT enabled FROM guest_app_lodgings').get().enabled, 0);
});
