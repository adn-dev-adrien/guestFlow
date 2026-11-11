/**
 * « Faire confiance à cet appareil 30 jours » (specs/hosting-h2-account-security.md rule 7).
 *
 * The cookie holds `<payload>.<mac>`: the payload names the user and the expiry, and the HMAC also
 * covers a fingerprint of the user's password hash and the date the second step was turned on. A new
 * password, or a second step turned off (and on again), changes what the HMAC covers, so every trust
 * given before stops working — with no table to purge.
 */

const crypto = require('crypto');

const TRUST_DAYS = 30;
const TRUST_MS = TRUST_DAYS * 24 * 60 * 60 * 1000;
const cookieName = (userId) => `guestflow.trust.${Number(userId)}`;

const mac = (secret, payload, stamp, enabledAt) => crypto.createHmac('sha256', String(secret))
  .update(`${payload}|${stamp}|${enabledAt}`).digest('base64url');

function issue({ secret, userId, stamp, enabledAt, now }) {
  const payload = Buffer.from(JSON.stringify({ u: Number(userId), e: now.getTime() + TRUST_MS })).toString('base64url');
  return `${payload}.${mac(secret, payload, stamp, enabledAt)}`;
}

function isTrusted(token, { secret, userId, stamp, enabledAt, now }) {
  if (!token || !stamp || !enabledAt) return false;
  const [payload, sig] = String(token).split('.');
  if (!payload || !sig) return false;
  const expected = Buffer.from(mac(secret, payload, stamp, enabledAt));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return false;
  try {
    const { u, e } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return u === Number(userId) && Number(e) > now.getTime();
  } catch {
    return false;
  }
}

// The value of one cookie from a raw `Cookie` header (no cookie-parser in this app).
function readCookie(header, name) {
  const parts = String(header || '').split(';');
  for (const part of parts) {
    const at = part.indexOf('=');
    if (at === -1) continue;
    if (part.slice(0, at).trim() === name) {
      try { return decodeURIComponent(part.slice(at + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

module.exports = { TRUST_DAYS, TRUST_MS, cookieName, issue, isTrusted, readCookie };
