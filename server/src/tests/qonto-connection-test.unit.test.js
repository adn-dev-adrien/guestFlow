// « Tester la connexion »: a real call, and a badge that only claims success once one has succeeded.
// See specs/qonto-settings-in-app.md §3 rules 9, 11.

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshSettings } = require('./qontoSettingsFixture');
const { runQontoConnectionTest, qontoStatusPayload } = require('../utils/qontoService');

/**
 * A settings model whose token refresh is intercepted, so the test exercises the real code path
 * (`withQonto` → `getValidQontoAccessToken` → the client) without a network call.
 */
function connected(settings, { expired = false } = {}) {
  settings.storeQontoCredentials({ clientId: 'cid', clientSecret: 'sec' });
  settings.storeQontoTokens({
    accessToken: 'at',
    refreshToken: 'rt',
    expiresAt: expired ? '2000-01-01T00:00:00Z' : '2099-01-01T00:00:00Z',
  });
  return settings;
}

/** Replace the module's client factory for one call by stubbing the Qonto HTTP layer. */
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

// Rule 9 — the test performs a real authenticated call, not a look at what is stored.
test('rule 9: the test calls Qonto and reports a working connection', async () => {
  const { settings } = freshSettings();
  connected(settings);

  const calls = [];
  const result = await withStubbedFetch(async (url) => {
    calls.push(String(url));
    return jsonResponse({ status: 'enabled', bank_account_id: 'bank_1' });
  }, () => runQontoConnectionTest({ settings, env: {} }));

  assert.equal(result.state, 'ok');
  assert.equal(result.ok, true);
  assert.ok(result.checkedAt);
  assert.ok(calls.some((u) => u.includes('/v2/payment_links/connections')), 'a real Qonto call was made');
});

// Rule 9 + 10 — the outage's signature: the secret is refused, and the test says so.
test('rule 9: a refused secret is reported as a credentials problem, with Qonto’s own words', async () => {
  const { settings } = freshSettings();
  connected(settings, { expired: true });

  const result = await withStubbedFetch(
    async () => jsonResponse(
      { error: 'invalid_client', error_description: 'Client authentication failed' },
      { ok: false, status: 401 },
    ),
    () => runQontoConnectionTest({ settings, env: {} }),
  );

  assert.equal(result.state, 'credentials_rejected');
  assert.equal(result.code, 'invalid_client');
  assert.equal(result.detail, 'Client authentication failed');
  assert.match(result.action, /Client secret/);
});

test('rule 9: with no credentials the test says so instead of failing opaquely', async () => {
  const { settings } = freshSettings();
  const result = await runQontoConnectionTest({ settings, env: {} });
  assert.equal(result.state, 'not_configured');
  assert.equal(settings.qontoHealth().lastError.code, 'QONTO_NOT_CONFIGURED');
});

test('rule 9: a bank connection whose link provider is off is not reported as fully working', async () => {
  const { settings } = freshSettings();
  connected(settings);
  const result = await withStubbedFetch(
    async () => jsonResponse({ status: 'not_connected' }),
    () => runQontoConnectionTest({ settings, env: {} }),
  );
  assert.equal(result.state, 'provider_not_connected');
});

// Rule 11 — the lie this spec removes: a stored token used to read as « Connecté ».
test('rule 11: a stored token alone never claims a working connection', () => {
  const { settings } = freshSettings();
  connected(settings);
  const status = qontoStatusPayload({ settings, env: {} });
  assert.equal(status.connected, true, 'a token IS stored');
  assert.equal(status.health.state, 'unverified', 'but nothing has been verified');
  assert.equal(status.health.ok, false);
});

test('rule 11: the badge turns ok only after a real call has succeeded', async () => {
  const { settings } = freshSettings();
  connected(settings);
  await withStubbedFetch(
    async () => jsonResponse({ status: 'enabled', bank_account_id: 'bank_1' }),
    () => runQontoConnectionTest({ settings, env: {} }),
  );
  const status = qontoStatusPayload({ settings, env: {} });
  assert.equal(status.health.state, 'ok');
  assert.ok(status.health.lastSuccessAt);
});

// Rule 11 — and it drops back as soon as a real call fails, wherever that call came from.
test('rule 11: a failure recorded elsewhere downgrades the badge', () => {
  const { settings } = freshSettings();
  connected(settings);
  settings.recordQontoHealth({
    lastSuccessAt: '2026-09-01T10:00:00Z',
    lastErrorAt: '2026-09-06T10:00:00Z',
    lastErrorCode: 'invalid_client',
    lastErrorMessage: 'Client authentication failed',
    lastErrorOrigin: 'public-payment',
  });
  const status = qontoStatusPayload({ settings, env: {} });
  assert.equal(status.health.state, 'credentials_rejected');
  assert.equal(status.health.lastError.origin, 'public-payment');
});

test('rule 11: an installation with no credentials reads as not configured', () => {
  const { settings } = freshSettings();
  assert.equal(qontoStatusPayload({ settings, env: {} }).health.state, 'not_configured');
});

test('rule 11: credentials without an authorisation ask for one', () => {
  const { settings } = freshSettings();
  settings.storeQontoCredentials({ clientId: 'cid', clientSecret: 'sec' });
  assert.equal(qontoStatusPayload({ settings, env: {} }).health.state, 'reauth_required');
});
