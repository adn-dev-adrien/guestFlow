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
const { createInstances } = require('./utils/instances');
const { createLicenceIssuer } = require('./utils/licenceIssuer');
const { createCustomersController } = require('./controllers/customersController');
const { createCatalogueController } = require('./controllers/catalogueController');
const { createAlertsController } = require('./controllers/alertsController');
const { createAuthController } = require('./controllers/authController');

function createContext({ db, now, mailer, secrets, privateKey, instancesRoot, dataDir, domain, consoleUrl, runFirstAdmin }) {
  const models = {
    catalogue: buildCatalogueModel(db),
    customers: buildCustomersModel(db),
    invoices: buildInvoicesModel(db),
    audit: buildAuditModel(db),
    provisioning: buildProvisioningModel(db),
    operators: buildOperatorsModel(db),
    meta: buildMetaModel(db),
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
    consoleUrl: consoleUrl || `https://console.${domain}`,
    exportsDir: path.join(dataDir, 'exports'),
  };
  const customers = createCustomersController(ctx);
  ctx.controllers = {
    customers,
    catalogue: createCatalogueController(ctx, customers),
    alerts: createAlertsController(ctx, customers),
    auth: createAuthController(ctx),
  };
  return ctx;
}

module.exports = { createContext };
