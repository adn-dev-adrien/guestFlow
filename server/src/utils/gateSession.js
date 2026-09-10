// The guest session cookie (specs/guest-gate-access.md §3.3 rule 13).
//
// Stateless on purpose: the cookie carries `accessId.deviceId` and an HMAC over the pair, and
// nothing else. There is no session store to keep, and no revocation problem either — the access
// row is re-read on every request, so a revoked or expired access dies the instant it is revoked,
// whatever cookies are still in pockets. `express-session` would have bought a store, a sweeper and
// an admin-shaped cookie for a page that needs none of it.
//
// The name carries the `__Host-` prefix whenever the cookie can be `Secure`: browsers then refuse
// it from any other host of the domain, which matters because the guest page is a sibling of the
// admin app under `domainesolio.com` (spec §9). Over plain HTTP — dev only — the prefix is illegal,
// so the plain name is used and the guard is simply absent, exactly where it cannot matter.

const crypto = require('crypto');

const SECURE_COOKIE_NAME = '__Host-gate_sid';
const PLAIN_COOKIE_NAME = 'gate_sid';

function cookieName({ secure }) {
  return secure ? SECURE_COOKIE_NAME : PLAIN_COOKIE_NAME;
}

/** Parses a `Cookie:` header into a plain object. Returns {} for anything unparsable. */
function parseCookies(header) {
  const out = {};
  if (!header || typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    const value = part.slice(eq + 1).trim();
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', String(secret)).update(payload).digest('base64url');
}

/** `accessId.deviceId.signature` */
function serialize({ accessId, deviceId }, secret) {
  const payload = `${Number(accessId)}.${String(deviceId)}`;
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * Verifies a cookie value and returns `{ accessId, deviceId }`, or null. A tampered signature, a
 * missing part or a non-numeric access are all the same answer: null. The caller then asks for the
 * code again — the cost of a forged cookie is one code entry, never an opened gate.
 */
function parse(value, secret) {
  if (!value || typeof value !== 'string') return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [rawAccessId, deviceId, signature] = parts;
  if (!rawAccessId || !deviceId || !signature) return null;

  const expected = sign(`${rawAccessId}.${deviceId}`, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const accessId = Number(rawAccessId);
  if (!Number.isInteger(accessId) || accessId <= 0) return null;
  return { accessId, deviceId };
}

/**
 * The `Set-Cookie` value. `maxAgeMs` is capped by the end of the stay by the caller: a cookie that
 * outlives the window is harmless (the access is re-read anyway) but pointless.
 */
function buildSetCookie({ accessId, deviceId }, secret, { secure = false, maxAgeMs = null } = {}) {
  const value = serialize({ accessId, deviceId }, secret);
  const attributes = [
    `${cookieName({ secure })}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) attributes.push('Secure');
  if (maxAgeMs && maxAgeMs > 0) attributes.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  return attributes.join('; ');
}

/** Clears whichever of the two names this deployment uses. */
function buildClearCookie({ secure = false } = {}) {
  const attributes = [`${cookieName({ secure })}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

/** Reads the session out of a request, whichever name is in play. */
function readSession(req, secret, { secure = false } = {}) {
  const cookies = parseCookies(req.headers && req.headers.cookie);
  const value = cookies[cookieName({ secure })] || cookies[SECURE_COOKIE_NAME] || cookies[PLAIN_COOKIE_NAME];
  return parse(value, secret);
}

module.exports = {
  SECURE_COOKIE_NAME,
  PLAIN_COOKIE_NAME,
  cookieName,
  parseCookies,
  serialize,
  parse,
  buildSetCookie,
  buildClearCookie,
  readSession,
};
