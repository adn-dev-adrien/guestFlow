/**
 * The one door to Qonto — specs/qonto-settings-in-app.md §3 rules 9, 11, 12, 13.
 *
 * Every call to Qonto now goes through `withQonto`, for a reason the 2026-09-06 outage made plain:
 * the failure happened in the public payment path, and the operator's settings page — the only place
 * anyone would look — knew nothing about it. Routing the calls through a single function means a
 * failure anywhere is recorded once, in one shape, and shown in one place.
 *
 * `buildQontoClient` stays pure and env-free; this module is what hands it its configuration.
 */
const { buildQontoClient } = require('./qontoClient');
const { getValidQontoAccessToken } = require('./qontoAuth');
const { resolveQontoConfig } = require('./qontoConfig');
const { classifyQontoOutcome, qontoConnectionState, errorCodeOf, errorMessageOf } = require('./qontoHealth');
const settingsModelDefault = require('../models/settingsModel');

/** Where a call came from, so the operator reads "le paiement public a échoué", not "une erreur". */
const ORIGINS = {
  test: 'test de connexion',
  'public-payment': 'paiement public',
  poll: 'vérification automatique',
  'manual-link': 'lien créé à la main',
  webhook: 'notification Qonto',
  admin: 'réglages',
};

function notConfiguredError() {
  const err = new Error('Identifiants Qonto manquants');
  err.code = 'QONTO_NOT_CONFIGURED';
  return err;
}

/** A client wired with the effective configuration (database over environment). */
function buildConfiguredQontoClient({ settings = settingsModelDefault, env = process.env, config } = {}) {
  const resolved = config || resolveQontoConfig({ settings, env });
  return buildQontoClient({
    sandbox: resolved.sandbox,
    oauthBase: resolved.oauthBase,
    apiBase: resolved.apiBase,
    clientId: resolved.clientId,
    clientSecret: resolved.clientSecret,
    stagingToken: resolved.stagingToken,
  });
}

/** Rule 13: a success erases the recorded failure, so the page shows now and not last month. */
function recordQontoSuccess({ settings = settingsModelDefault, now = new Date() } = {}) {
  if (!settings || typeof settings.recordQontoHealth !== 'function') return;
  const at = now.toISOString();
  settings.recordQontoHealth({ lastCheckAt: at, lastSuccessAt: at, lastErrorAt: '', lastErrorCode: '', lastErrorMessage: '', lastErrorOrigin: '' });
}

/** Rule 12: a failure is recorded with its code, its message and where it happened. */
function recordQontoFailure({ settings = settingsModelDefault, error, origin = 'admin', now = new Date() } = {}) {
  if (!settings || typeof settings.recordQontoHealth !== 'function') return;
  const at = now.toISOString();
  settings.recordQontoHealth({
    lastCheckAt: at,
    lastErrorAt: at,
    lastErrorCode: errorCodeOf(error).slice(0, 120),
    lastErrorMessage: errorMessageOf(error).slice(0, 500),
    lastErrorOrigin: origin,
  });
}

/**
 * Run `fn(client, accessToken)` against Qonto, recording the outcome (rules 12-13).
 *
 * Failures are re-thrown unchanged: callers keep their own error handling — the public tunnel keeps
 * answering its generic message (rule 14) — and the recording is a side effect they need not know about.
 */
async function withQonto({ settings = settingsModelDefault, env = process.env, origin = 'admin' }, fn) {
  const config = resolveQontoConfig({ settings, env });
  try {
    if (!config.configured) throw notConfiguredError();
    const client = buildConfiguredQontoClient({ settings, env, config });
    const accessToken = await getValidQontoAccessToken({ settings, clientFactory: () => client });
    const result = await fn(client, accessToken, config);
    recordQontoSuccess({ settings });
    return result;
  } catch (error) {
    recordQontoFailure({ settings, error, origin });
    throw error;
  }
}

/**
 * The connection test (rule 9): a real authenticated call, classified (rule 10).
 *
 * It goes one step further than a token refresh and reads the provider connection, because a bank
 * connection that works while the link provider is not enabled produces payment links that cannot be
 * paid — a state the old page displayed as a plain « Connecté ».
 */
async function runQontoConnectionTest({ settings = settingsModelDefault, env = process.env, now = new Date() } = {}) {
  const config = resolveQontoConfig({ settings, env });
  if (!config.configured) {
    const error = notConfiguredError();
    recordQontoFailure({ settings, error, origin: 'test', now });
    return { ...classifyQontoOutcome(error, { configured: false }), checkedAt: now.toISOString() };
  }
  try {
    const connection = await withQonto({ settings, env, origin: 'test' }, (client, accessToken) =>
      client.getConnection({ accessToken }));
    const providerEnabled = String(connection?.status || '') === 'enabled';
    if (typeof settings.storeQontoConnection === 'function') {
      settings.storeQontoConnection({ status: connection?.status || 'not_connected', connectionId: connection?.bankAccountId || undefined });
    }
    return { ...classifyQontoOutcome(null, { providerEnabled }), checkedAt: now.toISOString() };
  } catch (error) {
    return { ...classifyQontoOutcome(error, { configured: true }), checkedAt: now.toISOString() };
  }
}

// ----- What the settings page reads and writes (rules 1, 3, 4, 11, 15) -----

/** The credentials payload: secrets masked to booleans (rule 3), client id in clear (rule 4). */
function qontoCredentialsPayload({ settings = settingsModelDefault, env = process.env } = {}) {
  const config = resolveQontoConfig({ settings, env });
  const present = typeof settings.qontoSecretsPresence === 'function'
    ? settings.qontoSecretsPresence()
    : { clientSecret: false, stagingToken: false, webhookSecret: false };
  const secret = (name) => ({
    configured: Boolean(present[name]) || config.sources[name] === 'env',
    source: present[name] ? 'db' : config.sources[name],
  });
  return {
    environment: config.environment,
    clientId: config.clientId,
    clientIdSource: config.sources.clientId,
    oauthBase: config.oauthBase,
    apiBase: config.apiBase,
    redirectUri: config.redirectUri,
    publicSiteOrigin: config.publicSiteOrigin,
    secrets: {
      clientSecret: secret('clientSecret'),
      stagingToken: secret('stagingToken'),
      webhookSecret: secret('webhookSecret'),
    },
  };
}

/** The verified state the badge renders (rule 11): a stored token is not a working connection. */
function qontoStatusPayload({ settings = settingsModelDefault, env = process.env } = {}) {
  const config = resolveQontoConfig({ settings, env });
  const info = settings.qontoConnectionInfo();
  const health = typeof settings.qontoHealth === 'function'
    ? settings.qontoHealth()
    : { lastCheckAt: null, lastSuccessAt: null, lastError: null };
  return {
    ...info,
    configured: config.configured,
    sandbox: config.sandbox,
    environment: config.environment,
    health: {
      ...health,
      ...qontoConnectionState({
        configured: config.configured,
        hasToken: info.connected,
        providerEnabled: info.connectionStatus === 'enabled',
        health,
      }),
    },
  };
}

/**
 * Save the credentials (rule 1) and, when the application identity changed, drop the authorisation
 * that belonged to the old one (rule 15).
 *
 * Keeping those tokens would leave the page showing a connection that cannot work — which is the
 * precise lie this spec exists to remove.
 */
function applyQontoCredentials({ settings = settingsModelDefault, env = process.env, body = {} } = {}) {
  const before = resolveQontoConfig({ settings, env });

  settings.storeQontoCredentials({
    environment: body.environment,
    clientId: body.clientId,
    clientSecret: body.clientSecret,
    stagingToken: body.stagingToken,
    webhookSecret: body.webhookSecret,
    publicSiteOrigin: body.publicSiteOrigin,
  });

  const after = resolveQontoConfig({ settings, env });
  const identityChanged = after.clientId !== before.clientId
    || after.environment !== before.environment
    || after.clientSecret !== before.clientSecret;

  let tokensCleared = false;
  if (identityChanged && settings.qontoConnected()) {
    settings.storeQontoTokens({ accessToken: '', refreshToken: '', expiresAt: '' });
    settings.storeQontoConnection({ status: 'not_connected', connectionId: '' });
    tokensCleared = true;
  }
  if (identityChanged) {
    // The recorded health belongs to the previous credentials; keeping it would misname the next repair.
    settings.recordQontoHealth({ lastCheckAt: '', lastSuccessAt: '', lastErrorAt: '', lastErrorCode: '', lastErrorMessage: '', lastErrorOrigin: '' });
  }

  return { ...qontoCredentialsPayload({ settings, env }), tokensCleared };
}

module.exports = {
  buildConfiguredQontoClient,
  withQonto,
  runQontoConnectionTest,
  recordQontoSuccess,
  recordQontoFailure,
  qontoCredentialsPayload,
  qontoStatusPayload,
  applyQontoCredentials,
  ORIGINS,
};
