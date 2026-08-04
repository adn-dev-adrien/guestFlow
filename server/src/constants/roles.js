// Single source of truth for the role taxonomy. Mirrored client-side in client/src/constants/roles.js
// (kept in sync by the cross-side snapshot test); the middleware + controllers consume this module
// directly.

const ADMIN = 'admin';
const ACCOUNTANT = 'accountant';
// specs/reception-role-checkin-only.md — on-site check-in/out staff; sees only the day's
// arrivals/departures + the Planning + the SAS, never any financial figure beyond the caution /
// complement to collect at the door.
const RECEPTION = 'reception';

const ROLES = Object.freeze([ADMIN, ACCOUNTANT, RECEPTION]);

function isKnownRole(role) {
  return ROLES.includes(role);
}

function userHasRole(user, role) {
  if (!user) return false;
  if (Array.isArray(user.roles)) return user.roles.includes(role);
  // Backwards-compat shim while M2 hasn't migrated the session shape from `role` (string) to
  // `roles` (array): treat the legacy single-role property as a 1-item array. Removed once
  // requireAuth + authController write `roles` exclusively.
  if (typeof user.role === 'string' && user.role) return user.role === role;
  return false;
}

// specs/reception-role-checkin-only.md §3.2 — every reception restriction (finance stripping, the
// payment-field allowlist, the SAS re-edit lock) keys on the SAME predicate: holds `reception` and
// NOT `admin`. A combined reception+admin account is a full admin.
function isReceptionOnly(user) {
  return userHasRole(user, RECEPTION) && !userHasRole(user, ADMIN);
}

module.exports = {
  ADMIN,
  ACCOUNTANT,
  RECEPTION,
  ROLES,
  isKnownRole,
  userHasRole,
  isReceptionOnly,
};
