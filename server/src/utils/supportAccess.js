/**
 * Support access with consent — the tokens the console signs and the instance verifies
 * (specs/hosting-h2-account-security.md rules 12–17). Shared with the console through `utils/gf.js`,
 * so both sides sign and read exactly the same format.
 *
 * Two tokens, both compact JWS signed with the console's Ed25519 key (the licence key of
 * specs/control-plane-plans-and-access.md rule 30), told apart by `typ`:
 *
 * - **the request** (`support-request`), written by the console to `<dataDir>/support-request.jws`
 *   next to the licence: `{ typ, slug, requestId, reason, requestedAt }`. The instance turns it into
 *   the pending banner. No port is opened on the instance for it.
 * - **the sign-in link** (`support-login`): `{ typ, slug, accessId, jti, exp }`, valid 2 minutes and
 *   accepted once (its `jti` is remembered).
 */

const fs = require('fs');
const path = require('path');
const { signLicence, verifyJws } = require('./licence');

const REQUEST_FILE = 'support-request.jws';
const LINK_TTL_MS = 2 * 60 * 1000;
// Rule 13: 24 h by default, 1 h or 7 days on request.
const DURATION_HOURS = [1, 24, 168];
const DEFAULT_HOURS = 24;
const REASON_MAX = 200;
const SUPPORT_USER_EMAIL = 'support@guestflow.invalid';

function toKeyObject(publicKey) {
  if (!publicKey) return null;
  if (typeof publicKey === 'object') return publicKey;
  try {
    return require('crypto').createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
  } catch {
    return null;
  }
}

const sign = (payload, privateKey) => signLicence(payload, privateKey);

function signRequest({ slug, requestId, reason, requestedAt }, privateKey) {
  return sign({ typ: 'support-request', slug, requestId, reason, requestedAt }, privateKey);
}

function signLink({ slug, accessId, jti, now }, privateKey) {
  return sign({ typ: 'support-login', slug, accessId, jti, exp: new Date(now.getTime() + LINK_TTL_MS).toISOString() }, privateKey);
}

// → payload, or throws with a short reason. `slug` is checked only when the instance knows its own.
function verifyToken(token, { publicKey, typ, slug = null }) {
  const key = toKeyObject(publicKey);
  if (!key) throw new Error('no verification key');
  const payload = verifyJws(token, key);
  if (payload.typ !== typ) throw new Error('wrong token type');
  if (slug && payload.slug !== slug) throw new Error('issued for another instance');
  return payload;
}

function verifyLink(token, { publicKey, slug, now }) {
  const payload = verifyToken(token, { publicKey, typ: 'support-login', slug });
  const exp = Date.parse(payload.exp);
  if (!Number.isFinite(exp) || exp <= now.getTime()) throw new Error('expired');
  if (!Number.isInteger(payload.accessId) || !payload.jti) throw new Error('malformed');
  return payload;
}

// The request file, verified; null when there is none or it does not verify.
function readRequest({ dataDir, publicKey, slug, readFile = (f) => fs.readFileSync(f, 'utf8') }) {
  let token;
  try {
    token = readFile(path.join(dataDir, REQUEST_FILE));
  } catch {
    return null;
  }
  try {
    const payload = verifyToken(String(token).trim(), { publicKey, typ: 'support-request', slug });
    const reason = String(payload.reason || '').trim().slice(0, REASON_MAX);
    if (!payload.requestId || !reason) return null;
    return { requestId: String(payload.requestId), reason, requestedAt: String(payload.requestedAt || '') };
  } catch {
    return null;
  }
}

module.exports = {
  REQUEST_FILE,
  LINK_TTL_MS,
  DURATION_HOURS,
  DEFAULT_HOURS,
  REASON_MAX,
  SUPPORT_USER_EMAIL,
  signRequest,
  signLink,
  verifyLink,
  readRequest,
};
