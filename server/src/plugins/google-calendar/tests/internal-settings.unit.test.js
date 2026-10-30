// specs/google-calendar-oauth-rework.md rule 29 (audit r5) — the connection and last-sync stamps are the plugin's own state:
// the generic settings PUT refuses them, the plugin still writes them, and no client form round-trips them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

process.env.GUESTFLOW_ENCRYPTION_KEY = process.env.GUESTFLOW_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const registry = require('../../sdk/registry');
const { createContext } = require('../../sdk/createContext');
const { createGoogleSettings, DECLARED } = require('../settings');
const { buildModel: buildPluginsModel } = require('../../../models/pluginsModel');
const { buildModel: buildPluginSettingsModel } = require('../../../models/pluginSettingsModel');
const { createController } = require('../../../controllers/pluginsController');
const { ensurePluginsTable, ensurePluginSettingsTable } = require('../../../utils/pluginsSchema');

const STAMPS = ['connectedEmail', 'connectedAt', 'calendarSummary', 'lastSyncAt', 'lastSyncOk', 'lastSyncDetail'];

test('rule 29: every stamp is refused by the PUT, hidden from the GET, and still written by the plugin', () => {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'schema.sql'), 'utf8'));
  ensurePluginsTable(db);
  ensurePluginSettingsTable(db);
  registry.reset();
  const plugins = buildPluginsModel(db);
  plugins.install('google-calendar');
  registry.configure({ isActive: (id) => plugins.isActive(id) });
  const settingsModel = buildPluginSettingsModel(db);
  const ctx = createContext('google-calendar', { db, settingsModel: () => settingsModel });
  ctx.settings.declare(DECLARED);
  const google = createGoogleSettings({ store: ctx.settings, publicUrl: () => '' });
  const controller = createController(plugins, { registry, settingsModel: () => settingsModel });
  const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

  google.storeGoogleTokens({ refreshToken: 'rt', email: 'me@example.com' });
  google.recordGoogleSyncResult({ ok: true, detail: 'ok' });
  for (const key of STAMPS) {
    const r = res();
    controller.saveSettings({ params: { id: 'google-calendar' }, body: { [key]: 'forged' } }, r);
    assert.equal(r.statusCode, 400, key);
    assert.deepEqual(r.body, { error: 'INTERNAL_SETTING', keys: [key] });
  }
  assert.equal(google.googleStatus().connectedEmail, 'me@example.com');
  const view = res();
  controller.getSettings({ params: { id: 'google-calendar' } }, view);
  assert.deepEqual(view.body, { refreshTokenSet: true, calendarIdSet: false });
});
