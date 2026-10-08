/**
 * The account-security controllers bound to the production database and environment
 * (specs/hosting-h2-account-security.md §4.1). One instance each, shared by the auth routes, the
 * users routes, the support routes and the support guard, so the in-memory rate limits are counted
 * once.
 */

const usersModel = require('../models/usersModel');
const settingsModel = require('../models/settingsModel');
const twoFactorModel = require('../models/twoFactorModel').default;
const passwordResetModel = require('../models/passwordResetModel').default;
const supportAccessModel = require('../models/supportAccessModel').default;
const { createTwoFactorController } = require('../controllers/twoFactorController');
const { createPasswordResetController } = require('../controllers/passwordResetController');
const { createSupportAccessController } = require('../controllers/supportAccessController');
const { createAccountMailer } = require('./accountMailer');
const { getOrCreateSecret } = require('./localEnv');
const { shouldEnforceHttps } = require('./securityConfig');
const supportAccessTokens = require('./supportAccess');

const mailer = createAccountMailer({ settingsModel });

const twoFactor = createTwoFactorController({
  model: twoFactorModel,
  users: usersModel,
  mailer,
  trustSecret: getOrCreateSecret('GUESTFLOW_DEVICE_TRUST_SECRET', 32),
});

const passwordReset = createPasswordResetController({
  users: usersModel,
  model: passwordResetModel,
  mailer,
  twoFactorModel,
});

const supportAccess = createSupportAccessController({
  model: supportAccessModel,
  users: usersModel,
  publicKey: process.env.GUESTFLOW_LICENCE_PUBLIC_KEY || null,
  slug: process.env.GUESTFLOW_SLUG || null,
  readRequest: () => supportAccessTokens.readRequest({
    dataDir: require('./deploymentPaths').resolvePaths().dataDir,
    publicKey: process.env.GUESTFLOW_LICENCE_PUBLIC_KEY,
    slug: process.env.GUESTFLOW_SLUG || null,
  }),
});

module.exports = {
  mailer,
  twoFactor,
  twoFactorModel,
  passwordReset,
  supportAccess,
  trustCookieOptions: { secure: shouldEnforceHttps(process.env) },
};
