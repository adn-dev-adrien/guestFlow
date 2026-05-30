// Client-side mirror of server/src/constants/roles.js. The server is the single source of truth
// (a server unit test snapshots ROLES + ROLE_LABELS to catch drift); this file is the read-only
// projection used by the UI (sidebar gating, role multi-select, status chips).

export const ADMIN = 'admin';
export const ACCOUNTANT = 'accountant';

export const ROLES = Object.freeze([ADMIN, ACCOUNTANT]);

export const ROLE_LABELS = Object.freeze({
  [ADMIN]: 'Admin',
  [ACCOUNTANT]: 'Comptable',
});

export function userHasRole(user, role) {
  if (!user) return false;
  if (Array.isArray(user.roles)) return user.roles.includes(role);
  // Back-compat shim for in-flight sessions persisted before M2 deployed the multi-role shape.
  // Mirrors the server-side userHasRole; can be removed once every session has cycled
  // (re-login or session-cookie expiry).
  if (typeof user.role === 'string' && user.role) return user.role === role;
  return false;
}

export function roleLabel(role) {
  return ROLE_LABELS[role] || role;
}
