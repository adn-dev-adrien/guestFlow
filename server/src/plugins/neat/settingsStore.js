/**
 * The Neat settings of the instance, in plugin_settings (specs/plugins-phase-3b-neat.md rule 10).
 *
 * The controller, the pricing and the subscription pass read `neatConfig()` and write `upsert(payload)`
 * with the names `settingsModel` used over `app_settings`; this store implements both over the plugin's
 * own settings. The keys are the old column names, so the copy migration moves each value as stored,
 * the secret's AES-256-GCM blob included.
 */

const KEYS = Object.freeze([
  'neatEnvironment',
  'neatClientId',
  'neatClientSecretEncrypted',
  'neatSalesChannelId',
  'neatSalesChannelLabel',
  'neatContractId',
  'neatContractLabel',
  'neatPaymentMethodId',
  'neatPaymentMethodKind',
  'neatPaymentMethodLabel',
  'neatFieldMappingJson',
  'neatContractFieldsJson',
  'neatMarginPercent',
]);

const SECRET_KEYS = new Set(['neatClientSecretEncrypted']);

// The generic /api/plugins/neat/settings refuses every write: the Neat card writes them, through its
// discovery, selection and mapping validation.
const DECLARED = KEYS.map((key) => ({
  key,
  secret: SECRET_KEYS.has(key),
  validate: () => 'Réglé depuis Paramètres › Intégrations › Neat.',
}));

/** @param {object} deps.settings ctx.settings (get, set) */
function createSettingsStore({ settings }) {
  const str = (key) => String(settings.get(key) || '');

  return {
    // Secret decrypted, internal use only (never over HTTP). `marginPercent` null when unset: Neat
    // pricing inactive (feature spec rule 13). An undecryptable secret reads as unconfigured.
    neatConfig() {
      const rawMargin = str('neatMarginPercent');
      const margin = rawMargin === '' ? null : Number(rawMargin);
      return {
        environment: str('neatEnvironment') === 'production' ? 'production' : 'staging',
        clientId: str('neatClientId').trim(),
        clientSecret: str('neatClientSecretEncrypted'),
        salesChannelId: str('neatSalesChannelId'),
        salesChannelLabel: str('neatSalesChannelLabel'),
        contractId: str('neatContractId'),
        contractLabel: str('neatContractLabel'),
        paymentMethodId: str('neatPaymentMethodId'),
        paymentMethodKind: str('neatPaymentMethodKind'),
        paymentMethodLabel: str('neatPaymentMethodLabel'),
        fieldMappingJson: str('neatFieldMappingJson'),
        contractFieldsJson: str('neatContractFieldsJson'),
        marginPercent: Number.isFinite(margin) ? margin : null,
      };
    },

    // `{ neatXxx: value }` — '' or null clears a key; the secret is encrypted by the settings layer.
    upsert(payload) {
      Object.entries(payload || {}).forEach(([key, value]) => {
        if (!KEYS.includes(key)) throw new Error(`unknown Neat setting ${key}`);
        settings.set(key, value === null || value === undefined ? '' : String(value));
      });
    },

    isConfigured() {
      const cfg = this.neatConfig();
      return Boolean(cfg.clientId || cfg.clientSecret || cfg.contractId);
    },
  };
}

module.exports = { KEYS, DECLARED, createSettingsStore };
