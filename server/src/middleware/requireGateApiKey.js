const crypto = require('crypto');

/**
 * The key the house comes with (specs/guest-gate-access.md §4.3).
 *
 * Distinct from PUBLIC_API_KEY on purpose: the WordPress proxy and the Sowel plugin are different
 * callers with different reach, and sharing one secret would mean the site could drain the gate
 * queue and the house could read the booking API. Neither has any business doing the other's job.
 *
 * Modelled on requirePublicApiKey.js — same constant-time comparison, same fail-closed posture: no
 * key configured server-side means every call is refused, because a gate that opens for an
 * unauthenticated caller is worse than a gate that does not open at all.
 */

function extractKey(req) {
  const auth = req.get('authorization');
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  const header = req.get('x-api-key');
  if (header) return String(header).trim();
  return '';
}

function safeEqual(a, b) {
  // Hash both sides first so the comparison is constant-time whatever the submitted length is —
  // timingSafeEqual throws on a length mismatch, and that throw is itself a signal.
  const hashA = crypto.createHash('sha256').update(Buffer.from(String(a))).digest();
  const hashB = crypto.createHash('sha256').update(Buffer.from(String(b))).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function requireGateApiKey(req, res, next) {
  const configured = String(process.env.GATE_API_KEY || '').trim();
  const provided = extractKey(req);
  if (!configured || !provided || !safeEqual(provided, configured)) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED' } });
  }
  return next();
}

module.exports = requireGateApiKey;
module.exports.__test = { extractKey, safeEqual };
