/**
 * Auth controller — login / logout / me / change-password.
 *
 * Factory `createAuthController(usersModel)` so tests can inject a fake model; a default instance is
 * bound to the production usersModel. Sessions store only the safe user object (no hash).
 */

const defaultUsersModel = require('../models/usersModel');
const { MIN_PASSWORD_LENGTH } = require('../constants/authDefaults');

function createAuthController(users) {
  function login(req, res) {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'MISSING_CREDENTIALS' });
    const user = users.verifyCredentials(email, password);
    if (!user) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
    // Track the last login so the admin can see who's been actively using their account and so the
    // hard-delete guard knows whether a user has ever connected (specs/admin-account-management.md).
    if (typeof users.touchLastLogin === 'function') users.touchLastLogin(user.id);
    req.session.user = user;
    return res.json(user);
  }

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
    return res.json(fresh);
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

  return { login, logout, me, changePassword };
}

const defaultController = createAuthController(defaultUsersModel);
defaultController.create = createAuthController;

module.exports = defaultController;
