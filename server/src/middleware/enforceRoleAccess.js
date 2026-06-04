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
  '/users/me/email-status',
  '/version',
]);

function isAccountingPath(path) {
  return /^\/accounting(\/|$)/.test(path);
}

// accounting-platform-commission-and-no-deposit.md §3.7 rule 19. The accountant must be able
// to edit the per-platform commission config from `/comptabilite/plateformes`, so PUT on
// this one path is exempt from the "accountant = GET-only" rule. Other PUTs under
// `/accounting/*` remain admin-only. The POST /refresh endpoint is the operator-triggered
// rescan from the dedicated page — same allow-list as PUT.
function isAccountantWritablePath(method, path) {
  if (method === 'PUT' && path === '/accounting/platform-accounts') return true;
  if (method === 'POST' && path === '/accounting/platform-accounts/refresh') return true;
  return false;
}

function isSelfPath(path) {
  return SELF_ENDPOINTS.has(path);
}

function enforceRoleAccess(req, res, next) {
  if (userHasRole(req.user, ADMIN)) return next();
  if (userHasRole(req.user, ACCOUNTANT)) {
    if (isSelfPath(req.path)) return next();
    if (req.method === 'GET' && isAccountingPath(req.path)) return next();
    if (isAccountantWritablePath(req.method, req.path)) return next();
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  // No known role → fail-closed.
  return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
}

module.exports = enforceRoleAccess;
module.exports.__test = { isAccountingPath, isSelfPath, isAccountantWritablePath, SELF_ENDPOINTS };
