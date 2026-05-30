// Single source of truth for the role taxonomy. Mirrored client-side in client/src/constants/roles.js
// (kept in sync by the cross-side snapshot test); the middleware + controllers consume this module
// directly.

const ADMIN = 'admin';
const ACCOUNTANT = 'accountant';

const ROLES = Object.freeze([ADMIN, ACCOUNTANT]);

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

module.exports = {
  ADMIN,
  ACCOUNTANT,
  ROLES,
  isKnownRole,
  userHasRole,
};
