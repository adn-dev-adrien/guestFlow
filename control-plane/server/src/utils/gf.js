/**
 * The GuestFlow modules the console shares with the instance, required from the same repository
 * (specs/control-plane-plans-and-access.md §4, Q6). Only pure Node modules are shared: the licence
 * format (so the console signs exactly what the instance verifies), the password hash and the
 * plugin catalogue, the TOTP and backup-code helpers (specs/hosting-h2-account-security.md rule 11),
 * the support-access tokens (rule 14) — and, since C2b, the whole Qonto module with its settings
 * handlers (rule 32), whose modules load the instance's own settings only when none are passed — and,
 * since H1, the release download and verification of the self-update.
 */

const path = require('path');

const GF_SERVER = path.resolve(__dirname, '..', '..', '..', '..', 'server');
// The Qonto library is core code (specs/plugins-phase-3a-online-payment.md rule 22): the console never
// reaches inside a plugin, and always passes its own settings store.
const qonto = require(path.join(GF_SERVER, 'src', 'utils', 'qonto'));

module.exports = {
  GF_SERVER,
  licence: require(path.join(GF_SERVER, 'src', 'utils', 'licence')),
  passwordHash: require(path.join(GF_SERVER, 'src', 'utils', 'passwordHash')),
  totp: require(path.join(GF_SERVER, 'src', 'utils', 'totp')),
  supportAccess: require(path.join(GF_SERVER, 'src', 'utils', 'supportAccess')),
  plugins: require(path.join(GF_SERVER, 'src', 'constants', 'plugins')),
  // specs/plugins-phase-4-registry.md rule 8 — the registry checks a package with the instance's own
  // checks: its members, its layout and its manifest.
  packages: require(path.join(GF_SERVER, 'src', 'plugins', 'packageStore')),
  qontoClient: qonto.qontoClient,
  qontoConfig: qonto.qontoConfig,
  qontoService: qonto.qontoService,
  qontoWebhookSignature: qonto.qontoWebhookSignature,
  qontoSettingsController: qonto.qontoSettingsController,
  // specs/hosting-h1-fleet-runtime.md rule 8 — a release is fetched and checked by the same code the
  // self-update uses: allowed hosts, SHA256SUMS, archive members, release layout, npm ci.
  releaseClient: require(path.join(GF_SERVER, 'src', 'utils', 'releaseClient')),
  updateStaging: require(path.join(GF_SERVER, 'src', 'utils', 'updateStaging')),
  semver: require(path.join(GF_SERVER, 'src', 'utils', 'semver')),
  proxySecret: require(path.join(GF_SERVER, 'src', 'utils', 'proxySecret')),
  // specs/control-plane-plans-and-access.md rule 36 — the instance's same-origin gate for writes.
  sameOriginWrites: require(path.join(GF_SERVER, 'src', 'middleware', 'sameOriginWrites')),
};
