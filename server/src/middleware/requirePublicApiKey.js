const crypto = require('crypto');

/**
 * Public API authentication — a single shared secret for the trusted server-to-server caller
 * (the WordPress proxy). Distinct from the admin session auth (requireAuth.js). See
 * specs/public-api.md §3 rule 2.
 *
 * The key is read from `process.env.PUBLIC_API_KEY` (provisioned/auto-generated at boot in
 * index.js via localEnv). It is accepted from either:
 *   - `Authorization: Bearer <key>`
 *   - `X-API-Key: <key>`
 *
 * Comparison is constant-time to avoid leaking the key length/prefix through timing. On any
 * miss the request is rejected with the uniform public error envelope and 401. Fail closed:
 * if no key is configured server-side, every public request is rejected.
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

function requirePublicApiKey(req, res, next) {
  const configured = String(process.env.PUBLIC_API_KEY || '').trim();
  const provided = extractKey(req);
  if (!configured || !provided || !safeEqual(provided, configured)) {
    return res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: "Clé d'API manquante ou invalide." },
    });
  }
  return next();
}

module.exports = requirePublicApiKey;
