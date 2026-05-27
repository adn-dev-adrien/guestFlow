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
    if (req.session && req.session.user) return res.json(req.session.user);
    return res.status(401).json({ error: 'UNAUTHENTICATED' });
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

    users.updatePassword(sessionUser.id, newPassword);
    req.session.user = { ...sessionUser, mustChangePassword: false };
    return res.status(204).end();
  }

  return { login, logout, me, changePassword };
}

const defaultController = createAuthController(defaultUsersModel);
defaultController.create = createAuthController;

module.exports = defaultController;
