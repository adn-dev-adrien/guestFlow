/**
 * The support session's guard and trace (specs/hosting-h2-account-security.md rules 14–16), mounted
 * on `/api` before every router.
 *
 * - A support session lives only while its access is open: once it expired or was revoked, the next
 *   request answers 401 SUPPORT_ACCESS_ENDED and the session is destroyed.
 * - Every request that changes data is written to `support_access_log` with its outcome (the pages
 *   it opens are logged by the client through POST /api/support-access/page).
 * - The support cannot decide its own access, nor touch the account it borrows: password, second
 *   step, profile.
 */

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Paths relative to `/api`.
function isForbidden(method, path) {
  if (path === '/auth/change-password') return true;
  if (path.startsWith('/auth/2fa/') && !READ_METHODS.has(method)) return true;
  if (path === '/users/me' && !READ_METHODS.has(method)) return true;
  if (path.startsWith('/support-access') && !READ_METHODS.has(method) && path !== '/support-access/page') return true;
  return false;
}

function createSupportAudit({ controller }) {
  return function supportAudit(req, res, next) {
    const user = req.session && req.session.user;
    if (!user || !user.isSupport) return next();
    const access = controller.sessionAccess(req.session.supportAccessId);
    if (!access) {
      const end = () => res.status(401).json({ error: 'SUPPORT_ACCESS_ENDED', message: 'Accès du support terminé.' });
      return typeof req.session.destroy === 'function' ? req.session.destroy(end) : end();
    }
    if (isForbidden(req.method, req.path)) {
      return res.status(403).json({ error: 'SUPPORT_FORBIDDEN', message: 'Action réservée au compte du client.' });
    }
    if (!READ_METHODS.has(req.method) && req.path !== '/support-access/page' && req.path !== '/auth/logout') {
      res.on('finish', () => controller.record(access.id, { method: req.method, path: `/api${req.path}`, summary: String(res.statusCode) }));
    }
    return next();
  };
}

module.exports = { createSupportAudit, isForbidden };
