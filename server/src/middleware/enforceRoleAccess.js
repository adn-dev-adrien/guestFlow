/**
 * Role-based access guard for `/api/*` — runs after `requireAuth`.
 *
 * Multi-role aware (specs/admin-account-management.md): a user holds an array `roles` (loaded from
 * the `user_roles` join table by `requireAuth`). `admin` short-circuits the check.
 *
 * - **Admin** → unrestricted (default).
 * - **Accountant** → may read the cancellation compensations (core) and call the self routes
 *   (`/auth/me`, `/auth/logout`, `/auth/change-password`, `/users/me`); the journal, the CSV and the
 *   account plan are the `accounting-export` plugin's entries, granted only while it is live
 *   (specs/plugins-phase-2-hosts.md rule 3). Anything else → **403 FORBIDDEN_ROLE**.
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

// specs/cancellation-compensation.md §6.3 — the accountant reads the compensations, on the core page
// « Indemnités d'annulation » (specs/plugins-phase-2-hosts.md rule 21). Every write stays admin-only.
const ACCOUNTANT_MATCHERS = [
  { method: 'GET', re: /^\/accounting\/cancellation-compensations$/ },
];

// specs/reception-role-checkin-only.md §3.6 rule 11 — the exact method+path allowlist for the
// reception role. Anchored regexes so `:id` params match but sibling paths (`/history`, `/search`,
// reservation create/update/delete, resource-booking CRUD) do NOT. A drift test pins this set.
const RECEPTION_MATCHERS = [
  // Reservations — finance-stripped reads (the controller applies the reception view).
  { method: 'GET', re: /^\/reservations$/ },
  { method: 'GET', re: /^\/reservations\/\d+$/ },
  { method: 'GET', re: /^\/reservations\/\d+\/sas$/ },
  // SAS commits (caution + complement to collect at the door). Reachable, but the controller
  // additionally refuses a commit on an ALREADY-COMMITTED SAS for a reception-only requester
  // (403 SAS_ALREADY_COMMITTED, specs/reception-sas-lock-after-commit.md §3.1) — a state-based rule
  // that a path allowlist cannot express.
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

// Plugin modules add their own reception entries (specs/plugins-phase-1-sdk.md rule 5). Their
// routes stay behind requirePlugin, so an entry of an inactive plugin still ends in a 404.
function isReceptionAllowed(method, path) {
  const pluginMatchers = require('../plugins/loader').roleMatchers('reception');
  return [...RECEPTION_MATCHERS, ...pluginMatchers].some((m) => m.method === method && m.re.test(path));
}

// specs/plugins-phase-2-hosts.md rule 3 — the core entries, plus those of the accounting export. Its
// routes stay behind requirePlugin, so an entry of an inactive plugin still ends in a 404.
function isAccountantAllowed(method, path) {
  const pluginMatchers = require('../plugins/loader').roleMatchers('accountant');
  return [...ACCOUNTANT_MATCHERS, ...pluginMatchers].some((m) => m.method === method && m.re.test(path));
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
    if (isAccountantAllowed(req.method, req.path)) return next();
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
  isSelfPath, isAccountantAllowed, isReceptionAllowed,
  SELF_ENDPOINTS, ACCOUNTANT_MATCHERS, RECEPTION_MATCHERS,
};
