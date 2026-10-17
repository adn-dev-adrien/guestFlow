/**
 * The GuestFlow modules the console shares with the instance, required from the same repository
 * (specs/control-plane-plans-and-access.md §4, Q6). Only pure Node modules are shared: the licence
 * format (so the console signs exactly what the instance verifies), the password hash and the
 * plugin catalogue — and, since C2b, the whole Qonto module with its settings handlers (rule 32),
 * whose modules load the instance's own settings only when none are passed — and, since H1, the
 * release download and verification of the self-update.
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
  plugins: require(path.join(GF_SERVER, 'src', 'constants', 'plugins')),
  qontoClient: require(path.join(GF_ONLINE_PAYMENT, 'qonto', 'qontoClient')),
  qontoConfig: require(path.join(GF_ONLINE_PAYMENT, 'qonto', 'qontoConfig')),
  qontoService: require(path.join(GF_ONLINE_PAYMENT, 'qonto', 'qontoService')),
  qontoWebhookSignature: require(path.join(GF_ONLINE_PAYMENT, 'qonto', 'qontoWebhookSignature')),
  qontoSettingsController: require(path.join(GF_ONLINE_PAYMENT, 'qontoSettingsController')),
  // specs/hosting-h1-fleet-runtime.md rule 8 — a release is fetched and checked by the same code the
  // self-update uses: allowed hosts, SHA256SUMS, archive members, release layout, npm ci.
  releaseClient: require(path.join(GF_SERVER, 'src', 'utils', 'releaseClient')),
  updateStaging: require(path.join(GF_SERVER, 'src', 'utils', 'updateStaging')),
  semver: require(path.join(GF_SERVER, 'src', 'utils', 'semver')),
};
