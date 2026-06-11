// settingsModel Qonto connection — encrypted token storage, HTTP masking, connection metadata.
// See specs/online-payments-qonto.md §3.1.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const settingsModel = require('../models/settingsModel');

const DDL = `
  CREATE TABLE app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    companyLogoPath TEXT DEFAULT '',
    qontoAccessTokenEncrypted  TEXT DEFAULT '',
    qontoRefreshTokenEncrypted TEXT DEFAULT '',
    qontoTokenExpiresAt        TEXT DEFAULT '',
    qontoConnectionId          TEXT DEFAULT '',
    qontoConnectionStatus      TEXT DEFAULT 'not_connected',
    qontoConnectedAt           TEXT DEFAULT '',
    createdAt TEXT, updatedAt TEXT
  );
`;

function fresh() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  return { db, model: settingsModel.create(db) };
}

test('storeQontoTokens → qontoTokens round-trips the decrypted tokens', () => {
  const { model } = fresh();
  model.storeQontoTokens({ accessToken: 'at_secret', refreshToken: 'rt_secret', expiresAt: '2026-06-20T13:00:00Z' });
  const t = model.qontoTokens();
  assert.equal(t.accessToken, 'at_secret');
  assert.equal(t.refreshToken, 'rt_secret');
  assert.equal(t.expiresAt, '2026-06-20T13:00:00Z');
});

test('tokens are stored ENCRYPTED at rest (the raw column is not the plaintext)', () => {
  const { db, model } = fresh();
  model.storeQontoTokens({ accessToken: 'at_secret', refreshToken: 'rt_secret', expiresAt: '2026-06-20T13:00:00Z' });
  const raw = db.prepare('SELECT qontoAccessTokenEncrypted, qontoRefreshTokenEncrypted FROM app_settings WHERE id = 1').get();
  assert.notEqual(raw.qontoAccessTokenEncrypted, 'at_secret');
  assert.notEqual(raw.qontoRefreshTokenEncrypted, 'rt_secret');
  assert.ok(raw.qontoAccessTokenEncrypted.length > 0);
});

test('read() masks the tokens — exposes booleans, never the secret blobs', () => {
  const { model } = fresh();
  model.storeQontoTokens({ accessToken: 'at_secret', refreshToken: 'rt_secret', expiresAt: '2026-06-20T13:00:00Z' });
  const out = model.read();
  assert.equal(out.qontoConnected, true);
  assert.equal(out.qontoAccessTokenSet, true);
  assert.equal(out.qontoAccessTokenEncrypted, undefined);
  assert.equal(out.qontoRefreshTokenEncrypted, undefined);
});

test('qontoConnected reflects whether a refresh token is stored', () => {
  const { model } = fresh();
  assert.equal(model.qontoConnected(), false);
  model.storeQontoTokens({ accessToken: 'a', refreshToken: 'r', expiresAt: null });
  assert.equal(model.qontoConnected(), true);
});

test('storeQontoConnection + qontoConnectionInfo carry the provider metadata', () => {
  const { model } = fresh();
  model.storeQontoConnection({ connectionId: 'conn_1', status: 'enabled' });
  const info = model.qontoConnectionInfo();
  assert.equal(info.connectionId, 'conn_1');
  assert.equal(info.connectionStatus, 'enabled');
});

test('connection status defaults to not_connected', () => {
  const { model } = fresh();
  assert.equal(model.qontoConnectionInfo().connectionStatus, 'not_connected');
  assert.equal(model.qontoConnectionInfo().connected, false);
});
