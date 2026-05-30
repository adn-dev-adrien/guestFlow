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

// Per-route role allowlist used by the sidebar to filter items without forking the render path.
// Single source of truth so every "is X visible to Y?" decision answers consistently. New routes
// MUST be registered here (defaults to "hidden for everyone").
//
// Server-side `enforceRoleAccess` middleware enforces the same rules at the API boundary; this map
// only controls UI visibility. A user that hits a hidden route directly via URL still gets the
// server's 403 (and the client-side AccountantConfinement guard sends them home).
export const ROUTE_ROLES = Object.freeze({
  '/':                       [ADMIN],
  '/planning':               [ADMIN],
  '/calendar':               [ADMIN],
  '/resource-planning':      [ADMIN],
  '/reservations/upcoming':  [ADMIN],
  '/finance':                [ADMIN],
  '/finance/tourist-tax':    [ADMIN],
  '/comptabilite':           [ADMIN, ACCOUNTANT],
  '/devis':                  [ADMIN],
  '/settings':               [ADMIN],
  '/properties':             [ADMIN],
  '/options':                [ADMIN],
  '/resources':              [ADMIN],
  '/clients':                [ADMIN],
  '/school-holidays':        [ADMIN],
  '/establishment-closures': [ADMIN],
  '/account':                [ADMIN, ACCOUNTANT],
});

export function canSeeRoute(user, path) {
  const allowed = ROUTE_ROLES[path];
  if (!allowed) return false;
  return allowed.some((role) => userHasRole(user, role));
}

// `paths` is the set of children a parent submenu wraps. The parent is visible iff at least one
// child is visible (so an accountant viewing "Paramètres" because they can reach /account doesn't
// see the parent vanish when admin-only children are filtered out).
export function canSeeAnyRoute(user, paths) {
  return paths.some((path) => canSeeRoute(user, path));
}
