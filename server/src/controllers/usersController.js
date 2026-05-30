/**
 * Users controller — admin-only user management (list / create / reset password).
 * Used by the Settings "Accès comptable" section to seed the accountant.
 *
 * Factory `createUsersController(usersModel)` for tests; default instance bound to the production
 * usersModel. The role guard (middleware/enforceRoleAccess) blocks non-admins.
 */

const defaultUsersModel = require('../models/usersModel');
const { ROLES } = require('../constants/accounting');

const ALLOWED_ROLES = new Set(Object.values(ROLES));
const MIN_PASSWORD_LENGTH = 10;

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function createUsersController(users) {
  return {
    list(req, res) {
      return res.json({ users: users.list() });
    },

    create(req, res) {
      const { email, password, role } = req.body || {};
      if (!isValidEmail(email)) return res.status(400).json({ error: 'INVALID_EMAIL' });
      if (!password || String(password).length < MIN_PASSWORD_LENGTH) {
        return res.status(400).json({ error: 'PASSWORD_TOO_SHORT' });
      }
      const normalizedRole = String(role || ROLES.ACCOUNTANT);
      if (!ALLOWED_ROLES.has(normalizedRole)) return res.status(400).json({ error: 'INVALID_ROLE' });
      try {
        const user = users.createUser({ email, password, role: normalizedRole });
        return res.json({ user });
      } catch (err) {
        if (String(err.message || '').includes('UNIQUE')) {
          return res.status(409).json({ error: 'EMAIL_ALREADY_EXISTS' });
        }
        throw err;
      }
    },

    resetPassword(req, res) {
      const id = Number(req.params.id);
      const { password } = req.body || {};
      if (!password || String(password).length < MIN_PASSWORD_LENGTH) {
        return res.status(400).json({ error: 'PASSWORD_TOO_SHORT' });
      }
      const user = users.resetUserPassword(id, password);
      if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND' });
      return res.json({ user });
    },
  };
}

const defaultController = createUsersController(defaultUsersModel);

module.exports = defaultController;
module.exports.create = createUsersController;
module.exports.__test = { isValidEmail, ALLOWED_ROLES, MIN_PASSWORD_LENGTH };
