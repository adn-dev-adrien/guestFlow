// specs/plugins-phase-1-sdk.md rule 34 (internal settings, SDK 2.17.0, audit r5) — a setting declared `internal` is the
// plugin's own bookkeeping: the PUT refuses it, the GET leaves it out, the plugin still writes it.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

process.env.GUESTFLOW_ENCRYPTION_KEY = process.env.GUESTFLOW_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const registry = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');
const { buildModel: buildPluginSettingsModel } = require('../models/pluginSettingsModel');
const { buildModel: buildPluginsModel } = require('../models/pluginsModel');
const { createController } = require('../controllers/pluginsController');
const { ensurePluginsTable, ensurePluginSettingsTable } = require('../utils/pluginsSchema');

function setup() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
  ensurePluginsTable(db);
  ensurePluginSettingsTable(db);
  registry.reset();
  const plugins = buildPluginsModel(db);
  plugins.install('sample-plugin');
  registry.configure({ isActive: (id) => plugins.isActive(id) });
  const settingsModel = buildPluginSettingsModel(db);
  const ctx = createContext('sample-plugin', { db, settingsModel: () => settingsModel });
  ctx.settings.declare([{ key: 'pollEveryHours', default: '3' }, { key: 'unreadMails', internal: true, default: '0' }]);
  const controller = createController(plugins, { registry, settingsModel: () => settingsModel });
  return { ctx, controller, settingsModel };
}

const fakeRes = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

test('rule 34: the PUT refuses an internal key and writes nothing of the same request', () => {
  const { controller, settingsModel } = setup();
  const res = fakeRes();
  controller.saveSettings({ params: { id: 'sample-plugin' }, body: { pollEveryHours: '6', unreadMails: '99' } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'INTERNAL_SETTING', keys: ['unreadMails'] });
  assert.equal(settingsModel.raw('sample-plugin', 'pollEveryHours'), '');
  assert.equal(settingsModel.raw('sample-plugin', 'unreadMails'), '');
});

test('rule 34: the GET leaves an internal key out and the plugin still reads and writes it', () => {
  const { ctx, controller } = setup();
  ctx.settings.set('unreadMails', '4');
  assert.equal(ctx.settings.get('unreadMails'), '4');
  const res = fakeRes();
  controller.getSettings({ params: { id: 'sample-plugin' } }, res);
  assert.deepEqual(res.body, { pollEveryHours: '3' });
  const ok = fakeRes();
  controller.saveSettings({ params: { id: 'sample-plugin' }, body: { pollEveryHours: '6' } }, ok);
  assert.deepEqual(ok.body, { pollEveryHours: '6' });
});
