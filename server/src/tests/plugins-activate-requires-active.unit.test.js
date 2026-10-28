// specs/plugins-phase-4-registry.md rule 37 (adversarial review of the 2026-10-27 fixes) — the mirror
// of rule 36: activating a plugin whose requirement is inactive is refused 409 REQUIREMENT_INACTIVE,
// naming the plugin to activate first. Google Vacation Rentals could be re-activated while
// website-booking, which it requires, was off.
const test = require('node:test');
const { skipWithout } = require('../plugins/sdk/testing');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { findPlugin } = require('../constants/plugins');
const { ensurePluginsTable } = require('../utils/pluginsSchema');
const pluginsModel = require('../models/pluginsModel');
const { createController } = require('../controllers/pluginsController');

function setup(installed) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE migrations (name TEXT PRIMARY KEY, ran_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE payment_links (id INTEGER PRIMARY KEY, status TEXT NOT NULL);
    CREATE TABLE users (id INTEGER PRIMARY KEY, isActive INTEGER DEFAULT 1);
    CREATE TABLE user_roles (userId INTEGER, role TEXT, PRIMARY KEY (userId, role));
  `);
  ensurePluginsTable(db);
  const model = pluginsModel.buildModel(db);
  installed.forEach((id) => model.install(id, { source: 'bundled', manifest: findPlugin(id) }));
  const ctrl = createController(model);
  const call = (handler, id) => {
    const res = {
      statusCode: 200,
      body: undefined,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
    };
    ctrl[handler]({ params: { id }, query: {}, body: {} }, res);
    return res;
  };
  return { model, call };
}

const gvrName = (findPlugin('google-vacation-rentals') || {}).name;
const siteName = (findPlugin('website-booking') || {}).name;

test('re-activating a plugin while its requirement is inactive is refused, naming it', { skip: skipWithout(['google-vacation-rentals', 'website-booking']) }, () => {
  const { model, call } = setup(['website-booking', 'google-vacation-rentals']);
  assert.equal(call('deactivate', 'google-vacation-rentals').statusCode, 200);
  assert.equal(call('deactivate', 'website-booking').statusCode, 200);
  const res = call('activate', 'google-vacation-rentals');
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'REQUIREMENT_INACTIVE');
  assert.deepEqual(res.body.requires, ['website-booking']);
  assert.equal(res.body.message, `Nécessite ${siteName} : à activer d’abord.`);
  assert.equal(model.get('google-vacation-rentals').enabled, false);
});

test('once the requirement is active again, the dependant activates', () => {
  const { model, call } = setup(['website-booking', 'google-vacation-rentals']);
  call('deactivate', 'google-vacation-rentals');
  call('deactivate', 'website-booking');
  assert.equal(call('activate', 'website-booking').statusCode, 200);
  const res = call('activate', 'google-vacation-rentals');
  assert.equal(res.statusCode, 200, gvrName);
  assert.equal(model.get('google-vacation-rentals').enabled, true);
});

test('a plugin without requirements activates as before', () => {
  const { model, call } = setup(['website-booking']);
  call('deactivate', 'website-booking');
  assert.equal(call('activate', 'website-booking').statusCode, 200);
  assert.equal(model.get('website-booking').enabled, true);
});
