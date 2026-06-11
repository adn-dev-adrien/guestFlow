// qontoAuth.getValidQontoAccessToken — reuse-or-refresh logic. See specs/online-payments-qonto.md §4.1.

const test = require('node:test');
const assert = require('node:assert/strict');

const { getValidQontoAccessToken } = require('../utils/qontoAuth');

// A settings double exposing the two methods the manager touches.
function fakeSettings(tokens) {
  const state = { ...tokens };
  return {
    qontoTokens: () => ({ accessToken: state.accessToken || '', refreshToken: state.refreshToken || '', expiresAt: state.expiresAt || null }),
    storeQontoTokens: (t) => { state.accessToken = t.accessToken; state.refreshToken = t.refreshToken; state.expiresAt = t.expiresAt; },
    _state: state,
  };
}

const NOW = Date.parse('2026-06-20T12:00:00Z');

test('reuses a still-fresh access token without calling refresh', async () => {
  const settings = fakeSettings({ accessToken: 'at_fresh', refreshToken: 'rt', expiresAt: new Date(NOW + 3600_000).toISOString() });
  let refreshed = false;
  const clientFactory = () => ({ refresh: async () => { refreshed = true; return {}; } });
  const tok = await getValidQontoAccessToken({ settings, clientFactory, now: NOW });
  assert.equal(tok, 'at_fresh');
  assert.equal(refreshed, false);
});

test('refreshes + persists when the access token is expired', async () => {
  const settings = fakeSettings({ accessToken: 'at_old', refreshToken: 'rt_old', expiresAt: new Date(NOW - 1000).toISOString() });
  const clientFactory = () => ({
    refresh: async ({ refreshToken }) => {
      assert.equal(refreshToken, 'rt_old');
      return { accessToken: 'at_new', refreshToken: 'rt_new', expiresIn: 3600 };
    },
  });
  const tok = await getValidQontoAccessToken({ settings, clientFactory, now: NOW });
  assert.equal(tok, 'at_new');
  // Persisted the new pair + a computed expiry.
  assert.equal(settings._state.accessToken, 'at_new');
  assert.equal(settings._state.refreshToken, 'rt_new');
  assert.equal(settings._state.expiresAt, new Date(NOW + 3600_000).toISOString());
});

test('refreshes when there is a refresh token but no/unknown expiry', async () => {
  const settings = fakeSettings({ accessToken: '', refreshToken: 'rt', expiresAt: null });
  const clientFactory = () => ({ refresh: async () => ({ accessToken: 'at_x', refreshToken: 'rt', expiresIn: 1800 }) });
  const tok = await getValidQontoAccessToken({ settings, clientFactory, now: NOW });
  assert.equal(tok, 'at_x');
});

test('refreshes within the skew window (about to expire)', async () => {
  const settings = fakeSettings({ accessToken: 'at_soon', refreshToken: 'rt', expiresAt: new Date(NOW + 30_000).toISOString() });
  let refreshed = false;
  const clientFactory = () => ({ refresh: async () => { refreshed = true; return { accessToken: 'at_new', refreshToken: 'rt', expiresIn: 3600 }; } });
  const tok = await getValidQontoAccessToken({ settings, clientFactory, now: NOW });
  assert.equal(refreshed, true);
  assert.equal(tok, 'at_new');
});

test('throws QONTO_NOT_CONNECTED when no refresh token is stored', async () => {
  const settings = fakeSettings({ accessToken: '', refreshToken: '', expiresAt: null });
  await assert.rejects(
    () => getValidQontoAccessToken({ settings, clientFactory: () => ({ refresh: async () => ({}) }), now: NOW }),
    (err) => { assert.equal(err.code, 'QONTO_NOT_CONNECTED'); return true; },
  );
});
