// The effective Qonto configuration: stored settings over environment variables.
// See specs/qonto-settings-in-app.md §3 rules 2, 4, 5, 8.

const test = require('node:test');
const assert = require('node:assert/strict');
const { freshSettings } = require('./qontoSettingsFixture');
const { resolveQontoConfig } = require('../utils/qontoConfig');
const { SANDBOX_HOSTS, PROD_HOSTS } = require('../utils/qontoClient');

const ENV = {
  QONTO_CLIENT_ID: 'env_client',
  QONTO_CLIENT_SECRET: 'env_secret',
  QONTO_STAGING_TOKEN: 'env_staging',
  QONTO_WEBHOOK_SECRET: 'env_webhook',
  PUBLIC_SITE_ORIGIN: 'https://env-site.example',
};

// Rule 2 — an installation configured through .env.local keeps working untouched.
test('rule 2: with nothing stored, the environment still provides every value', () => {
  const config = resolveQontoConfig({ settings: freshSettings().settings, env: ENV });
  assert.equal(config.clientId, 'env_client');
  assert.equal(config.clientSecret, 'env_secret');
  assert.equal(config.stagingToken, 'env_staging');
  assert.equal(config.webhookSecret, 'env_webhook');
  assert.equal(config.publicSiteOrigin, 'https://env-site.example');
  assert.equal(config.configured, true);
  assert.equal(config.sources.clientSecret, 'env');
});

// Rule 2 — the whole point: rotating a secret in the interface must beat the file.
test('rule 2: a stored value wins over the environment variable of the same role', () => {
  const { settings } = freshSettings();
  settings.storeQontoCredentials({ clientId: 'db_client', clientSecret: 'db_secret' });
  const config = resolveQontoConfig({ settings, env: ENV });
  assert.equal(config.clientId, 'db_client');
  assert.equal(config.clientSecret, 'db_secret');
  assert.equal(config.sources.clientId, 'db');
  assert.equal(config.sources.clientSecret, 'db');
  // Untouched roles still fall back.
  assert.equal(config.stagingToken, 'env_staging');
  assert.equal(config.sources.stagingToken, 'env');
});

// Rule 4 — the client id is a public identifier and must be comparable with the Qonto portal.
test('rule 4: the client id is exposed in clear by the resolved configuration', () => {
  const { settings } = freshSettings();
  settings.storeQontoCredentials({ clientId: 'cid_visible', clientSecret: 's3cr3t' });
  assert.equal(resolveQontoConfig({ settings, env: {} }).clientId, 'cid_visible');
});

// Rule 5 — the hosts follow the chosen environment.
test('rule 5: the environment chosen in the interface derives the hosts', () => {
  const { settings } = freshSettings();
  settings.storeQontoCredentials({ environment: 'production' });
  const config = resolveQontoConfig({ settings, env: {} });
  assert.equal(config.environment, 'production');
  assert.equal(config.sandbox, false);
  assert.equal(config.oauthBase, PROD_HOSTS.oauth);
  assert.equal(config.apiBase, PROD_HOSTS.api);
});

// Rule 5 — the regression this spec exists to prevent: production ran with QONTO_*_BASE pinned to
// the sandbox hosts, so an operator switching to "production" would silently stay on the sandbox.
test('rule 5: choosing the environment in the interface overrides the pinned host variables', () => {
  const { settings } = freshSettings();
  settings.storeQontoCredentials({ environment: 'production' });
  const config = resolveQontoConfig({
    settings,
    env: { QONTO_OAUTH_BASE: SANDBOX_HOSTS.oauth, QONTO_API_BASE: SANDBOX_HOSTS.api },
  });
  assert.equal(config.oauthBase, PROD_HOSTS.oauth);
  assert.equal(config.apiBase, PROD_HOSTS.api);
});

// Rule 5 — while the environment is inherited from the files, the file overrides still apply.
test('rule 5: with no environment chosen, the host variables keep overriding', () => {
  const config = resolveQontoConfig({
    settings: freshSettings().settings,
    env: { QONTO_OAUTH_BASE: 'https://oauth.example', QONTO_API_BASE: 'https://api.example' },
  });
  assert.equal(config.oauthBase, 'https://oauth.example');
  assert.equal(config.apiBase, 'https://api.example');
});

test('rule 5: sandbox is the default environment', () => {
  const config = resolveQontoConfig({ settings: freshSettings().settings, env: {} });
  assert.equal(config.environment, 'sandbox');
  assert.equal(config.sandbox, true);
  assert.equal(config.oauthBase, SANDBOX_HOSTS.oauth);
});

// Rule 8 — a secret copied from a web page carries whitespace, and Qonto rejects it like a wrong one.
test('rule 8: stored values are trimmed, and origins lose their trailing slash', () => {
  const { settings } = freshSettings();
  settings.storeQontoCredentials({
    clientId: '  cid_padded \n',
    clientSecret: '\tsecret_padded  ',
    publicSiteOrigin: 'https://site.example/// ',
  });
  const config = resolveQontoConfig({ settings, env: {} });
  assert.equal(config.clientId, 'cid_padded');
  assert.equal(config.clientSecret, 'secret_padded');
  assert.equal(config.publicSiteOrigin, 'https://site.example');
});

test('rule 2: the redirect URI derives from the public URL when no variable pins it', () => {
  const { settings } = freshSettings();
  settings.upsert({ publicUrl: 'https://guestflow.example/' });
  assert.equal(
    resolveQontoConfig({ settings, env: {} }).redirectUri,
    'https://guestflow.example/api/payments/qonto/callback',
  );
});

test('rule 2: an empty stored secret does not shadow the environment', () => {
  const { settings } = freshSettings();
  settings.storeQontoCredentials({ clientSecret: '' });
  const config = resolveQontoConfig({ settings, env: ENV });
  assert.equal(config.clientSecret, 'env_secret');
  assert.equal(config.sources.clientSecret, 'env');
});

test('rule 2: with neither source, nothing is configured', () => {
  const config = resolveQontoConfig({ settings: freshSettings().settings, env: {} });
  assert.equal(config.configured, false);
  assert.equal(config.sources.clientId, 'none');
});
