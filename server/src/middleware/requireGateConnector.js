const crypto = require('crypto');

/**
 * Authentication of the gate-access connector (specs/gate-access-sowel-connector.md §3.3).
 *
 * Two factors, and they do not protect against the same thing:
 *
 *   - **the key** (`GATE_API_KEY`) proves the caller is the house. It is replayed in full on every
 *     call: whoever reads one call can impersonate the caller until it is rotated.
 *   - **the signature** (`GATE_SIGNING_SECRET`) covers the method, the path WITH its query, the
 *     timestamp and the body byte for byte. The secret never travels: reading a thousand calls
 *     still does not let anyone forge the next one. And because the timestamp is signed, a captured
 *     call cannot be replayed tomorrow.
 *
 * The key is **distinct from `PUBLIC_API_KEY`**: the WordPress site's key has no business reading
 * who sleeps here tonight, nor writing a gate access code.
 *
 * We fail closed: with either secret missing, everything is refused. A channel that silently drops
 * its second factor when a variable is absent is worse than one that never had it — nobody notices.
 */

const FRESHNESS_MS = 2 * 60 * 1000;

function extractKey(req) {
  const auth = req.get('authorization');
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  const header = req.get('x-api-key');
  return header ? String(header).trim() : '';
}

function fixedEqual(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a)).digest();
  const hashB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * The canonical string — THE contract with `sowel-plugin-guest-access/src/guestflow.ts`. Changing
 * the order of a field here while the other half keeps its own makes every call fail in production
 * with both test suites green: hence the vectors pinned on both sides.
 */
function canonicalString(method, pathWithQuery, timestamp, body) {
  return [
    String(method).toUpperCase(),
    String(pathWithQuery),
    String(timestamp),
    crypto.createHash('sha256').update(body || '', 'utf8').digest('hex'),
  ].join('\n');
}

function unauthenticated(res) {
  return res.status(401).json({
    error: { code: 'UNAUTHENTICATED', message: "Appel du connecteur refusé." },
  });
}

function buildRequireGateConnector({ now = () => Date.now(), env = process.env } = {}) {
  return function requireGateConnector(req, res, next) {
    const key = String(env.GATE_API_KEY || '').trim();
    const secret = String(env.GATE_SIGNING_SECRET || '').trim();
    if (!key || !secret) return unauthenticated(res);

    const provided = extractKey(req);
    if (!provided || !fixedEqual(provided, key)) return unauthenticated(res);

    const timestamp = Number(req.get('x-gate-timestamp'));
    if (!Number.isFinite(timestamp) || Math.abs(now() - timestamp) > FRESHNESS_MS) {
      return unauthenticated(res);
    }

    const signature = String(req.get('x-gate-signature') || '');
    // `originalUrl` carries the path AND the query, which is exactly what the caller signed: a
    // `?since=` altered in flight therefore invalidates the signature.
    const body = req.rawBody ? req.rawBody.toString('utf8') : '';
    const expected = crypto
      .createHmac('sha256', secret)
      .update(canonicalString(req.method, req.originalUrl, timestamp, body))
      .digest('hex');

    if (signature.length !== expected.length || !fixedEqual(signature, expected)) {
      return unauthenticated(res);
    }
    return next();
  };
}

module.exports = buildRequireGateConnector();
module.exports.buildRequireGateConnector = buildRequireGateConnector;
module.exports.canonicalString = canonicalString;
