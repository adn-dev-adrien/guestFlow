// Recording what the last real call to Qonto did, wherever it was made from.
// See specs/qonto-settings-in-app.md §3 rules 12, 13.

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshSettings } = require('./qontoSettingsFixture');
const { withQonto, recordQontoSuccess, recordQontoFailure } = require('../utils/qontoService');

function connected(settings) {
  settings.storeQontoCredentials({ clientId: 'cid', clientSecret: 'sec' });
  settings.storeQontoTokens({ accessToken: 'at', refreshToken: 'rt', expiresAt: '2099-01-01T00:00:00Z' });
  return settings;
}

function qontoError(status, body) {
  const err = new Error(`Qonto call failed (HTTP ${status})`);
  err.status = status;
  err.body = body;
  return err;
}

// Rule 12 — the failure happened in the public payment path and the settings page knew nothing.
test('rule 12: a failure in the public payment path is recorded with its code and its origin', async () => {
  const { settings } = freshSettings();
  connected(settings);

  await assert.rejects(
    withQonto({ settings, env: {}, origin: 'public-payment' }, () => {
      throw qontoError(401, { error: 'invalid_client', error_description: 'Client authentication failed' });
    }),
  );

  const { lastError } = settings.qontoHealth();
  assert.equal(lastError.code, 'invalid_client');
  assert.equal(lastError.message, 'Client authentication failed');
  assert.equal(lastError.origin, 'public-payment');
  assert.ok(lastError.at);
});

test('rule 12: the scheduled poll records under its own origin', async () => {
  const { settings } = freshSettings();
  connected(settings);
  await assert.rejects(withQonto({ settings, env: {}, origin: 'poll' }, () => { throw qontoError(500, {}); }));
  assert.equal(settings.qontoHealth().lastError.origin, 'poll');
});

// Rule 12 — a call that never leaves because nothing is configured is a failure like any other.
test('rule 12: missing credentials are recorded rather than thrown into the void', async () => {
  const { settings } = freshSettings();
  await assert.rejects(withQonto({ settings, env: {}, origin: 'manual-link' }, () => 'never runs'));
  assert.equal(settings.qontoHealth().lastError.code, 'QONTO_NOT_CONFIGURED');
});

// Rule 14 (companion): the caller's own error handling is untouched — the error propagates as-is.
test('rule 12: recording does not swallow the error the caller must still handle', async () => {
  const { settings } = freshSettings();
  connected(settings);
  const thrown = qontoError(502, { error: 'upstream' });
  await assert.rejects(
    withQonto({ settings, env: {}, origin: 'public-payment' }, () => { throw thrown; }),
    (err) => err === thrown,
  );
});

// Rule 13 — the page must show the current state, not an old scar.
test('rule 13: a success clears the recorded failure', async () => {
  const { settings } = freshSettings();
  connected(settings);

  recordQontoFailure({ settings, error: qontoError(401, { error: 'invalid_client' }), origin: 'poll' });
  assert.ok(settings.qontoHealth().lastError);

  const result = await withQonto({ settings, env: {}, origin: 'poll' }, () => 'ok');
  assert.equal(result, 'ok');
  const health = settings.qontoHealth();
  assert.equal(health.lastError, null);
  assert.ok(health.lastSuccessAt);
});

// Rule 13 — even without the columns being wiped, a success that came AFTER a failure wins.
test('rule 13: a failure older than the last success is not shown', () => {
  const { settings } = freshSettings();
  settings.recordQontoHealth({
    lastErrorAt: '2026-09-01T10:00:00Z',
    lastErrorCode: 'invalid_client',
    lastErrorMessage: 'old',
    lastErrorOrigin: 'poll',
    lastSuccessAt: '2026-09-06T10:00:00Z',
  });
  assert.equal(settings.qontoHealth().lastError, null);
});

test('rule 12: a failure newer than the last success is shown', () => {
  const { settings } = freshSettings();
  settings.recordQontoHealth({
    lastSuccessAt: '2026-09-01T10:00:00Z',
    lastErrorAt: '2026-09-06T10:00:00Z',
    lastErrorCode: 'invalid_client',
    lastErrorMessage: 'fresh',
    lastErrorOrigin: 'public-payment',
  });
  assert.equal(settings.qontoHealth().lastError.message, 'fresh');
});

test('rule 13: recordQontoSuccess stamps both the check and the success', () => {
  const { settings } = freshSettings();
  recordQontoSuccess({ settings, now: new Date('2026-09-07T08:00:00Z') });
  const health = settings.qontoHealth();
  assert.equal(health.lastCheckAt, '2026-09-07T08:00:00.000Z');
  assert.equal(health.lastSuccessAt, '2026-09-07T08:00:00.000Z');
  assert.equal(health.lastError, null);
});
