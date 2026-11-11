// specs/public-request-abuse-and-grouping.md rule 34 (audit r5) — the proof-of-work latch and the last plugin version seen
// are the plugin's own state: the generic settings PUT refuses them, the plugin still writes them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

process.env.GUESTFLOW_ENCRYPTION_KEY = process.env.GUESTFLOW_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const registry = require('../../sdk/registry');
const { createContext } = require('../../sdk/createContext');
const settings = require('../settings');
const { buildModel: buildPluginsModel } = require('../../../models/pluginsModel');
const { buildModel: buildPluginSettingsModel } = require('../../../models/pluginSettingsModel');
const { createController } = require('../../../controllers/pluginsController');
const { ensurePluginsTable, ensurePluginSettingsTable } = require('../../../utils/pluginsSchema');

test('rule 34: PUT {proofEnforcedSince: null} and {lastSeenPluginVersion} are refused; markProofEnforced still writes', () => {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'schema.sql'), 'utf8'));
  ensurePluginsTable(db);
  ensurePluginSettingsTable(db);
  registry.reset();
  const plugins = buildPluginsModel(db);
  plugins.install('website-booking');
  registry.configure({ isActive: (id) => plugins.isActive(id) });
  const settingsModel = buildPluginSettingsModel(db);
  const ctx = createContext('website-booking', { db, settingsModel: () => settingsModel });
  ctx.settings.declare(settings.DECLARED);
  settings.bindStore(ctx.settings);
  const controller = createController(plugins, { registry, settingsModel: () => settingsModel });
  const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

  settings.markProofEnforced();
  const latch = settings.proofEnforcedSince();
  assert.ok(latch);
  for (const body of [{ proofEnforcedSince: null }, { proofEnforcedSince: '' }, { lastSeenPluginVersion: '0.0.1' }]) {
    const r = res();
    controller.saveSettings({ params: { id: 'website-booking' }, body }, r);
    assert.equal(r.statusCode, 400);
    assert.equal(r.body.error, 'INTERNAL_SETTING');
  }
  assert.equal(settings.proofEnforcedSince(), latch);
  settings.recordPluginVersion('1.9.0');
  assert.equal(settings.termsSettings().lastSeenPluginVersion, '1.9.0');
  const view = res();
  controller.getSettings({ params: { id: 'website-booking' } }, view);
  assert.deepEqual(view.body, { requireTermsAcceptance: '1' });
});
