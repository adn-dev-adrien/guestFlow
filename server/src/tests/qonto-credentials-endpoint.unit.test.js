// The credentials the operator edits in Réglages → Paiements.
// See specs/qonto-settings-in-app.md §3 rules 1, 3, 6, 7, 16.

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshSettings } = require('./qontoSettingsFixture');
const { qontoCredentialsPayload, applyQontoCredentials } = require('../utils/qontoService');
const { resolveQontoConfig } = require('../utils/qontoConfig');

// Rule 1 — the whole point: rotating a secret must not need a file edit or a restart. Storing it
// and resolving it are the same act, so the next call to Qonto already uses the new value.
test('rule 1: a secret saved through the interface is what the next Qonto call will use', () => {
  const { settings } = freshSettings();
  applyQontoCredentials({ settings, env: {}, body: { clientId: 'cid_new', clientSecret: 'secret_new' } });
  const config = resolveQontoConfig({ settings, env: {} });
  assert.equal(config.clientId, 'cid_new');
  assert.equal(config.clientSecret, 'secret_new');
  assert.equal(config.configured, true);
});

test('rule 1: every application setting can be written from the same form', () => {
  const { settings } = freshSettings();
  applyQontoCredentials({
    settings,
    env: {},
    body: {
      environment: 'production',
      clientId: 'cid',
      clientSecret: 'sec',
      stagingToken: 'stg',
      webhookSecret: 'whk',
      publicSiteOrigin: 'https://site.example',
    },
  });
  const config = resolveQontoConfig({ settings, env: {} });
  assert.equal(config.environment, 'production');
  assert.equal(config.stagingToken, 'stg');
  assert.equal(config.webhookSecret, 'whk');
  assert.equal(config.publicSiteOrigin, 'https://site.example');
});

// Rule 3 — a secret in a payload is a secret in a log, a screenshot and a browser cache.
test('rule 3: no secret ever appears in the payload, only whether it is configured', () => {
  const { settings } = freshSettings();
  const payload = applyQontoCredentials({
    settings,
    env: {},
    body: { clientId: 'cid', clientSecret: 'super_secret', stagingToken: 'stg_secret', webhookSecret: 'whk_secret' },
  });
  const serialized = JSON.stringify(payload);
  assert.ok(!serialized.includes('super_secret'), 'the client secret must not be serialised');
  assert.ok(!serialized.includes('stg_secret'));
  assert.ok(!serialized.includes('whk_secret'));
  assert.equal(payload.secrets.clientSecret.configured, true);
  assert.equal(payload.secrets.clientSecret.source, 'db');
});

test('rule 3: an omitted secret keeps the stored one, an empty one erases it', () => {
  const { settings } = freshSettings();
  applyQontoCredentials({ settings, env: {}, body: { clientSecret: 'kept' } });

  applyQontoCredentials({ settings, env: {}, body: { clientId: 'cid' } });
  assert.equal(resolveQontoConfig({ settings, env: {} }).clientSecret, 'kept', 'omitted → untouched');

  applyQontoCredentials({ settings, env: {}, body: { clientSecret: '' } });
  assert.equal(resolveQontoConfig({ settings, env: {} }).clientSecret, '', 'empty → erased');
});

test('rule 3: the payload says a secret inherited from the environment is configured', () => {
  const { settings } = freshSettings();
  const payload = qontoCredentialsPayload({ settings, env: { QONTO_CLIENT_SECRET: 'from_env' } });
  assert.equal(payload.secrets.clientSecret.configured, true);
  assert.equal(payload.secrets.clientSecret.source, 'env');
  assert.ok(!JSON.stringify(payload).includes('from_env'));
});

// Rule 4 — the identifier the operator compares with the portal is readable.
test('rule 3/4: the client id is readable while the secrets are not', () => {
  const { settings } = freshSettings();
  const payload = applyQontoCredentials({ settings, env: {}, body: { clientId: 'cid_readable', clientSecret: 'hidden' } });
  assert.equal(payload.clientId, 'cid_readable');
  assert.ok(!JSON.stringify(payload).includes('hidden'));
});

// Rule 6 — the operator must be able to copy the redirect URI into the Qonto portal.
test('rule 6: the payload carries the redirect URI to declare at Qonto', () => {
  const { settings } = freshSettings();
  settings.upsert({ publicUrl: 'https://guestflow.example' });
  assert.equal(
    qontoCredentialsPayload({ settings, env: {} }).redirectUri,
    'https://guestflow.example/api/payments/qonto/callback',
  );
});

// Rule 7 — a payment tunnel with no return URL is as broken as one with a wrong secret.
test('rule 7: the public site origin is part of the same form', () => {
  const { settings } = freshSettings();
  const payload = applyQontoCredentials({ settings, env: {}, body: { publicSiteOrigin: 'https://www.domainesolio.com/' } });
  assert.equal(payload.publicSiteOrigin, 'https://www.domainesolio.com');
});

// Rule 16 — these settings hang under /api/payments/**, which the session guard already covers.
test('rule 16: the credential routes are declared under the guarded /api/payments router', () => {
  const routes = require('../routes/payments').stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);
  assert.ok(routes.includes('GET /qonto/credentials'));
  assert.ok(routes.includes('PUT /qonto/credentials'));
  assert.ok(routes.includes('POST /qonto/test'));
});

// Rule 5 (companion) — the page shows what will actually be called, so it can never be a guess.
test('rule 6: the payload exposes the hosts the current environment resolves to', () => {
  const { settings } = freshSettings();
  applyQontoCredentials({ settings, env: {}, body: { environment: 'production' } });
  const payload = qontoCredentialsPayload({ settings, env: {} });
  assert.match(payload.oauthBase, /oauth\.qonto\.com/);
  assert.match(payload.apiBase, /thirdparty\.qonto\.com/);
});
