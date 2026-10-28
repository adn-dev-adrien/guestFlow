// specs/plugins-phase-4-registry.md rule 36 (operator decision 2026-10-27) — deactivating a plugin
// that an ACTIVE plugin requires is refused like uninstalling it (rule 12): 409 REQUIRED_BY naming
// the dependant. Found at the 2026-10-27 spec review: website-booking could be switched off while
// google-vacation-rentals, which requires it, stayed active.
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

test('the dependency this rule is about exists in the catalogue', { skip: skipWithout(['google-vacation-rentals', 'website-booking']) }, () => {
  const gvr = findPlugin('google-vacation-rentals');
  assert.ok((gvr.requires || []).some((r) => r.id === 'website-booking'));
});

test('deactivating a plugin an active plugin requires is refused, naming the dependant', { skip: skipWithout(['google-vacation-rentals', 'website-booking']) }, () => {
  const { model, call } = setup(['website-booking', 'google-vacation-rentals']);
  const res = call('deactivate', 'website-booking');
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'REQUIRED_BY');
  assert.deepEqual(res.body.requiredBy, ['google-vacation-rentals']);
  assert.match(res.body.message, new RegExp(`Nécessaire à ${findPlugin('google-vacation-rentals').name} : à désactiver d’abord\\.`));
  assert.equal(model.get('website-booking').enabled, true);
});

test('once the dependant is inactive, the requirement can be deactivated', () => {
  const { model, call } = setup(['website-booking', 'google-vacation-rentals']);
  assert.equal(call('deactivate', 'google-vacation-rentals').statusCode, 200);
  const res = call('deactivate', 'website-booking');
  assert.equal(res.statusCode, 200);
  assert.equal(model.get('website-booking').enabled, false);
});

test('uninstalling still counts an inactive dependant (rule 12 unchanged)', { skip: skipWithout(['google-vacation-rentals', 'website-booking']) }, () => {
  const { call } = setup(['website-booking', 'google-vacation-rentals']);
  call('deactivate', 'google-vacation-rentals');
  const res = call('uninstall', 'website-booking');
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'REQUIRED_BY');
  assert.match(res.body.message, /à désinstaller d’abord\.$/);
});
