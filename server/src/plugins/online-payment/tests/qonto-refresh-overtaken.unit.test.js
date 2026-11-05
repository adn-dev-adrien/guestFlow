// specs/qonto-settings-in-app.md rule 19 (audit R23, E23-4) — a refresh in flight stores nothing once the token it
// refreshed is no longer the stored one: it used to bring back a connection built on the old application's tokens over
// new credentials, or over a new consent. Injected client, no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { freshSettings } = require('./qontoSettingsFixture');
const { getValidQontoAccessToken } = require('../../../utils/qonto/qontoAuth');
const { applyQontoCredentials, withQonto } = require('../../../utils/qonto/qontoService');

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

// A loopback token endpoint whose refresh waits for `gate`, then answers 401 when `refuse`.
async function fakeTokenEndpoint(t, { refuse = false } = {}) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const seen = { refreshes: 0 };
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', async () => {
      res.setHeader('content-type', 'application/json');
      seen.refreshes += 1;
      await gate;
      if (refuse) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ error: 'invalid_grant' }));
      }
      return res.end(JSON.stringify({ access_token: 'at-old-family', refresh_token: 'rt-old-family', expires_in: 3600 }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((done) => { server.closeAllConnections(); server.close(done); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { env: { QONTO_API_BASE: base, QONTO_OAUTH_BASE: base }, release, seen };
}
const refreshStarted = async (fake) => { while (fake.seen.refreshes === 0) await new Promise((resolve) => setImmediate(resolve)); };

test('rule 19: a save during a refresh leaves the health it had just cleared', async (t) => {
  const settings = expiredInstallation('rt-health-save');
  const fake = await fakeTokenEndpoint(t);
  const call = withQonto({ settings, env: fake.env, origin: 'poll' }, (_client, token) => token);
  await refreshStarted(fake);
  applyQontoCredentials({ settings, env: fake.env, body: { environment: 'production', clientId: 'cid-prod', clientSecret: 'sec-prod' } });
  fake.release();
  await assert.rejects(call, { code: 'QONTO_NOT_CONNECTED' });
  assert.equal(settings.qontoHealth().lastError, null);
});

test('rule 19: a consent during a refresh that then fails: fresh tokens, no failure recorded, the caller goes on', async (t) => {
  const settings = expiredInstallation('rt-health-consent');
  const fake = await fakeTokenEndpoint(t, { refuse: true });
  const call = withQonto({ settings, env: fake.env, origin: 'poll', recordSuccess: false }, (_client, token) => token);
  await refreshStarted(fake);
  settings.storeQontoTokens({ accessToken: 'at-new-consent', refreshToken: 'rt-new-consent', expiresAt: future() });
  fake.release();
  assert.equal(await call, 'at-new-consent');
  assert.equal(settings.qontoTokens().refreshToken, 'rt-new-consent');
  assert.equal(settings.qontoHealth().lastError, null);
});

test('rule 19: a refresh that fails and nothing overtook still records its failure', async (t) => {
  const settings = expiredInstallation('rt-health-plain');
  const fake = await fakeTokenEndpoint(t, { refuse: true });
  fake.release();
  await assert.rejects(withQonto({ settings, env: fake.env, origin: 'poll' }, (_client, token) => token));
  assert.ok(settings.qontoHealth().lastError);
});
