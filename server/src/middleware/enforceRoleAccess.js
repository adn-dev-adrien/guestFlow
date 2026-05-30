/**
 * Role-based access guard for `/api/*` — runs after `requireAuth`.
 *
 * - **Admin** → unrestricted (default).
 * - **Accountant** → may only **GET** the accounting endpoints (`/api/accounting/*`) and call the
 *   self routes (`/api/auth/me`, `/api/auth/logout`, `/api/auth/change-password`). Anything else →
 *   **403 FORBIDDEN_ROLE**. The accountant role is read-only by construction.
 *
 * Fail-closed: an unknown role is rejected like an accountant trying to reach a non-accounting route.
 */

const { ROLES } = require('../constants/accounting');

// Endpoints any authenticated user may hit regardless of role (self-management + read-only health).
const SELF_ENDPOINTS = new Set([
  '/auth/me',
  '/auth/logout',
  '/auth/change-password',
  '/version',
]);

function isAccountingPath(path) {
  return /^\/accounting(\/|$)/.test(path);
}

function isSelfPath(path) {
  return SELF_ENDPOINTS.has(path);
}

function enforceRoleAccess(req, res, next) {
  const role = req.user && req.user.role;
  if (role === ROLES.ADMIN) return next();
  if (role === ROLES.ACCOUNTANT) {
    if (isSelfPath(req.path)) return next();
    if (req.method === 'GET' && isAccountingPath(req.path)) return next();
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  // Unknown role → fail-closed.
  return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
}

module.exports = enforceRoleAccess;
module.exports.__test = { isAccountingPath, isSelfPath, SELF_ENDPOINTS };
