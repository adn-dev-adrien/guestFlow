/**
 * Auth gate for business `/api` routes (applied centrally in index.js; auth routes and the public
 * iCal export are mounted outside it).
 *
 * - No session               → 401 UNAUTHENTICATED
 * - User gone or deactivated  → 401 UNAUTHENTICATED + the session is destroyed
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

function createRequireAuth(users) {
  return function requireAuth(req, res, next) {
    const snapshot = req.session && req.session.user;
    if (!snapshot) {
      return res.status(401).json({ error: 'UNAUTHENTICATED' });
    }

    let fresh = null;
    try {
      fresh = users.findById(snapshot.id);
    } catch {
      fresh = null;
    }

    // Row gone (hard-deleted) or deactivated (soft-deleted) while the session was live → revoke
    // this session and reject. `destroy` clears the store row so the cookie is dead from now on.
    // `isActive` comes from the model as a boolean; we reject only when it is explicitly false so
    // a model that omits the flag is treated as active.
    if (!fresh || fresh.isActive === false) {
      if (req.session && typeof req.session.destroy === 'function') {
        return req.session.destroy(() => res.status(401).json({ error: 'UNAUTHENTICATED' }));
      }
      return res.status(401).json({ error: 'UNAUTHENTICATED' });
    }

    if (fresh.mustChangePassword) {
      return res.status(403).json({ error: 'PASSWORD_CHANGE_REQUIRED' });
    }

    // Refresh the persisted snapshot so a role change (and any identity edit) takes effect on the
    // next request without a logout/login, and downstream reads of req.user are current.
    req.session.user = fresh;
    req.user = fresh;
    return next();
  };
}

const requireAuth = createRequireAuth(defaultUsersModel);
requireAuth.create = createRequireAuth;

module.exports = requireAuth;
