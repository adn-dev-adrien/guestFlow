const crypto = require('crypto');

/**
 * The guest gate-access code (specs/guest-gate-access.md §3.1).
 *
 * One code per reservation, and it is the ONLY secret the guest holds: it identifies the stay on
 * its own, because the unlock screen has no property picker (§3.8 rule 26). Two consequences drive
 * every choice here:
 *
 *   1. **It gets dictated over the phone.** Hence Crockford base32 minus the four ambiguous
 *      letters (I, L, O, U) — 32 symbols, 8 characters, 40 bits. And hence `normalizeCode`, which
 *      folds what a human actually types: lowercase, spaces, the display dash, and the classic
 *      substitutions (someone told "zero" often types the letter O).
 *   2. **It is verified against a salted hash**, never against a stored clear value
 *      (§3.1 rule 3). The clear code lives in its own column so the operator can re-read it, and
 *      the purge nulls that column 7 days after the stay; this module never needs it.
 *
 * 40 bits is not a password's worth of entropy, and it does not have to be: the code lives for one
 * stay, behind 5 attempts per 10 min per IP and a per-code lockout after 10 failures (§3.3 rule 12).
 */

// 32 symbols. Deliberately NOT the RFC 4648 alphabet: I, L, O and U are gone.
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789';
const CODE_LENGTH = 8;

// What a human types instead of what we drew. Applied before validation, never after.
const FOLD = new Map([
  ['I', '1'], ['L', '1'], // "one" dictated, letter typed
  ['O', '0'],             // "zero" dictated, letter typed
]);

/**
 * Draws a code with rejection sampling, so every symbol is equally likely. A plain
 * `byte % 32` would be unbiased here (256 is a multiple of 32), but the alphabet length is the
 * kind of constant that gets edited one day — the rejection loop stays correct if it does.
 */
function generateCode() {
  const max = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  let out = '';
  while (out.length < CODE_LENGTH) {
    for (const byte of crypto.randomBytes(CODE_LENGTH * 2)) {
      if (byte >= max) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === CODE_LENGTH) break;
    }
  }
  return out;
}

/**
 * Turns what the guest typed into the canonical form, or `null` when it cannot be one.
 * Everything outside the alphabet is dropped (dashes, spaces, non-breaking spaces), the rest is
 * upper-cased and folded. A wrong length is `null` — the caller answers 401 either way and must
 * not be able to tell a malformed code from a wrong one.
 */
function normalizeCode(input) {
  if (typeof input !== 'string') return null;
  let out = '';
  for (const rawChar of input.toUpperCase()) {
    const char = FOLD.get(rawChar) || rawChar;
    if (ALPHABET.includes(char)) out += char;
  }
  return out.length === CODE_LENGTH ? out : null;
}

/** `4K7M9QT2` → `4K7M-9QT2`. Display only; never stored, never compared. */
function formatCode(code) {
  const normalized = normalizeCode(code);
  if (!normalized) return '';
  const half = CODE_LENGTH / 2;
  return `${normalized.slice(0, half)}-${normalized.slice(half)}`;
}

function makeSalt() {
  return crypto.randomBytes(16).toString('hex');
}

/** SHA-256 over `salt:code`. Fast on purpose: the brute-force defence is the throttle, not the KDF. */
function hashCode(code, salt) {
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  return crypto.createHash('sha256').update(`${salt}:${normalized}`).digest('hex');
}

/**
 * Constant-time comparison of the submitted code against a stored `{ codeHash, codeSalt }`.
 * Both sides are 64-char hex digests, so `timingSafeEqual` never throws on a length mismatch —
 * and a malformed submission is rejected before it gets here, without a comparison to time.
 */
function verifyCode(input, { codeHash, codeSalt } = {}) {
  if (!codeHash || !codeSalt) return false;
  const candidate = hashCode(input, codeSalt);
  if (!candidate) return false;
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(String(codeHash), 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  ALPHABET,
  CODE_LENGTH,
  generateCode,
  normalizeCode,
  formatCode,
  makeSalt,
  hashCode,
  verifyCode,
};
