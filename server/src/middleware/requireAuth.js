/**
 * Auth gate for business `/api` routes (applied centrally in index.js; auth routes and the public
 * iCal export are mounted outside it).
 *
 * - No session               → 401 UNAUTHENTICATED
 * - User gone or deactivated  → 401 UNAUTHENTICATED + the session is destroyed (except an open
 *                               support session: the support account is never active)
 * - User must change pw       → 403 PASSWORD_CHANGE_REQUIRED (the default password only opens the
 *                               change-password screen; see specs/security-auth-encryption.md rule 6)
 * - Otherwise                 → refreshes req.session.user from the DB, attaches req.user, continues.
 *
 * The request is RE-VALIDATED against the database on every call instead of trusting the user
 * snapshot persisted in the session store at login. Without this, deactivating, deleting or
 * demoting a user did not end a session already open on their device: the snapshot kept working
 * for the whole 30-day sliding window on any client that never calls /auth/me (a saved cookie, a
 * script, curl). Re-reading the row (one indexed lookup) and rebuilding req.user from it means the
 * next request after the change is rejected, and downstream role checks (enforceRoleAccess) see the
 * current roles. 2026-10-08 infrastructure audit, finding AUTH-1.
 *
 * `createRequireAuth(usersModel)` factory for tests; the default export is bound to the production
 * usersModel and is itself the middleware, so `require('./middleware/requireAuth')` still returns a
 * ready-to-mount function.
 */

const defaultUsersModel = require('../models/usersModel');

// The support account is never active (it cannot log in with a password): a session opened by the
// console's sign-in link carries its access id, and supportAudit decides whether that access still
// holds (specs/hosting-h2-account-security.md rules 14-16, 21).
function isOpenSupportSession(req, user) {
  return Boolean(user && user.isSupport && req.session && req.session.supportAccessId);
}

/**
 * The session's user re-read from the database, for every gate that serves a signed-in user (this `/api`
 * middleware, a plugin's own web app): `{ user }` — `req.session.user` and `req.user` refreshed — or
 * `{ refused: 'unauthenticated' | 'password', revoke? }`. `revoke` = the user is gone or deactivated: the
 * caller destroys the session.
 */
function createRevalidate(users) {
  return function revalidate(req) {
    const snapshot = req.session && req.session.user;
    if (!snapshot) return { refused: 'unauthenticated' };

    let fresh = null;
    try {
      fresh = users.findById(snapshot.id);
    } catch {
      fresh = null;
    }

    // Row gone (hard-deleted) or deactivated (soft-deleted) while the session was live → revoke
    // this session and reject. `isActive` comes from the model as a boolean; we reject only when
    // it is explicitly false so a model that omits the flag is treated as active.
    if (!fresh || (fresh.isActive === false && !isOpenSupportSession(req, fresh))) return { refused: 'unauthenticated', revoke: true };
    if (fresh.mustChangePassword) return { refused: 'password' };

    // Refresh the persisted snapshot so a role change (and any identity edit) takes effect on the
    // next request without a logout/login, and downstream reads of req.user are current.
    req.session.user = fresh;
    req.user = fresh;
    return { user: fresh };
  };
}

function createRequireAuth(users) {
  const revalidate = createRevalidate(users);
  return function requireAuth(req, res, next) {
    const checked = revalidate(req);
    if (checked.user) return next();
    if (checked.refused === 'password') return res.status(403).json({ error: 'PASSWORD_CHANGE_REQUIRED' });
    // `destroy` clears the store row so the cookie is dead from now on.
    if (checked.revoke && req.session && typeof req.session.destroy === 'function') {
      return req.session.destroy(() => res.status(401).json({ error: 'UNAUTHENTICATED' }));
    }
    return res.status(401).json({ error: 'UNAUTHENTICATED' });
  };
}

const requireAuth = createRequireAuth(defaultUsersModel);
requireAuth.create = createRequireAuth;
requireAuth.createRevalidate = createRevalidate;
requireAuth.revalidate = createRevalidate(defaultUsersModel);
requireAuth.isOpenSupportSession = isOpenSupportSession;

module.exports = requireAuth;
