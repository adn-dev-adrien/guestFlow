// specs/qonto-settings-in-app.md rule 5, reading of 2026-11-05 (audit R23) — a host variable that does not name Qonto
// (a loopback fake, a dead port, a test double) wins even once an environment is stored: an auditor's probe relying on
// it reached the real Qonto API. A leftover variable naming a real Qonto host still gives way to the chosen environment,
// the regression rule 5 exists for, pinned in qonto-config.unit.test.js. Loopback only, nothing is dialled but the fake.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { freshSettings } = require('./qontoSettingsFixture');
const { resolveQontoConfig } = require('../../../utils/qonto/qontoConfig');
const { withQonto, qontoCredentialsPayload } = require('../../../utils/qonto/qontoService');
const { SANDBOX_HOSTS, PROD_HOSTS } = require('../../../utils/qonto/qontoClient');

const FAKE = 'http://127.0.0.1:9';

for (const environment of ['sandbox', 'production']) {
  test(`rule 5: a host variable that is not Qonto's wins over a stored ${environment}`, () => {
    const { settings } = freshSettings();
    settings.storeQontoCredentials({ environment });
    const config = resolveQontoConfig({ settings, env: { QONTO_API_BASE: FAKE, QONTO_OAUTH_BASE: `${FAKE}/` } });
    assert.equal(config.apiBase, FAKE);
    assert.equal(config.oauthBase, `${FAKE}/`);
    assert.equal(config.environment, environment, 'the environment itself stays the chosen one');
  });
}

test('rule 5: the page shows the host really called, the override included', () => {
  const { settings } = freshSettings();
  settings.storeQontoCredentials({ environment: 'production' });
  const payload = qontoCredentialsPayload({ settings, env: { QONTO_API_BASE: FAKE, QONTO_OAUTH_BASE: FAKE } });
  assert.equal(payload.apiBase, FAKE);
  assert.equal(payload.oauthBase, FAKE);
});

const realHosts = [
  SANDBOX_HOSTS.api, PROD_HOSTS.api, `${SANDBOX_HOSTS.api}/`, 'HTTPS://THIRDPARTY.QONTO.COM', 'https://thirdparty.qonto.com.', 'https://qonto.com',
];
for (const pinned of realHosts) {
  test(`rule 5: a leftover variable naming Qonto (${pinned}) gives way to the chosen environment`, () => {
    const { settings } = freshSettings();
    settings.storeQontoCredentials({ environment: 'production' });
    assert.equal(resolveQontoConfig({ settings, env: { QONTO_API_BASE: pinned } }).apiBase, PROD_HOSTS.api);
  });
}

test('rule 5: a look-alike of Qonto is not Qonto, so it is an override like any other', () => {
  const { settings } = freshSettings();
  settings.storeQontoCredentials({ environment: 'production' });
  const lookAlike = 'https://notqonto.com';
  assert.equal(resolveQontoConfig({ settings, env: { QONTO_API_BASE: lookAlike } }).apiBase, lookAlike);
});

test('rule 5: a stored environment with tokens dials the fake, the probe that reached the real API', async (t) => {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ webhook_subscriptions: [] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((done) => { server.closeAllConnections(); server.close(done); }));
  const base = `http://127.0.0.1:${server.address().port}`;

  const { settings } = freshSettings();
  settings.storeQontoCredentials({ environment: 'production', clientId: 'cid', clientSecret: 'sec' });
  settings.storeQontoTokens({ accessToken: 'at', refreshToken: 'rt', expiresAt: new Date(Date.now() + 3600_000).toISOString() });
  const env = { QONTO_API_BASE: base, QONTO_OAUTH_BASE: base };
  await withQonto({ settings, env, origin: 'test', recordSuccess: false }, (client, accessToken) => client.listWebhookSubscriptions({ accessToken }));
  assert.deepEqual(hits, ['GET /v2/webhook_subscriptions']);
});
