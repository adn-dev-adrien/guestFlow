/**
 * The Qonto settings of the instance, in plugin_settings (specs/plugins-phase-3a-online-payment.md
 * rule 13).
 *
 * The Qonto module (qonto/*) and the control plane speak to their settings through one set of method
 * names — `qontoTokens`, `storeQontoTokens`, `qontoCredentials`… — that GuestFlow's `settingsModel`
 * used to implement over `app_settings`. This store implements the same names over the plugin's own
 * settings, so the module is unchanged and the console keeps passing its own store.
 *
 * The keys are the old column names: the copy migration moves each value as it is stored, the five
 * secrets included (same AES-256-GCM key as `app_settings`).
 */

const KEYS = Object.freeze([
  'qontoAccessTokenEncrypted',
  'qontoRefreshTokenEncrypted',
  'qontoTokenExpiresAt',
  'qontoConnectionId',
  'qontoConnectionStatus',
  'qontoConnectedAt',
  'qontoEnvironment',
  'qontoClientId',
  'qontoClientSecretEncrypted',
  'qontoStagingTokenEncrypted',
  'qontoWebhookSecretEncrypted',
  'qontoLastCheckAt',
  'qontoLastSuccessAt',
  'qontoLastErrorAt',
  'qontoLastErrorCode',
  'qontoLastErrorMessage',
  'qontoLastErrorOrigin',
  'qontoWebhookSubscriptionId',
  'qontoWebhookCallbackUrl',
]);

const SECRET_KEYS = new Set([
  'qontoAccessTokenEncrypted',
  'qontoRefreshTokenEncrypted',
  'qontoClientSecretEncrypted',
  'qontoStagingTokenEncrypted',
  'qontoWebhookSecretEncrypted',
]);

// What `ctx.settings.declare` receives. The generic /api/plugins/online-payment/settings refuses every
// write: these values are set by the OAuth flow and the Paiements page, never typed by key.
const DECLARED = KEYS.map((key) => ({
  key,
  secret: SECRET_KEYS.has(key),
  validate: () => 'Réglé depuis Paramètres › Paiements en ligne.',
}));

/**
 * @param {object} deps
 * @param {object} deps.settings   ctx.settings (get, set, raw)
 * @param {() => object} deps.core the core settingsModel (publicUrl, publicSiteOrigin)
 */
function createSettingsStore({ settings, core }) {
  const str = (key) => String(settings.get(key) || '').trim();
  const put = (key, value) => settings.set(key, value == null ? '' : String(value));
  const putIfDefined = (key, value, transform = (v) => String(v).trim()) => {
    if (value === undefined) return;
    put(key, value == null ? '' : transform(value));
  };

  return {
    storeQontoTokens({ accessToken, refreshToken, expiresAt }) {
      put('qontoAccessTokenEncrypted', accessToken);
      put('qontoRefreshTokenEncrypted', refreshToken);
      put('qontoTokenExpiresAt', expiresAt);
      put('qontoConnectedAt', new Date().toISOString());
    },

    qontoTokens() {
      return {
        accessToken: str('qontoAccessTokenEncrypted'),
        refreshToken: str('qontoRefreshTokenEncrypted'),
        expiresAt: str('qontoTokenExpiresAt') || null,
      };
    },

    qontoCredentials() {
      return {
        environment: str('qontoEnvironment'),
        clientId: str('qontoClientId'),
        clientSecret: str('qontoClientSecretEncrypted'),
        stagingToken: str('qontoStagingTokenEncrypted'),
        webhookSecret: str('qontoWebhookSecretEncrypted'),
        // Core since rule 15: the return page of a public payment.
        publicSiteOrigin: core().publicSiteOrigin(),
        redirectUri: '',
      };
    },

    qontoSecretsPresence() {
      return {
        clientSecret: Boolean(settings.raw('qontoClientSecretEncrypted')),
        stagingToken: Boolean(settings.raw('qontoStagingTokenEncrypted')),
        webhookSecret: Boolean(settings.raw('qontoWebhookSecretEncrypted')),
      };
    },

    // `undefined` keeps, '' erases, values are trimmed (specs/qonto-settings-in-app.md rule 8). The
    // public site origin is not written here any more: it is a core setting (rule 15).
    storeQontoCredentials({ environment, clientId, clientSecret, stagingToken, webhookSecret } = {}) {
      putIfDefined('qontoEnvironment', environment, (v) => (String(v).trim().toLowerCase() === 'production' ? 'production' : 'sandbox'));
      putIfDefined('qontoClientId', clientId);
      putIfDefined('qontoClientSecretEncrypted', clientSecret);
      putIfDefined('qontoStagingTokenEncrypted', stagingToken);
      putIfDefined('qontoWebhookSecretEncrypted', webhookSecret);
    },

    qontoWebhookSubscription() {
      return { id: str('qontoWebhookSubscriptionId'), callbackUrl: str('qontoWebhookCallbackUrl') };
    },

    storeQontoWebhookSubscription({ id, callbackUrl } = {}) {
      putIfDefined('qontoWebhookSubscriptionId', id);
      putIfDefined('qontoWebhookCallbackUrl', callbackUrl);
    },

    recordQontoHealth({ lastCheckAt, lastSuccessAt, lastErrorAt, lastErrorCode, lastErrorMessage, lastErrorOrigin } = {}) {
      const keep = (v) => String(v);
      putIfDefined('qontoLastCheckAt', lastCheckAt, keep);
      putIfDefined('qontoLastSuccessAt', lastSuccessAt, keep);
      putIfDefined('qontoLastErrorAt', lastErrorAt, keep);
      putIfDefined('qontoLastErrorCode', lastErrorCode, keep);
      putIfDefined('qontoLastErrorMessage', lastErrorMessage, keep);
      putIfDefined('qontoLastErrorOrigin', lastErrorOrigin, keep);
    },

    // `lastError` is null once a success came after it (specs/qonto-settings-in-app.md rule 13).
    qontoHealth() {
      const errorAt = str('qontoLastErrorAt');
      const successAt = str('qontoLastSuccessAt');
      const stale = Boolean(errorAt && successAt && Date.parse(successAt) >= Date.parse(errorAt));
      return {
        lastCheckAt: str('qontoLastCheckAt') || null,
        lastSuccessAt: successAt || null,
        lastError: errorAt && !stale
          ? { at: errorAt, code: str('qontoLastErrorCode'), message: str('qontoLastErrorMessage'), origin: str('qontoLastErrorOrigin') }
          : null,
      };
    },

    storeQontoConnection({ connectionId, status }) {
      putIfDefined('qontoConnectionId', connectionId, (v) => String(v));
      putIfDefined('qontoConnectionStatus', status, (v) => String(v));
    },

    qontoConnectionInfo() {
      return {
        connected: Boolean(settings.raw('qontoRefreshTokenEncrypted')),
        connectionId: str('qontoConnectionId'),
        connectionStatus: str('qontoConnectionStatus') || 'not_connected',
        connectedAt: str('qontoConnectedAt') || null,
      };
    },

    qontoConnected() {
      return Boolean(settings.raw('qontoRefreshTokenEncrypted'));
    },

    // GuestFlow's own public URL: the OAuth redirect and the provider onboarding return.
    publicUrl() {
      return core().publicUrl();
    },
  };
}

// The store of the running instance, bound when the plugin registers. The Qonto modules fall back on
// it when no store is passed — the control plane always passes its own.
let bound = null;
const bind = (store) => { bound = store; };
const current = () => {
  if (!bound) throw new Error('[online-payment] settings store used before the plugin registered');
  return bound;
};

module.exports = { KEYS, SECRET_KEYS, DECLARED, createSettingsStore, bind, current };
