// Shared fixture for the Qonto settings suites — specs/qonto-settings-in-app.md.
//
// A sibling module rather than a test file, so a new subject never has to import (and therefore
// re-run) another suite (CLAUDE.md §9 "one test file per subject").

const Database = require('better-sqlite3');
const settingsModel = require('../models/settingsModel');

const DDL = `
  CREATE TABLE app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    companyLogoPath TEXT DEFAULT '',
    publicUrl TEXT DEFAULT '',
    qontoAccessTokenEncrypted  TEXT DEFAULT '',
    qontoRefreshTokenEncrypted TEXT DEFAULT '',
    qontoTokenExpiresAt        TEXT DEFAULT '',
    qontoConnectionId          TEXT DEFAULT '',
    qontoConnectionStatus      TEXT DEFAULT 'not_connected',
    qontoConnectedAt           TEXT DEFAULT '',
    qontoEnvironment            TEXT DEFAULT '',
    qontoClientId               TEXT DEFAULT '',
    qontoClientSecretEncrypted  TEXT DEFAULT '',
    qontoStagingTokenEncrypted  TEXT DEFAULT '',
    qontoWebhookSecretEncrypted TEXT DEFAULT '',
    publicSiteOrigin            TEXT DEFAULT '',
    qontoLastCheckAt   TEXT DEFAULT '',
    qontoLastSuccessAt TEXT DEFAULT '',
    qontoLastErrorAt   TEXT DEFAULT '',
    qontoLastErrorCode TEXT DEFAULT '',
    qontoLastErrorMessage TEXT DEFAULT '',
    qontoLastErrorOrigin  TEXT DEFAULT '',
    qontoWebhookSubscriptionId TEXT DEFAULT '',
    qontoWebhookCallbackUrl    TEXT DEFAULT '',
    createdAt TEXT, updatedAt TEXT
  );
`;

/** A settings model over an in-memory database carrying the columns this spec adds. */
function freshSettings() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  return { db, settings: settingsModel.create(db) };
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

module.exports = { DDL, freshSettings, fakeRes, withStubbedFetch, jsonResponse, connectedSettings };
