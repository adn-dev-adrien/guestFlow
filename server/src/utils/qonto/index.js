/**
 * The Qonto library — client, configuration, health, OAuth, webhook signature and registrar, the
 * settings handlers. Core code since specs/plugins-phase-3a-online-payment.md rule 22: the
 * online-payment plugin reaches it through `sdk.coreModule('qonto')`, the control plane by `require`,
 * so neither depends on the inside of the other. Every function takes the caller's settings store.
 */

module.exports = Object.freeze({
  qontoClient: require('./qontoClient'),
  qontoConfig: require('./qontoConfig'),
  qontoHealth: require('./qontoHealth'),
  qontoAuth: require('./qontoAuth'),
  qontoService: require('./qontoService'),
  qontoWebhookSignature: require('./qontoWebhookSignature'),
  qontoWebhookRegistrar: require('./qontoWebhookRegistrar'),
  paymentProviderValidation: require('./paymentProviderValidation'),
  qontoSettingsController: require('./qontoSettingsController'),
  httpRetry: require('./httpRetry'),
});
