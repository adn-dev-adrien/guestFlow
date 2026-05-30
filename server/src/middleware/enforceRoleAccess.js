/**
 * Role-based access guard for `/api/*` — runs after `requireAuth`.
 *
 * Multi-role aware (specs/admin-account-management.md): a user holds an array `roles` (loaded from
 * the `user_roles` join table by `requireAuth`). `admin` short-circuits the check.
 *
 * - **Admin** → unrestricted (default).
 * - **Accountant** → may only **GET** the accounting endpoints (`/api/accounting/*`) and call the
 *   self routes (`/auth/me`, `/auth/logout`, `/auth/change-password`, `/users/me`). Anything else →
 *   **403 FORBIDDEN_ROLE**. The accountant role is read-only by construction.
 * - Combined admin + accountant → admin wins.
 *
 * Fail-closed: a user with no known role is rejected.
 */

const { ADMIN, ACCOUNTANT, userHasRole } = require('../constants/roles');

// Endpoints any authenticated user may hit regardless of role (self-management + read-only health).
const SELF_ENDPOINTS = new Set([
  '/auth/me',
  '/auth/logout',
  '/auth/change-password',
  '/users/me',
  '/version',
]);

function isAccountingPath(path) {
  return /^\/accounting(\/|$)/.test(path);
}

function isSelfPath(path) {
  return SELF_ENDPOINTS.has(path);
}

function enforceRoleAccess(req, res, next) {
  if (userHasRole(req.user, ADMIN)) return next();
  if (userHasRole(req.user, ACCOUNTANT)) {
    if (isSelfPath(req.path)) return next();
    if (req.method === 'GET' && isAccountingPath(req.path)) return next();
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  // No known role → fail-closed.
  return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
}

module.exports = enforceRoleAccess;
module.exports.__test = { isAccountingPath, isSelfPath, SELF_ENDPOINTS };
