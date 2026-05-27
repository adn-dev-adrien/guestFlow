/**
 * Auth gate for business `/api` routes (applied centrally in index.js; auth routes and the public
 * iCal export are mounted outside it).
 *
 * - No session            → 401 UNAUTHENTICATED
 * - Session must change pw → 403 PASSWORD_CHANGE_REQUIRED (the default password only opens the
 *                            change-password screen; see specs/security-auth-encryption.md rule 6)
 * - Otherwise             → attaches req.user and continues.
 */
function requireAuth(req, res, next) {
  const user = req.session && req.session.user;
  if (!user) {
    return res.status(401).json({ error: 'UNAUTHENTICATED' });
  }
  if (user.mustChangePassword) {
    return res.status(403).json({ error: 'PASSWORD_CHANGE_REQUIRED' });
  }
  req.user = user;
  return next();
}

module.exports = requireAuth;
