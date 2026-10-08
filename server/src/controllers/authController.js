/**
 * Auth controller — login / logout / me / change-password.
 *
 * Factory `createAuthController(usersModel)` so tests can inject a fake model; a default instance is
 * bound to the production usersModel. Sessions store only the safe user object (no hash).
 *
 * The second step, the forgotten password and the support sign-in link
 * (specs/hosting-h2-account-security.md) are HTTP glue here over their own controllers
 * (twoFactorController, passwordResetController, supportAccessController), injected so the tests of
 * the plain login keep a fake users model.
 *
 * `login` and `me` also carry `enabledPlugins`, the ids of the active plugins: the client hides every
 * entry point of the others (specs/plugins-phase-0-foundation.md rule 14). It is not stored in the
 * session, so a plugin switched on or off shows at the next `/me`.
 */

const defaultUsersModel = require('../models/usersModel');
const { MIN_PASSWORD_LENGTH } = require('../constants/authDefaults');
const { ADMIN, userHasRole } = require('../constants/roles');
const { sendError } = require('../utils/httpError');
const deviceTrust = require('../utils/deviceTrust');

// A password that was right waits this long for its second step.
const PENDING_MS = 10 * 60 * 1000;

function createAuthController(users, {
  activePlugins = () => [],
  onboardingOpen = () => false,
  twoFactor = null,
  passwordReset = null,
  supportAccess = null,
  cookieOptions = {},
  now = () => new Date(),
} = {}) {
  // `onboardingOpen` sends an admin to the start assistant (specs/plugins-phase-p-productisation.md
  // rule 20); the other roles never see it.
  const withPlugins = (user, session = {}) => ({
    ...user,
    enabledPlugins: activePlugins(),
    onboardingOpen: userHasRole(user, ADMIN) && !user.isSupport && onboardingOpen(),
    // specs/hosting-h2-account-security.md rule 17: the support page exists on a managed instance only.
    supportAccessEnabled: Boolean(supportAccess && supportAccess.enabled()) && userHasRole(user, ADMIN),
    // Rule 16: the red bar of a support session.
    supportSession: user.isSupport && session.supportExpiresAt ? { expiresAt: session.supportExpiresAt } : null,
  });

  // A fresh session id for a new identity (no fixation), when the store offers it.
  function freshSession(req, fn) {
    if (req.session && typeof req.session.regenerate === 'function') {
      return req.session.regenerate((err) => (err ? fn(err) : fn()));
    }
    return fn();
  }

  function finishLogin(req, res, user, extra = {}) {
    // Track the last login so the admin can see who's been actively using their account and so the
    // hard-delete guard knows whether a user has ever connected (specs/admin-account-management.md).
    if (typeof users.touchLastLogin === 'function') users.touchLastLogin(user.id);
    req.session.user = user;
    delete req.session.pendingTwoFactor;
    return res.json({ ...withPlugins(user, req.session), ...extra });
  }

  const trustTokenOf = (req, userId) => deviceTrust.readCookie(req.headers && req.headers.cookie, deviceTrust.cookieName(userId));

  // Rule 7: the password was right; the second step is asked unless the device is trusted.
  async function secondStepOrLogin(req, res, user) {
    if (!twoFactor || !twoFactor.isRequired(user, trustTokenOf(req, user.id))) return finishLogin(req, res, user);
    const step = await twoFactor.beginLogin(user);
    delete req.session.user;
    req.session.pendingTwoFactor = { userId: user.id, at: now().getTime() };
    return res.json(step);
  }

  function login(req, res, next) {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'MISSING_CREDENTIALS' });
    const user = users.verifyCredentials(email, password);
    if (!user) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
    if (!twoFactor || !twoFactor.isRequired(user, trustTokenOf(req, user.id))) return finishLogin(req, res, user);
    return secondStepOrLogin(req, res, user).catch((err) => sendError(res, err, next));
  }

  function pendingUserId(req) {
    const pending = req.session && req.session.pendingTwoFactor;
    if (!pending || now().getTime() - pending.at > PENDING_MS) return null;
    return pending.userId;
  }

  // POST /api/auth/2fa/verify { code, trustDevice }
  function verifySecondFactor(req, res, next) {
    try {
      const userId = pendingUserId(req);
      if (!userId) return res.status(401).json({ error: 'NO_PENDING_LOGIN', message: 'Reconnexion nécessaire.' });
      const { user, notice } = twoFactor.verifyLogin(userId, req.body || {});
      if (req.body && req.body.trustDevice) {
        const trust = twoFactor.issueTrust(user.id);
        res.cookie(trust.name, trust.value, { ...cookieOptions, httpOnly: true, sameSite: 'lax', path: '/api/auth', maxAge: trust.maxAge });
      }
      return freshSession(req, (err) => (err ? next(err) : finishLogin(req, res, user, { notice })));
    } catch (err) {
      return sendError(res, err, next);
    }
  }

  async function resendSecondFactor(req, res, next) {
    try {
      const userId = pendingUserId(req);
      if (!userId) return res.status(401).json({ error: 'NO_PENDING_LOGIN', message: 'Reconnexion nécessaire.' });
      return res.json(await twoFactor.resendLogin(userId));
    } catch (err) {
      return sendError(res, err, next);
    }
  }

  // GET /api/auth/options — what the login page offers (rule 5).
  function options(req, res) {
    return res.json(passwordReset ? passwordReset.options() : { forgotPassword: false });
  }

  // POST /api/auth/forgot { email } — always the same answer (rules 1, 3).
  function forgotPassword(req, res) {
    const { message } = passwordReset.request({ email: (req.body || {}).email, ip: req.ip });
    return res.json({ message });
  }

  function checkResetToken(req, res) {
    return res.json(passwordReset.check(String((req.query || {}).token || '')));
  }

  // POST /api/auth/reset { token, password } — rule 4, then the login (and its second step).
  function resetPassword(req, res, next) {
    try {
      const { token, password } = req.body || {};
      const { user } = passwordReset.reset({ token, password });
      return freshSession(req, (err) => {
        if (err) return next(err);
        return secondStepOrLogin(req, res, user).catch((e) => sendError(res, e, next));
      });
    } catch (err) {
      return sendError(res, err, next);
    }
  }

  // GET /api/auth/support?token=… — the console's sign-in link (rule 14). A browser follows it, so
  // it answers with a redirection, never JSON.
  function supportLogin(req, res, next) {
    let opened;
    try {
      opened = supportAccess.consumeLink((req.query || {}).token);
    } catch (err) {
      if (err && err.body) return res.redirect(303, '/login?reason=support-link');
      return next(err);
    }
    return freshSession(req, (err) => {
      if (err) return next(err);
      req.session.user = opened.user;
      req.session.supportAccessId = opened.accessId;
      req.session.supportExpiresAt = opened.expiresAt;
      return res.redirect(303, '/');
    });
  }

  // « Mon compte » — the user's own second step (rule 6), and the dashboard's « Plus tard » (rule 10).
  const self = (fn) => async (req, res, next) => {
    const user = req.session && req.session.user;
    if (!user) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    try {
      const fresh = users.findById(user.id) || user;
      return res.json(await fn(fresh, req.body || {}));
    } catch (err) {
      return sendError(res, err, next);
    }
  };

  function logout(req, res) {
    if (req.session && typeof req.session.destroy === 'function') {
      return req.session.destroy(() => res.status(204).end());
    }
    return res.status(204).end();
  }

  function me(req, res) {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ error: 'UNAUTHENTICATED' });
    }
    // Re-read the user from the DB on every /me call so the response reflects every
    // side-channel update (an admin editing this user, the `companyName` / `notes` fields
    // being filled later, etc.) instead of returning the stale snapshot persisted in the
    // SQLite session store at login time. Without this re-read, the "Mes informations"
    // form on /account stayed pre-filled with whatever the session held at login — which
    // could be empty for users whose row was edited or whose session predates the
    // companyName / notes shape extension.
    //
    // The re-read also refreshes `req.session.user` so downstream middleware reads
    // (req.user via requireAuth) see the new values without needing a logout / login cycle.
    const fresh = users.findById(req.session.user.id);
    if (!fresh) {
      // Underlying user was deleted while the session was live — kill the session too.
      if (typeof req.session.destroy === 'function') {
        return req.session.destroy(() => res.status(401).json({ error: 'UNAUTHENTICATED' }));
      }
      return res.status(401).json({ error: 'UNAUTHENTICATED' });
    }
    req.session.user = fresh;
    return res.json(withPlugins(fresh, req.session));
  }

  function changePassword(req, res) {
    const sessionUser = req.session && req.session.user;
    if (!sessionUser) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'MISSING_FIELDS' });
    if (String(newPassword).length < MIN_PASSWORD_LENGTH) return res.status(400).json({ error: 'PASSWORD_TOO_SHORT' });
    if (newPassword === currentPassword) return res.status(400).json({ error: 'PASSWORD_UNCHANGED' });

    const verified = users.verifyCredentials(sessionUser.email, currentPassword);
    if (!verified) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });

    // Capture the "this was a forced first-login change" state BEFORE running the update — the safe
    // user we just put in the session carries the boolean we need.
    const wasMustChange = Boolean(sessionUser.mustChangePassword);

    users.updatePassword(sessionUser.id, newPassword);

    if (wasMustChange) {
      // First-login change: invalidate the session so the user has to log in again with the password
      // they just set (specs/admin-account-management.md §3.3 rule 15). The client redirects to
      // /login?reason=password-changed.
      if (req.session && typeof req.session.destroy === 'function') {
        return req.session.destroy(() => res.status(204).end());
      }
      return res.status(204).end();
    }

    // Voluntary change from /settings/password: keep the session active (current UX).
    req.session.user = { ...sessionUser, mustChangePassword: false };
    return res.status(204).end();
  }

  return {
    login,
    logout,
    me,
    changePassword,
    verifySecondFactor,
    resendSecondFactor,
    options,
    forgotPassword,
    checkResetToken,
    resetPassword,
    supportLogin,
    twoFactorStatus: self((user) => twoFactor.status(user)),
    twoFactorStart: self((user, body) => twoFactor.start(user, body)),
    twoFactorConfirm: self((user, body) => twoFactor.confirm(user, body)),
    twoFactorDisable: self((user, body) => twoFactor.disable(user, body)),
    twoFactorRegenerate: self((user, body) => twoFactor.regenerate(user, body)),
    twoFactorSnooze: self((user) => twoFactor.snooze(user)),
  };
}

const services = require('../utils/accountSecurityServices');

const defaultController = createAuthController(defaultUsersModel, {
  twoFactor: services.twoFactor,
  passwordReset: services.passwordReset,
  supportAccess: services.supportAccess,
  cookieOptions: services.trustCookieOptions,
  // The registry's answer: a plugin outside the licence (specs/control-plane-plans-and-access.md
  // rule 12) or one that failed to start (specs/plugins-phase-1-sdk.md rule 4) reads as off everywhere.
  activePlugins: () => {
    const registry = require('../plugins/sdk/registry');
    return require('../models/pluginsModel').listActiveIds().filter((id) => registry.isLive(id));
  },
  onboardingOpen: () => require('../models/onboardingModel').buildModel(require('../database')).isOpen(),
});
defaultController.create = createAuthController;

module.exports = defaultController;
