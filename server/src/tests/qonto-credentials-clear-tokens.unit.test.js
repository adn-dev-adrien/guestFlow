// Changing the application must not leave an authorisation that belonged to another one.
// See specs/qonto-settings-in-app.md §3 rule 15.

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshSettings } = require('./qontoSettingsFixture');
const { applyQontoCredentials } = require('../utils/qontoService');

function connected() {
  const { settings } = freshSettings();
  settings.storeQontoCredentials({ clientId: 'cid_old', clientSecret: 'secret_old', environment: 'sandbox' });
  settings.storeQontoTokens({ accessToken: 'at', refreshToken: 'rt', expiresAt: '2099-01-01T00:00:00Z' });
  settings.storeQontoConnection({ status: 'enabled', connectionId: 'bank_1' });
  return settings;
}

// Rule 15 — a token issued by the old application cannot work with the new one; showing "Connecté"
// would be exactly the lie this spec removes.
test('rule 15: changing the client id clears the stored authorisation', () => {
  const settings = connected();
  const payload = applyQontoCredentials({ settings, env: {}, body: { clientId: 'cid_new' } });
  assert.equal(payload.tokensCleared, true);
  assert.equal(settings.qontoConnected(), false);
  assert.equal(settings.qontoTokens().refreshToken, '');
  assert.equal(settings.qontoConnectionInfo().connectionStatus, 'not_connected');
});

test('rule 15: changing the client secret clears the stored authorisation', () => {
  const settings = connected();
  const payload = applyQontoCredentials({ settings, env: {}, body: { clientSecret: 'secret_rotated' } });
  assert.equal(payload.tokensCleared, true);
  assert.equal(settings.qontoConnected(), false);
});

// Rule 15 — tokens are environment-scoped: a sandbox authorisation is meaningless in production.
test('rule 15: switching the environment clears the stored authorisation', () => {
  const settings = connected();
  const payload = applyQontoCredentials({ settings, env: {}, body: { environment: 'production' } });
  assert.equal(payload.tokensCleared, true);
  assert.equal(settings.qontoConnected(), false);
});

// Rule 15 — and it must not fire on an unrelated edit, or every save would log the operator out.
test('rule 15: editing only the public site origin keeps the authorisation', () => {
  const settings = connected();
  const payload = applyQontoCredentials({ settings, env: {}, body: { publicSiteOrigin: 'https://site.example' } });
  assert.equal(payload.tokensCleared, false);
  assert.equal(settings.qontoConnected(), true);
  assert.equal(settings.qontoConnectionInfo().connectionStatus, 'enabled');
});

test('rule 15: re-saving the same credentials keeps the authorisation', () => {
  const settings = connected();
  const payload = applyQontoCredentials({ settings, env: {}, body: { clientId: 'cid_old', clientSecret: 'secret_old' } });
  assert.equal(payload.tokensCleared, false);
  assert.equal(settings.qontoConnected(), true);
});

// Rule 15 — the recorded diagnosis belonged to the old credentials; keeping it would name the wrong repair.
test('rule 15: changing the application also clears the recorded failure', () => {
  const settings = connected();
  settings.recordQontoHealth({
    lastErrorAt: '2026-09-06T10:00:00Z',
    lastErrorCode: 'invalid_client',
    lastErrorMessage: 'Client authentication failed',
    lastErrorOrigin: 'public-payment',
  });
  applyQontoCredentials({ settings, env: {}, body: { clientSecret: 'secret_rotated' } });
  const health = settings.qontoHealth();
  assert.equal(health.lastError, null);
  assert.equal(health.lastSuccessAt, null);
});

test('rule 15: with nothing connected, a credential change is not reported as a disconnection', () => {
  const { settings } = freshSettings();
  const payload = applyQontoCredentials({ settings, env: {}, body: { clientId: 'cid', clientSecret: 'sec' } });
  assert.equal(payload.tokensCleared, false);
});
