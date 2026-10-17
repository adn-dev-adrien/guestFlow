/**
 * Writes under /api come from this app's own pages (specs/plugins-phase-4-registry.md rule 31, PR
 * review minor 9). A browser sends `Origin` (or at least `Referer`) with every cross-site write; a
 * write whose origin is another site is refused, so a page elsewhere cannot use an administrator's
 * session to install or update a plugin — or to do anything else.
 *
 *   - GET, HEAD and OPTIONS pass: they change nothing.
 *   - A request without Origin and Referer is not a browser's (scripts, tests, server-to-server): it
 *     passes, and the session guard still applies.
 *   - `isExempt(req)` lets through what never comes from the app: the plugin webhooks (a provider
 *     calling back). The public API (/public/v1, the WordPress site) is not under /api at all.
 *   - Same origin = the request's own host AND port (behind a trusted proxy, the forwarded host), or
 *     one of the CORS origins.
 */

function originOf(value) {
  try {
    const u = new URL(value);
    return { origin: u.origin, host: u.host };
  } catch {
    return null;
  }
}

// `Host` as the request names it, default port dropped like URL.host does.
const requestHost = (req) => String(req.host || req.get('host') || '').toLowerCase()
  .replace(req.protocol === 'https' ? /:443$/ : /:80$/, '');

function createSameOriginWrites({ allowedOrigins = [], isExempt = () => false } = {}) {
  const allowed = new Set(allowedOrigins);
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    if (isExempt(req)) return next();
    const raw = req.get('origin') || req.get('referer');
    if (!raw) return next();
    const source = raw === 'null' ? null : originOf(raw);
    if (source && (source.host === requestHost(req) || allowed.has(source.origin))) return next();
    return res.status(403).json({ error: 'CROSS_ORIGIN', message: 'Requête refusée : elle ne vient pas de GuestFlow.' });
  };
}

module.exports = { createSameOriginWrites };
