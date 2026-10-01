/**
 * Wires the console together. Everything external — the clock, the mailer, the instances' root,
 * the licence key, the first-admin runner — is injected, so tests build a context on an in-memory
 * database and a temporary directory.
 */

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

// `qonto` replaces the Qonto facade in tests; the console itself builds it over its own settings,
// with no environment fallback: Qonto is configured from the Paiements page only (rule 32).
function createContext({ db, now, mailer, secrets, privateKey, instancesRoot, dataDir, domain, consoleUrl, runFirstAdmin, qonto, directoryKey }) {
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
  };
  const instances = createInstances({ root: instancesRoot });
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
  };
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
    // GuestFlow's own Qonto settings handlers, over the console's settings (rule 32).
    qontoSettings: qontoSettingsController.createQontoSettingsController({
      settings: models.qontoSettings, env: {}, scopes: BILLING_SCOPES, now: () => now().getTime(),
    }),
  };
  return ctx;
}

module.exports = { createContext };
