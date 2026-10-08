/**
 * The GuestFlow modules the console shares with the instance, required from the same repository
 * (specs/control-plane-plans-and-access.md §4, Q6). Only pure Node modules are shared: the licence
 * format (so the console signs exactly what the instance verifies), the password hash and the
 * plugin catalogue, the TOTP and backup-code helpers (specs/hosting-h2-account-security.md rule 11),
 * the support-access tokens (rule 14) — and, since C2b, the whole Qonto module with its settings handlers (rule 32),
 * whose modules load the instance's own settings only when none are passed.
 */

const path = require('path');

const GF_SERVER = path.resolve(__dirname, '..', '..', '..', '..', 'server');
// The Qonto module lives in the instance's online-payment plugin since specs/plugins-phase-3a-online-payment.md
// rule 10; the console always passes its own settings store, so it never registers that plugin.
const GF_ONLINE_PAYMENT = path.join(GF_SERVER, 'src', 'plugins', 'online-payment');

module.exports = {
  GF_SERVER,
  licence: require(path.join(GF_SERVER, 'src', 'utils', 'licence')),
  passwordHash: require(path.join(GF_SERVER, 'src', 'utils', 'passwordHash')),
  totp: require(path.join(GF_SERVER, 'src', 'utils', 'totp')),
  supportAccess: require(path.join(GF_SERVER, 'src', 'utils', 'supportAccess')),
  plugins: require(path.join(GF_SERVER, 'src', 'constants', 'plugins')),
  qontoClient: require(path.join(GF_ONLINE_PAYMENT, 'qonto', 'qontoClient')),
  qontoConfig: require(path.join(GF_ONLINE_PAYMENT, 'qonto', 'qontoConfig')),
  qontoService: require(path.join(GF_ONLINE_PAYMENT, 'qonto', 'qontoService')),
  qontoWebhookSignature: require(path.join(GF_ONLINE_PAYMENT, 'qonto', 'qontoWebhookSignature')),
  qontoSettingsController: require(path.join(GF_ONLINE_PAYMENT, 'qontoSettingsController')),
};
