/**
 * The effective Qonto configuration — specs/qonto-settings-in-app.md §3 rules 2, 4, 5, 8.
 *
 * Until 2026-09-07 the client id, the secret and the hosts could only come from `server/.env.local`,
 * so rotating a secret Qonto had regenerated meant an SSH session and a restart. This module is the
 * single place that answers "what will GuestFlow actually send to Qonto?", by merging the settings
 * an operator can edit in the interface over the environment an installation was set up with.
 *
 * Precedence (rule 2): a non-empty stored value wins; otherwise the environment variable of the same
 * role still applies, so an installation that never opens the new form keeps its current behaviour.
 *
 * The hosts follow the environment (rule 5). `QONTO_OAUTH_BASE` / `QONTO_API_BASE` keep overriding
 * them ONLY while no environment has been chosen in the interface: production runs with those two
 * variables pinned to the sandbox hosts, and an operator switching to "production" in the interface
 * must not stay silently on the sandbox — that is the exact class of bug this spec exists to remove.
 */
const { SANDBOX_HOSTS, PROD_HOSTS } = require('./qontoClient');

const CALLBACK_PATH = '/api/payments/qonto/callback';

const clean = (value) => String(value ?? '').trim();

/** An origin is compared and stored without its trailing slash, so two spellings never disagree. */
const cleanOrigin = (value) => clean(value).replace(/\/+$/, '');

/**
 * A value and where it came from. `source` is what lets the interface tell the operator whether a
 * credential is one they can edit here (`db`) or one inherited from the server's files (`env`).
 */
function pick(stored, fromEnv) {
  const db = clean(stored);
  if (db) return { value: db, source: 'db' };
  const env = clean(fromEnv);
  if (env) return { value: env, source: 'env' };
  return { value: '', source: 'none' };
}

/** The stored credentials, tolerating a settings model whose schema predates them. */
function storedCredentials(settings) {
  if (!settings || typeof settings.qontoCredentials !== 'function') return {};
  try {
    return settings.qontoCredentials() || {};
  } catch {
    return {};
  }
}

function publicUrlOf(settings) {
  if (!settings || typeof settings.publicUrl !== 'function') return '';
  try {
    return cleanOrigin(settings.publicUrl());
  } catch {
    return '';
  }
}

/**
 * @param {{settings?: object, env?: object}} deps
 * @returns {{environment: string, sandbox: boolean, clientId: string, clientSecret: string,
 *   stagingToken: string, webhookSecret: string, publicSiteOrigin: string, oauthBase: string,
 *   apiBase: string, redirectUri: string, configured: boolean, sources: object}}
 */
function resolveQontoConfig({ settings, env = process.env } = {}) {
  const stored = storedCredentials(settings);

  const environment = pick(stored.environment, env.QONTO_ENV);
  const effectiveEnvironment = environment.value.toLowerCase() === 'production' ? 'production' : 'sandbox';
  const sandbox = effectiveEnvironment !== 'production';
  const hosts = sandbox ? SANDBOX_HOSTS : PROD_HOSTS;

  // Host overrides apply only while the environment is inherited from the files (see the header).
  const chosenInApp = environment.source === 'db';
  const oauthBase = chosenInApp ? hosts.oauth : (clean(env.QONTO_OAUTH_BASE) || hosts.oauth);
  const apiBase = chosenInApp ? hosts.api : (clean(env.QONTO_API_BASE) || hosts.api);

  const clientId = pick(stored.clientId, env.QONTO_CLIENT_ID);
  const clientSecret = pick(stored.clientSecret, env.QONTO_CLIENT_SECRET);
  const stagingToken = pick(stored.stagingToken, env.QONTO_STAGING_TOKEN);
  const webhookSecret = pick(stored.webhookSecret, env.QONTO_WEBHOOK_SECRET);
  const publicSiteOrigin = pick(cleanOrigin(stored.publicSiteOrigin), cleanOrigin(env.PUBLIC_SITE_ORIGIN));

  const publicUrl = publicUrlOf(settings);
  const redirectUri = pick(
    stored.redirectUri,
    clean(env.QONTO_REDIRECT_URI) || (publicUrl ? `${publicUrl}${CALLBACK_PATH}` : ''),
  );

  return {
    environment: effectiveEnvironment,
    sandbox,
    clientId: clientId.value,
    clientSecret: clientSecret.value,
    stagingToken: stagingToken.value,
    webhookSecret: webhookSecret.value,
    publicSiteOrigin: publicSiteOrigin.value,
    oauthBase,
    apiBase,
    redirectUri: redirectUri.value,
    configured: Boolean(clientId.value && clientSecret.value),
    sources: {
      environment: environment.source,
      clientId: clientId.source,
      clientSecret: clientSecret.source,
      stagingToken: stagingToken.source,
      webhookSecret: webhookSecret.source,
      publicSiteOrigin: publicSiteOrigin.source,
      redirectUri: redirectUri.source,
    },
  };
}

module.exports = { resolveQontoConfig, CALLBACK_PATH };
