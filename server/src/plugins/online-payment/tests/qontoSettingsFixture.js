// Shared fixture for the Qonto settings suites — specs/qonto-settings-in-app.md.
//
// A sibling module rather than a test file, so a new subject never has to import (and therefore
// re-run) another suite (CLAUDE.md §9 "one test file per subject").

const Database = require('better-sqlite3');
const settingsModel = require('../../../models/settingsModel');
const { buildModel: buildPluginSettingsModel } = require('../../../models/pluginSettingsModel');
const { createSettingsStore, DECLARED } = require('../settingsStore');

// The instance keeps its public URL and public site origin in app_settings; the Qonto values live in
// the plugin's settings (specs/plugins-phase-3a-online-payment.md rule 13).
const DDL = `
  CREATE TABLE app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    companyLogoPath TEXT DEFAULT '',
    publicUrl TEXT DEFAULT '',
    publicSiteOrigin TEXT DEFAULT '',
    createdAt TEXT, updatedAt TEXT
  );
  CREATE TABLE plugin_settings (
    plugin_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT, updated_at TEXT,
    PRIMARY KEY (plugin_id, key)
  );
`;

const SECRET = new Set(DECLARED.filter((d) => d.secret).map((d) => d.key));

/** The ctx.settings of the plugin over a given database — what the loader hands `register`. */
function pluginSettingsOn(db) {
  const model = buildPluginSettingsModel(db);
  return {
    get: (key) => model.get('online-payment', key, { secret: SECRET.has(key) }),
    set: (key, value) => model.set('online-payment', key, value, { secret: SECRET.has(key) }),
    raw: (key) => model.raw('online-payment', key),
  };
}

/** The plugin's settings store over an in-memory database. */
function freshSettings() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  const core = settingsModel.create(db);
  const store = createSettingsStore({ settings: pluginSettingsOn(db), core: () => core });
  // A suite sets the instance's public URL as it did on the old settings model: the write goes to the
  // core settings the store reads.
  store.upsert = (payload) => core.upsert(payload);
  return { db, core, settings: store };
}

/** The `res` double the controller handlers write to. */
function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

/**
 * Run `fn` with the global fetch replaced, so a suite exercises the real chain
 * (`withQonto` → `getValidQontoAccessToken` → `qontoClient`) without a network call. The Qonto
 * client is built inside `qontoService` from the resolved config, so this is the only seam.
 */
function withStubbedFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return Promise.resolve()
    .then(fn)
    .finally(() => { globalThis.fetch = original; });
}

const jsonResponse = (body, { ok = true, status = 200 } = {}) => ({
  ok, status, text: async () => JSON.stringify(body),
});

/** Credentials + a token that is still valid, i.e. a connection that needs no refresh call. */
function connectedSettings(settings) {
  settings.storeQontoCredentials({ clientId: 'cid', clientSecret: 'sec' });
  settings.storeQontoTokens({ accessToken: 'at', refreshToken: 'rt', expiresAt: '2099-01-01T00:00:00Z' });
  return settings;
}

module.exports = { DDL, freshSettings, pluginSettingsOn, fakeRes, withStubbedFetch, jsonResponse, connectedSettings };
