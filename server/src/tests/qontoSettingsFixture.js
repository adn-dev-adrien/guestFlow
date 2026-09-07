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

module.exports = { DDL, freshSettings, fakeRes };
