/**
 * Every console API route but the login needs a fully authenticated operator (rule 31): password
 * *and* second factor. The session expires after 12 hours, or 30 minutes without a request.
 */

const ABSOLUTE_MS = 12 * 60 * 60 * 1000;
const IDLE_MS = 30 * 60 * 1000;

function requireOperator({ now = () => new Date() } = {}) {
  return function requireOperatorMiddleware(req, res, next) {
    const s = req.session;
    const t = now().getTime();
    if (!s || !s.operatorId) return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Connectez-vous.' });
    if (t - s.loggedInAt > ABSOLUTE_MS || t - s.lastSeenAt > IDLE_MS) {
      return s.destroy(() => res.status(401).json({ error: 'SESSION_EXPIRED', message: 'Session expirée : reconnectez-vous.' }));
    }
    s.lastSeenAt = t;
    return next();
  };
}

module.exports = { requireOperator, ABSOLUTE_MS, IDLE_MS };
