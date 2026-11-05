// specs/qonto-settings-in-app.md rule 19 (audit R23, E23-4) — a refresh in flight stores nothing once the token it
// refreshed is no longer the stored one: it used to bring back a connection built on the old application's tokens over
// new credentials, or over a new consent. Injected client, no network.
const test = require('node:test');
const assert = require('node:assert/strict');

const { freshSettings } = require('./qontoSettingsFixture');
const { getValidQontoAccessToken } = require('../../../utils/qonto/qontoAuth');
const { applyQontoCredentials } = require('../../../utils/qonto/qontoService');

const past = () => new Date(Date.now() - 3600_000).toISOString();
const future = () => new Date(Date.now() + 3600_000).toISOString();

function heldRefresh() {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const clientFactory = () => ({
    refresh: async () => {
      calls += 1;
      await gate;
      return { accessToken: 'at-old-family', refreshToken: 'rt-old-family', expiresIn: 3600 };
    },
  });
  return { clientFactory, release, calls: () => calls };
}

function expiredInstallation(refreshToken) {
  const { settings } = freshSettings();
  settings.storeQontoCredentials({ environment: 'sandbox', clientId: 'cid', clientSecret: 'sec' });
  settings.storeQontoTokens({ accessToken: 'at-expired', refreshToken, expiresAt: past() });
  settings.storeQontoConnection({ status: 'enabled', connectionId: 'b' });
  return settings;
}

test('rule 19: new credentials saved during a refresh stay disconnected once it lands', async () => {
  const settings = expiredInstallation('rt-overtaken-by-a-save');
  const held = heldRefresh();
  const call = getValidQontoAccessToken({ settings, clientFactory: held.clientFactory });

  const saved = applyQontoCredentials({ settings, env: {}, body: { environment: 'production', clientId: 'cid-prod', clientSecret: 'sec-prod' } });
  assert.equal(saved.tokensCleared, true);
  held.release();

  await assert.rejects(call, { code: 'QONTO_NOT_CONNECTED' });
  assert.equal(settings.qontoConnected(), false);
  assert.equal(settings.qontoTokens().refreshToken, '');
  assert.equal(settings.qontoCredentials().environment, 'production');
});

test('rule 19: a consent during a refresh keeps its tokens, and the caller gets them', async () => {
  const settings = expiredInstallation('rt-overtaken-by-a-consent');
  const held = heldRefresh();
  const call = getValidQontoAccessToken({ settings, clientFactory: held.clientFactory });

  settings.storeQontoTokens({ accessToken: 'at-new-consent', refreshToken: 'rt-new-consent', expiresAt: future() });
  held.release();

  assert.equal(await call, 'at-new-consent');
  assert.equal(settings.qontoTokens().refreshToken, 'rt-new-consent');
});

test('rule 19: a refresh nothing overtook stores its pair, as before', async () => {
  const settings = expiredInstallation('rt-not-overtaken');
  const held = heldRefresh();
  const call = getValidQontoAccessToken({ settings, clientFactory: held.clientFactory });
  held.release();
  assert.equal(await call, 'at-old-family');
  assert.equal(settings.qontoTokens().refreshToken, 'rt-old-family');
  assert.equal(held.calls(), 1);
});
