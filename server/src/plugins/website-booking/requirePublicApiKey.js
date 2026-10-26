const crypto = require('crypto');

/**
 * Public API authentication — server-to-server callers, each with its own shared secret. Distinct
 * from the admin session auth (requireAuth.js). See specs/public-api.md §3 rule 2 and
 * specs/roostview-api-key.md.
 *
 * Two keys, read from the environment (provisioned/auto-generated at boot in index.js via localEnv):
 *   - `PUBLIC_API_KEY`    → the WordPress proxy: the whole `/public/v1` tree.
 *   - `ROOSTVIEW_API_KEY` → Roostview (price watch): READ-ONLY — the property catalogue, its
 *     availability and the quote engine. Anything else (booking requests, terms, plugin updates)
 *     answers 403, so revoking one caller never touches the other.
 *
 * The key is accepted from either `Authorization: Bearer <key>` or `X-API-Key: <key>`.
 * Comparison is constant-time to avoid leaking the key length/prefix through timing. On any
 * miss the request is rejected with the uniform public error envelope and 401. Fail closed:
 * a caller whose key is not configured server-side is always rejected.
 *
 * Sets `req.publicApiCaller` to 'site' or 'roostview'.
 */

function extractKey(req) {
  const auth = req.get('authorization');
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  const header = req.get('x-api-key');
  if (header) return String(header).trim();
  return '';
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  // timingSafeEqual throws on length mismatch — hash both sides to a fixed length first so the
  // comparison stays constant-time regardless of the provided key's length.
  const hashA = crypto.createHash('sha256').update(bufA).digest();
  const hashB = crypto.createHash('sha256').update(bufB).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/** What Roostview may call: GET under /properties, and POST /quote (computes, never persists). */
function roostviewMayCall(req) {
  const path = String(req.path || '').replace(/\/+$/, '') || '/';
  if (req.method === 'GET' && (path === '/properties' || path.startsWith('/properties/'))) return true;
  return req.method === 'POST' && path === '/quote';
}

function callerFor(provided) {
  if (!provided) return null;
  const site = String(process.env.PUBLIC_API_KEY || '').trim();
  const roostview = String(process.env.ROOSTVIEW_API_KEY || '').trim();
  // Both comparisons always run: which key matched does not show in the timing.
  const isSite = site ? safeEqual(provided, site) : false;
  const isRoostview = roostview ? safeEqual(provided, roostview) : false;
  if (isSite) return 'site';
  if (isRoostview) return 'roostview';
  return null;
}

function requirePublicApiKey(req, res, next) {
  const caller = callerFor(extractKey(req));
  if (!caller) {
    return res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: "Clé d'API manquante ou invalide." },
    });
  }
  if (caller === 'roostview' && !roostviewMayCall(req)) {
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: "Cette clé d'API est en lecture seule." },
    });
  }
  req.publicApiCaller = caller;
  return next();
}

module.exports = requirePublicApiKey;
module.exports.roostviewMayCall = roostviewMayCall;
