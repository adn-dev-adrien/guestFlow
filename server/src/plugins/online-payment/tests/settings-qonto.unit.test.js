// The Qonto connection settings of the instance — encrypted token storage, HTTP masking, connection
// metadata. See specs/online-payments-qonto.md §3.1; stored in the plugin's settings since
// specs/plugins-phase-3a-online-payment.md rule 13.

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshSettings } = require('./qontoSettingsFixture');
const { buildModel: buildPluginSettingsModel } = require('../../../models/pluginSettingsModel');
const { DECLARED } = require('../settingsStore');

const fresh = () => {
  const { db, settings } = freshSettings();
  return { db, model: settings };
};

test('storeQontoTokens → qontoTokens round-trips the decrypted tokens', () => {
  const { model } = fresh();
  model.storeQontoTokens({ accessToken: 'at_secret', refreshToken: 'rt_secret', expiresAt: '2026-06-20T13:00:00Z' });
  const t = model.qontoTokens();
  assert.equal(t.accessToken, 'at_secret');
  assert.equal(t.refreshToken, 'rt_secret');
  assert.equal(t.expiresAt, '2026-06-20T13:00:00Z');
});

test('tokens are stored ENCRYPTED at rest (the raw value is not the plaintext)', () => {
  const { db, model } = fresh();
  model.storeQontoTokens({ accessToken: 'at_secret', refreshToken: 'rt_secret', expiresAt: '2026-06-20T13:00:00Z' });
  const raw = (key) => db.prepare("SELECT value FROM plugin_settings WHERE plugin_id = 'online-payment' AND key = ?").get(key).value;
  assert.notEqual(raw('qontoAccessTokenEncrypted'), 'at_secret');
  assert.notEqual(raw('qontoRefreshTokenEncrypted'), 'rt_secret');
  assert.ok(raw('qontoAccessTokenEncrypted').length > 0);
});

test('the HTTP view masks every secret — booleans, never the blobs', () => {
  const { db, model } = fresh();
  model.storeQontoTokens({ accessToken: 'at_secret', refreshToken: 'rt_secret', expiresAt: '2026-06-20T13:00:00Z' });
  model.storeQontoCredentials({ clientId: 'cid', clientSecret: 'sec' });
  const out = buildPluginSettingsModel(db).httpView('online-payment', DECLARED);
  assert.equal(out.qontoAccessTokenEncryptedSet, true);
  assert.equal(out.qontoRefreshTokenEncryptedSet, true);
  assert.equal(out.qontoClientSecretEncryptedSet, true);
  assert.equal(out.qontoAccessTokenEncrypted, undefined);
  assert.equal(out.qontoClientId, 'cid');
});

test('the generic plugin settings endpoint refuses every Qonto key', () => {
  DECLARED.forEach((d) => assert.match(d.validate('x'), /Paiements en ligne/));
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
