/**
 * The settings GuestFlow's Qonto module reads and writes (specs/control-plane-plans-and-access.md
 * rule 32), on the console's own `qonto_settings` row. Same method names and the same semantics as
 * GuestFlow's `settingsModel` (server/src/models/settingsModel.js), so the shared `qontoService`,
 * `qontoWebhookRegistrar` and `qontoSettingsController` run over it unchanged:
 *   - a key left `undefined` keeps its stored value, `''` erases it;
 *   - secrets and tokens are encrypted at rest with the console's key; a value that no longer
 *     decrypts reads as empty, so the connection shows as missing rather than crashing.
 */

const ENCRYPTED = new Set([
  'qontoClientSecretEncrypted', 'qontoStagingTokenEncrypted', 'qontoWebhookSecretEncrypted',
  'qontoAccessTokenEncrypted', 'qontoRefreshTokenEncrypted',
]);

function buildQontoSettingsModel(db, { secrets, publicUrl = '' }) {
  const readStmt = db.prepare('SELECT * FROM qonto_settings WHERE id = 1');
  const read = () => readStmt.get() || {};
  const str = (row, col) => String(row[col] || '').trim();

  function dec(row, col) {
    if (!row[col]) return '';
    try {
      return secrets.decrypt(row[col]);
    } catch {
      console.warn(`[qonto-settings] ${col} could not be decrypted; treated as empty`);
      return '';
    }
  }

  function upsert(payload) {
    const cols = Object.keys(payload);
    if (!cols.length) return;
    const values = cols.map((c) => {
      const v = payload[c] == null ? '' : String(payload[c]);
      return ENCRYPTED.has(c) && v ? secrets.encrypt(v) : v;
    });
    db.prepare(`UPDATE qonto_settings SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = 1`).run(...values);
  }

  const model = {
    publicUrl: () => String(publicUrl || '').trim(),

    qontoCredentials() {
      const row = read();
      return {
        environment: str(row, 'qontoEnvironment'),
        clientId: str(row, 'qontoClientId'),
        clientSecret: dec(row, 'qontoClientSecretEncrypted'),
        stagingToken: dec(row, 'qontoStagingTokenEncrypted'),
        webhookSecret: dec(row, 'qontoWebhookSecretEncrypted'),
        publicSiteOrigin: str(row, 'publicSiteOrigin'),
        redirectUri: '',
      };
    },

    qontoSecretsPresence() {
      const row = read();
      return {
        clientSecret: Boolean(row.qontoClientSecretEncrypted),
        stagingToken: Boolean(row.qontoStagingTokenEncrypted),
        webhookSecret: Boolean(row.qontoWebhookSecretEncrypted),
      };
    },

    storeQontoCredentials({ environment, clientId, clientSecret, stagingToken, webhookSecret, publicSiteOrigin } = {}) {
      const payload = {};
      const set = (col, value, transform = (v) => String(v).trim()) => {
        if (value === undefined) return;
        payload[col] = value == null ? '' : transform(value);
      };
      set('qontoEnvironment', environment, (v) => (String(v).trim().toLowerCase() === 'production' ? 'production' : 'sandbox'));
      set('qontoClientId', clientId);
      set('qontoClientSecretEncrypted', clientSecret);
      set('qontoStagingTokenEncrypted', stagingToken);
      set('qontoWebhookSecretEncrypted', webhookSecret);
      set('publicSiteOrigin', publicSiteOrigin, (v) => String(v).trim().replace(/\/+$/, ''));
      upsert(payload);
    },

    storeQontoTokens({ accessToken, refreshToken, expiresAt }) {
      upsert({
        qontoAccessTokenEncrypted: accessToken,
        qontoRefreshTokenEncrypted: refreshToken,
        qontoTokenExpiresAt: expiresAt,
        qontoConnectedAt: new Date().toISOString(),
      });
    },

    qontoTokens() {
      const row = read();
      return {
        accessToken: dec(row, 'qontoAccessTokenEncrypted'),
        refreshToken: dec(row, 'qontoRefreshTokenEncrypted'),
        expiresAt: str(row, 'qontoTokenExpiresAt') || null,
      };
    },

    qontoWebhookSubscription() {
      const row = read();
      return { id: str(row, 'qontoWebhookSubscriptionId'), callbackUrl: str(row, 'qontoWebhookCallbackUrl') };
    },

    storeQontoWebhookSubscription({ id, callbackUrl } = {}) {
      const payload = {};
      if (id !== undefined) payload.qontoWebhookSubscriptionId = id == null ? '' : String(id).trim();
      if (callbackUrl !== undefined) payload.qontoWebhookCallbackUrl = callbackUrl == null ? '' : String(callbackUrl).trim();
      upsert(payload);
    },

    recordQontoHealth({ lastCheckAt, lastSuccessAt, lastErrorAt, lastErrorCode, lastErrorMessage, lastErrorOrigin } = {}) {
      const payload = {};
      const set = (col, value) => { if (value !== undefined) payload[col] = value == null ? '' : String(value); };
      set('qontoLastCheckAt', lastCheckAt);
      set('qontoLastSuccessAt', lastSuccessAt);
      set('qontoLastErrorAt', lastErrorAt);
      set('qontoLastErrorCode', lastErrorCode);
      set('qontoLastErrorMessage', lastErrorMessage);
      set('qontoLastErrorOrigin', lastErrorOrigin);
      upsert(payload);
    },

    qontoHealth() {
      const row = read();
      const errorAt = str(row, 'qontoLastErrorAt');
      const successAt = str(row, 'qontoLastSuccessAt');
      const stale = Boolean(errorAt && successAt && Date.parse(successAt) >= Date.parse(errorAt));
      return {
        lastCheckAt: str(row, 'qontoLastCheckAt') || null,
        lastSuccessAt: successAt || null,
        lastError: errorAt && !stale
          ? { at: errorAt, code: str(row, 'qontoLastErrorCode'), message: str(row, 'qontoLastErrorMessage'), origin: str(row, 'qontoLastErrorOrigin') }
          : null,
      };
    },

    storeQontoConnection({ connectionId, status }) {
      const payload = {};
      if (connectionId !== undefined) payload.qontoConnectionId = connectionId == null ? '' : String(connectionId);
      if (status !== undefined) payload.qontoConnectionStatus = status == null ? '' : String(status);
      upsert(payload);
    },

    qontoConnectionInfo() {
      const row = read();
      return {
        connected: Boolean(row.qontoRefreshTokenEncrypted),
        connectionId: str(row, 'qontoConnectionId'),
        connectionStatus: str(row, 'qontoConnectionStatus') || 'not_connected',
        connectedAt: str(row, 'qontoConnectedAt') || null,
      };
    },

    qontoConnected: () => Boolean(read().qontoRefreshTokenEncrypted),
  };
  return model;
}

module.exports = { buildQontoSettingsModel };
