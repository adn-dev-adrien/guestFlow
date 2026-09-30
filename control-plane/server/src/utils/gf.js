/**
 * The GuestFlow modules the console shares with the instance, required from the same repository
 * (specs/control-plane-plans-and-access.md §4, Q6). Only pure Node modules are shared: the licence
 * format (so the console signs exactly what the instance verifies), the password hash and the
 * plugin catalogue — and, since C2b, the whole Qonto module with its settings handlers (rule 32),
 * whose modules load GuestFlow's own settings only when none are passed.
 */

const path = require('path');

const GF_SERVER = path.resolve(__dirname, '..', '..', '..', '..', 'server');

module.exports = {
  GF_SERVER,
  licence: require(path.join(GF_SERVER, 'src', 'utils', 'licence')),
  passwordHash: require(path.join(GF_SERVER, 'src', 'utils', 'passwordHash')),
  plugins: require(path.join(GF_SERVER, 'src', 'constants', 'plugins')),
  qontoClient: require(path.join(GF_SERVER, 'src', 'utils', 'qontoClient')),
  qontoConfig: require(path.join(GF_SERVER, 'src', 'utils', 'qontoConfig')),
  qontoService: require(path.join(GF_SERVER, 'src', 'utils', 'qontoService')),
  qontoWebhookSignature: require(path.join(GF_SERVER, 'src', 'utils', 'qontoWebhookSignature')),
  qontoSettingsController: require(path.join(GF_SERVER, 'src', 'controllers', 'qontoSettingsController')),
};
