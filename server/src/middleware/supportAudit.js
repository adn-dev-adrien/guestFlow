/**
 * The support session's guard and trace (specs/hosting-h2-account-security.md rules 14–16, 18, 19),
 * mounted on `/api` before every router.
 *
 * - A support session is recognised by the marker its sign-in link left in the session
 *   (`supportAccessId`), or by the account it borrows (rule 21): never by an email address.
 * - It lives only while its access is open: once it expired or was revoked, the next request answers
 *   401 SUPPORT_ACCESS_ENDED and the session is destroyed.
 * - What it may not do (utils/supportSessionPolicy.js) answers 403, judged on the path Express
 *   routes (any case, trailing slash).
 * - Every request that changes data is written to `support_access_log` with its outcome, a refused
 *   one included; every read too, once per path and per minute (rule 19). The pages it opens are
 *   reported by the client through POST /api/support-access/page.
 */

const { normalizePath, forbiddenReason, isRead } = require('../utils/supportSessionPolicy');

const READ_DEDUPE_MS = 60 * 1000;
const READ_DEDUPE_MAX = 2000;
// What the application polls on its own: not something the support chose to look at.
const UNLOGGED_READS = [/^\/auth(\/|$)/, /^\/support-access(\/|$)/, /^\/version$/];

const MESSAGES = {
  account: 'Action réservée au compte du client.',
  credentials: 'Identifiants et accès réservés au client.',
};

function isSupportSession(req) {
  const session = req.session;
  if (!session) return false;
  return Boolean(session.supportAccessId || (session.user && session.user.isSupport));
}

function createSupportAudit({ controller, isSecretSetting, isHidden = () => false, now = () => Date.now() }) {
  const lastRead = new Map();
  const policyDeps = isSecretSetting ? { isSecretSetting } : undefined;

  // true when this read was already logged within the minute; the map never outgrows its cap.
  function readSeenRecently(key) {
    const t = now();
    const seen = lastRead.get(key);
    if (seen !== undefined && t - seen < READ_DEDUPE_MS) return true;
    if (lastRead.size >= READ_DEDUPE_MAX) {
      for (const [k, at] of lastRead) if (t - at >= READ_DEDUPE_MS) lastRead.delete(k);
      if (lastRead.size >= READ_DEDUPE_MAX) lastRead.delete(lastRead.keys().next().value);
    }
    lastRead.set(key, t);
    return false;
  }

  return function supportAudit(req, res, next) {
    if (!isSupportSession(req)) return next();
    const access = controller.sessionAccess(req.session.supportAccessId);
    if (!access) {
      const end = () => res.status(401).json({ error: 'SUPPORT_ACCESS_ENDED', message: 'Accès du support terminé.' });
      return typeof req.session.destroy === 'function' ? req.session.destroy(end) : end();
    }
    const method = String(req.method).toUpperCase();
    const path = normalizePath(req.path);
    // A route the space hides answers and is logged like an unknown one: no 403 to tell it apart.
    const reason = isHidden(req) ? null : forbiddenReason(method, req.path, req.body, policyDeps);
    if (reason) {
      controller.record(access.id, { method, path: `/api${path}`, summary: '403' });
      return res.status(403).json({ error: 'SUPPORT_FORBIDDEN', message: MESSAGES[reason] });
    }
    const logged = isRead(method)
      ? method === 'GET' && !UNLOGGED_READS.some((re) => re.test(path)) && !readSeenRecently(`${access.id} ${path}`)
      : path !== '/support-access/page' && path !== '/auth/logout';
    if (logged) {
      res.on('finish', () => controller.record(access.id, { method, path: `/api${path}`, summary: String(res.statusCode) }));
    }
    return next();
  };
}

const isForbidden = (method, path, body, deps) => forbiddenReason(method, path, body, deps) !== null;

module.exports = { createSupportAudit, isForbidden, isSupportSession };
