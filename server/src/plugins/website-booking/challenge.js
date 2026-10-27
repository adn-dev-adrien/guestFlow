/**
 * Proof of work for the website booking request (specs/public-request-abuse-and-grouping.md rules
 * 1-5b). Expensive for a robot, invisible for a guest, and never a lockout: nothing here is shared by
 * every visitor except the flood surcharge, which only makes the work longer, capped.
 *
 * A challenge is signed, not stored: `issue` hands out { challengeId, salt, difficulty, issuedAt,
 * expiresAt, signature }, the HMAC covering every other field AND the visitor's address key, so a
 * cheap challenge fetched from one address cannot be spent from another. The browser finds a `nonce`
 * such that SHA-256(salt + nonce) starts with `difficulty` zero bits; `verify` checks it with one hash.
 * Spending it once is the request store's job (requestStore.spendChallenge).
 */

const crypto = require('crypto');
const net = require('net');

const SECRET_NAME = 'PUBLIC_REQUEST_CHALLENGE_SECRET';
const TTL_MS = 15 * 60 * 1000;
const MIN_FILL_MS = 3 * 1000;
const BASE_BITS = 12;
const PER_REQUEST_BITS = 2;
const SURGE_THRESHOLD = 20;
const SURGE_STEP_BITS = 2;
const SURGE_CAP_BITS = 6;
// Rule 5b — capped: even a guest behind an address that just sent four requests, during a flood,
// solves it in about ten seconds on a phone (≈ 4 million hashes).
const MAX_BITS = 22;
const NONCE_RE = /^[0-9a-z]{1,32}$/;
const HEX_RE = /^[0-9a-f]+$/;

/** The address a difficulty is counted on: an IPv4 as is, an IPv6 by its /64 (rule 4). */
function ipKeyOf(ip) {
  const raw = String(ip || '').trim();
  if (net.isIPv4(raw)) return raw;
  if (!net.isIPv6(raw)) return '';
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(raw);
  if (v4) return v4[1];
  const [head, tail = ''] = raw.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = raw.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/** Rule 5b — +2 bits per 20 requests above the first 20 of the hour, at most +6. */
function surgeBits(requestsLastHour) {
  const over = Number(requestsLastHour || 0) - SURGE_THRESHOLD;
  if (over <= 0) return 0;
  return Math.min(SURGE_CAP_BITS, SURGE_STEP_BITS * Math.ceil(over / SURGE_THRESHOLD));
}

/** Rules 4 + 5b — base, +2 bits per request from this address in the hour, the flood surcharge, capped. */
function difficultyFor({ addressRequestsLastHour = 0, requestsLastHour = 0 } = {}) {
  return Math.min(MAX_BITS, BASE_BITS + surgeBits(requestsLastHour) + PER_REQUEST_BITS * Number(addressRequestsLastHour || 0));
}

function signatureOf(fields, ipKey, secret) {
  const payload = [fields.challengeId, fields.salt, fields.difficulty, fields.issuedAt, fields.expiresAt, ipKey].join('|');
  return crypto.createHmac('sha256', String(secret)).update(payload).digest('hex');
}

function issue({ secret, ipKey = '', difficulty, now = Date.now() }) {
  const fields = {
    challengeId: crypto.randomBytes(16).toString('hex'),
    salt: crypto.randomBytes(16).toString('hex'),
    difficulty: Number(difficulty),
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TTL_MS).toISOString(),
  };
  return { ...fields, signature: signatureOf(fields, ipKey, secret) };
}

function leadingZeroBits(buf) {
  let bits = 0;
  for (const byte of buf) {
    if (byte === 0) { bits += 8; continue; }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

function hashOf(salt, nonce) {
  return crypto.createHash('sha256').update(`${salt}${nonce}`, 'utf8').digest();
}

const sameHex = (a, b) => {
  const x = Buffer.from(String(a || ''), 'hex');
  const y = Buffer.from(String(b || ''), 'hex');
  return x.length === 32 && y.length === 32 && crypto.timingSafeEqual(x, y);
};

/**
 * Rules 3 + 5. → { ok: true } or { ok: false, reason } with reason ∈ missing · forged · expired ·
 * tooFast · wrong. Whether it was already spent is answered by the store.
 */
function verify({ secret, challenge, nonce, ipKey = '', now = Date.now() }) {
  const c = challenge && typeof challenge === 'object' ? challenge : null;
  if (!c || nonce === undefined || nonce === null || nonce === '') return { ok: false, reason: 'missing' };
  const fields = {
    challengeId: String(c.challengeId || ''),
    salt: String(c.salt || ''),
    difficulty: Number(c.difficulty),
    issuedAt: String(c.issuedAt || ''),
    expiresAt: String(c.expiresAt || ''),
  };
  if (!HEX_RE.test(fields.challengeId) || !HEX_RE.test(fields.salt) || !Number.isInteger(fields.difficulty)) {
    return { ok: false, reason: 'forged' };
  }
  if (!sameHex(c.signature, signatureOf(fields, ipKey, secret))) return { ok: false, reason: 'forged' };
  const issuedAt = Date.parse(fields.issuedAt);
  const expiresAt = Date.parse(fields.expiresAt);
  if (!Number.isFinite(expiresAt) || now > expiresAt) return { ok: false, reason: 'expired' };
  if (!Number.isFinite(issuedAt) || now - issuedAt < MIN_FILL_MS) return { ok: false, reason: 'tooFast' };
  const n = String(nonce);
  if (!NONCE_RE.test(n)) return { ok: false, reason: 'wrong' };
  if (leadingZeroBits(hashOf(fields.salt, n)) < fields.difficulty) return { ok: false, reason: 'wrong' };
  return { ok: true, challengeId: fields.challengeId, expiresAt: fields.expiresAt };
}

/** Test and tooling helper: the smallest nonce that solves `challenge` (what the browser worker does). */
function solve(challenge) {
  for (let n = 0; ; n += 1) {
    const nonce = n.toString(36);
    if (leadingZeroBits(hashOf(challenge.salt, nonce)) >= challenge.difficulty) return nonce;
  }
}

module.exports = {
  SECRET_NAME,
  TTL_MS,
  MIN_FILL_MS,
  BASE_BITS,
  MAX_BITS,
  ipKeyOf,
  surgeBits,
  difficultyFor,
  issue,
  verify,
  solve,
  leadingZeroBits,
};
