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
 * - **Reception** (specs/reception-role-checkin-only.md) → may only reach the operational surface
 *   needed to run the on-site check-in / check-out: the finance-stripped reservation reads, the SAS
 *   read + commits, the check-in/out status toggle, the property list, and the Planning housekeeping
 *   reads + their done/skip writes. Anything else → **403 FORBIDDEN_ROLE**. Never any finance
 *   endpoint (the reservation payloads themselves are stripped in the controller).
 * - Combined roles → the union of each held role's allowlist (admin wins outright).
 *
 * Fail-closed: a user with no known role is rejected.
 */

const { ADMIN, ACCOUNTANT, RECEPTION, userHasRole } = require('../constants/roles');

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

// specs/reception-role-checkin-only.md §3.6 rule 11 — the exact method+path allowlist for the
// reception role. Anchored regexes so `:id` params match but sibling paths (`/history`, `/search`,
// reservation create/update/delete, resource-booking CRUD) do NOT. A drift test pins this set.
const RECEPTION_MATCHERS = [
  // Reservations — finance-stripped reads (the controller applies the reception view).
  { method: 'GET', re: /^\/reservations$/ },
  { method: 'GET', re: /^\/reservations\/\d+$/ },
  { method: 'GET', re: /^\/reservations\/\d+\/sas$/ },
  { method: 'GET', re: /^\/reservations\/\d+\/weather-alerts$/ },
  // SAS commits (caution + complement to collect at the door).
  { method: 'POST', re: /^\/reservations\/\d+\/sas\/arrival$/ },
  { method: 'POST', re: /^\/reservations\/\d+\/sas\/departure$/ },
  // Check-in / check-out status toggles only — the controller ignores any financial field in the
  // same payload for a reception-only requester (rule 10).
  { method: 'PATCH', re: /^\/reservations\/\d+\/payment$/ },
  // Property list — pricing-stripped (the controller applies the reception view).
  { method: 'GET', re: /^\/properties$/ },
  // Platform badge colours (non-sensitive display config used by the Planning cards + AppShell).
  { method: 'GET', re: /^\/properties\/platform-colors$/ },
  // Planning housekeeping reads + the two "done" toggles.
  { method: 'GET', re: /^\/planning\// },
  { method: 'POST', re: /^\/planning\/option-cards\/done$/ },
  { method: 'POST', re: /^\/planning\/resource-cards\/done$/ },
  // Laundry skips + manual additions (operational, no money).
  { method: 'GET', re: /^\/laundry(\/|$)/ },
  { method: 'POST', re: /^\/laundry\/skips$/ },
  { method: 'DELETE', re: /^\/laundry\/skips\// },
  { method: 'PUT', re: /^\/laundry\/manual-additions\// },
  // Resource-booking planning events (read-only, for the Planning resource lane).
  { method: 'GET', re: /^\/resource-bookings\/planning-events$/ },
];

function isReceptionAllowed(method, path) {
  return RECEPTION_MATCHERS.some((m) => m.method === method && m.re.test(path));
}

function isSelfPath(path) {
  return SELF_ENDPOINTS.has(path);
}

function enforceRoleAccess(req, res, next) {
  if (userHasRole(req.user, ADMIN)) return next();

  // Each held role's allowlist is evaluated; a combined account gets the union. Every branch only
  // grants (calls next) — none rejects — so the final fail-closed 403 fires when no branch matched.
  if (userHasRole(req.user, ACCOUNTANT)) {
    if (isSelfPath(req.path)) return next();
    if (req.method === 'GET' && isAccountingPath(req.path)) return next();
    if (isAccountantWritablePath(req.method, req.path)) return next();
  }

  if (userHasRole(req.user, RECEPTION)) {
    if (isSelfPath(req.path)) return next();
    if (isReceptionAllowed(req.method, req.path)) return next();
  }

  // No known role, or a known role hitting a path outside its allowlist → fail-closed.
  return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
}

module.exports = enforceRoleAccess;
module.exports.__test = {
  isAccountingPath, isSelfPath, isAccountantWritablePath, isReceptionAllowed,
  SELF_ENDPOINTS, RECEPTION_MATCHERS,
};
