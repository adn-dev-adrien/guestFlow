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
const { createReauthGuard } = require('./reauthGuard');
const { createAccountMailer } = require('./accountMailer');
const { getOrCreateSecret } = require('./localEnv');
const { shouldEnforceHttps } = require('./securityConfig');
const supportAccessTokens = require('./supportAccess');

const mailer = createAccountMailer({ settingsModel });

// Rule 49: ONE limit on the confirmation password, shared by the second step's routes and the password change.
const passwordGuard = createReauthGuard({
  users: usersModel,
  onLock: (userId) => twoFactorModel.addEvent(userId, 'reauth_locked', '', new Date().toISOString()),
});

const twoFactor = createTwoFactorController({
  model: twoFactorModel,
  users: usersModel,
  mailer,
  trustSecret: getOrCreateSecret('GUESTFLOW_DEVICE_TRUST_SECRET', 32),
  companyName: () => settingsModel.read().companyName,
  passwordGuard,
});

const passwordReset = createPasswordResetController({
  users: usersModel,
  model: passwordResetModel,
  mailer,
  twoFactorModel,
});

// specs/hosting-h2-account-security.md rule 22 — the instance's slug: the hosting's GUESTFLOW_SLUG
// when set, else the one the verified licence was issued for.
const instanceSlug = () => process.env.GUESTFLOW_SLUG || require('./licence').default.slug();

const supportAccess = createSupportAccessController({
  model: supportAccessModel,
  users: usersModel,
  publicKey: process.env.GUESTFLOW_LICENCE_PUBLIC_KEY || null,
  slug: instanceSlug,
  readRequest: () => supportAccessTokens.readRequest({
    dataDir: require('./deploymentPaths').resolvePaths().dataDir,
    publicKey: process.env.GUESTFLOW_LICENCE_PUBLIC_KEY,
    slug: instanceSlug(),
  }),
});

module.exports = {
  mailer,
  twoFactor,
  passwordGuard,
  twoFactorModel,
  passwordReset,
  supportAccess,
  trustCookieOptions: { secure: shouldEnforceHttps(process.env) },
};
