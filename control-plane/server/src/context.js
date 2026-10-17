/**
 * Wires the console together. Everything external — the clock, the mailer, the instances' root,
 * the licence key, the first-admin runner — is injected, so tests build a context on an in-memory
 * database and a temporary directory.
 */

const crypto = require('crypto');
const path = require('path');
const { buildCatalogueModel } = require('./models/catalogueModel');
const { buildCustomersModel } = require('./models/customersModel');
const { buildInvoicesModel } = require('./models/invoicesModel');
const { buildAuditModel } = require('./models/auditModel');
const { buildProvisioningModel } = require('./models/provisioningModel');
const { buildOperatorsModel } = require('./models/operatorsModel');
const { buildMetaModel } = require('./models/metaModel');
const { buildEmailsModel } = require('./models/emailsModel');
const { buildQontoSettingsModel } = require('./models/qontoSettingsModel');
const { buildDirectoryModel } = require('./models/directoryModel');
const { buildHostingModel } = require('./models/hostingModel');
const { createQontoBilling, BILLING_SCOPES } = require('./utils/qontoBilling');
const { qontoSettingsController } = require('./utils/gf');
const { createInstances } = require('./utils/instances');
const { createLicenceIssuer } = require('./utils/licenceIssuer');
const { createCustomersController } = require('./controllers/customersController');
const { createCatalogueController } = require('./controllers/catalogueController');
const { createAlertsController } = require('./controllers/alertsController');
const { createAuthController } = require('./controllers/authController');
const { createBillingController } = require('./controllers/billingController');
const { createTemplatesController } = require('./controllers/templatesController');
const { createLoginController } = require('./controllers/loginController');
const { createFleetController } = require('./controllers/fleetController');
const { createDrivers } = require('./utils/drivers');
const { createReleases } = require('./utils/releases');
const { createProvisioner } = require('./utils/provisioner');
const { createFleetUpdater } = require('./utils/fleetUpdater');
const { createRestoreVerifier } = require('./utils/restoreVerifier');
const { createHostAlerts } = require('./utils/hostAlerts');
const { createProbe } = require('./tasks/probe');
const { createWeeklyRestore } = require('./tasks/weeklyRestore');
const { parisDay } = require('./utils/days');
const { createSupportController } = require('./controllers/supportController');

// `qonto` replaces the Qonto facade in tests; the console itself builds it over its own settings,
// with no environment fallback: Qonto is configured from the Paiements page only (rule 32).
// The hosting (specs/hosting-h1-fleet-runtime.md) adds the host drivers, the shared releases and the
// fetch used by the health checks; the tests pass fakes, index.js builds them from the environment.
function createContext({
  db, now, mailer, secrets, privateKey, instancesRoot, dataDir, domain, consoleUrl, runFirstAdmin, qonto, directoryKey,
  drivers, releasesDir, hostingEnv = {}, fetchImpl = fetch, releasesFetch, installRelease, pluginInstaller = null, isPortFree, diskRatio, consoleDbFile = null,
}) {
  const publicUrl = consoleUrl || `https://console.${domain}`;
  const models = {
    catalogue: buildCatalogueModel(db),
    customers: buildCustomersModel(db),
    invoices: buildInvoicesModel(db),
    audit: buildAuditModel(db),
    provisioning: buildProvisioningModel(db),
    operators: buildOperatorsModel(db),
    meta: buildMetaModel(db),
    emails: buildEmailsModel(db),
    qontoSettings: buildQontoSettingsModel(db, { secrets, publicUrl }),
    directory: buildDirectoryModel(db),
    hosting: buildHostingModel(db),
  };
  const instances = createInstances({ root: instancesRoot });
  const releasesRoot = releasesDir || path.join(path.dirname(path.resolve(instancesRoot)), 'releases');
  const today = () => parisDay(now());
  const ctx = {
    db,
    models,
    now,
    mailer,
    secrets,
    instances,
    issuer: createLicenceIssuer({ privateKey, instances }),
    runFirstAdmin,
    domain,
    consoleUrl: publicUrl,
    exportsDir: path.join(dataDir, 'exports'),
    qonto: qonto || createQontoBilling({ settings: models.qontoSettings, env: {} }),
    directoryKey,
    fetchImpl,
    // The console's own database, copied every night (scheduler) — null on an in-memory database.
    consoleDbFile,
    consoleBackupDir: path.join(dataDir, 'backups'),
  };

  // --- Hosting H1 ---
  ctx.releases = createReleases({ dir: releasesRoot, now, fetchImpl: releasesFetch || fetchImpl, installImpl: installRelease });
  ctx.drivers = drivers || createDrivers({
    env: hostingEnv,
    root: instances.root,
    releasesDir: releasesRoot,
    dataDir,
    domain,
    now,
    // Litestream's configuration lists every instance whose backup step is done.
    listReplicas: () => models.customers.list()
      .filter((c) => { const r = models.provisioning.get(c.id, 'backup'); return r && r.status === 'ok' && !c.archivedAt; })
      .map((c) => ctx.provisioner.instanceOf(c)),
  });
  const healthTimeoutMs = Number(hostingEnv.CP_HEALTH_TIMEOUT_MS) || 60000;
  const journal = (...args) => ctx.controllers.customers.journal(...args);
  ctx.provisioner = createProvisioner({
    models,
    drivers: ctx.drivers,
    releases: ctx.releases,
    instances,
    now,
    today,
    fetchImpl,
    portRange: hostingEnv.CP_PORT_RANGE || '4400-4499',
    ...(isPortFree ? { isPortFree } : {}),
    healthTimeoutMs,
    licencePublicKey: privateKey ? crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64') : null,
    hooks: {
      licence: (id) => ctx.controllers.customers.issueLicence(id),
      admin: (id) => ctx.controllers.customers.adminStep(id),
      journal,
    },
  });
  ctx.hostAlerts = createHostAlerts({ hosting: models.hosting, operators: models.operators, mailer, now, consoleUrl: publicUrl });
  ctx.fleetUpdater = createFleetUpdater({
    models, drivers: ctx.drivers, releases: ctx.releases, provisioner: ctx.provisioner, now, fetchImpl, healthTimeoutMs, journal, pluginInstaller,
  });
  ctx.restoreVerifier = createRestoreVerifier({
    models, drivers: ctx.drivers, provisioner: ctx.provisioner, fleetUpdater: ctx.fleetUpdater, now, fetchImpl, healthTimeoutMs, alerts: ctx.hostAlerts, journal,
  });
  ctx.probe = createProbe({
    models, drivers: ctx.drivers, provisioner: ctx.provisioner, alerts: ctx.hostAlerts, now, fetchImpl, root: instances.root, today, ...(diskRatio ? { diskRatio } : {}),
  });
  ctx.weeklyRestore = createWeeklyRestore({ meta: models.meta, verifier: ctx.restoreVerifier, today });

  const customers = createCustomersController(ctx);
  const billing = createBillingController(ctx, customers);
  ctx.controllers = {
    customers,
    billing,
    catalogue: createCatalogueController(ctx, customers),
    alerts: createAlertsController(ctx, customers, billing),
    auth: createAuthController(ctx),
    templates: createTemplatesController(ctx),
    login: createLoginController(ctx, customers),
    fleet: createFleetController(ctx, customers),
    // specs/hosting-h2-account-security.md rules 12-14 — support access with consent.
    support: createSupportController(ctx, customers),
    // GuestFlow's own Qonto settings handlers, over the console's settings (rule 32).
    qontoSettings: qontoSettingsController.createQontoSettingsController({
      settings: models.qontoSettings, env: {}, scopes: BILLING_SCOPES, now: () => now().getTime(),
    }),
  };
  return ctx;
}

module.exports = { createContext };
