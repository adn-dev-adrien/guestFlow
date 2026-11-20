/**
 * The voucher code (specs/gift-vouchers.md rules 30, 32, 34). Pure: randomness, pepper and the encryption pair are
 * injected, so a suite proves every property without a key or a clock.
 *
 * 16 characters of the Crockford alphabet. The 16th is a Damm check character over GF(2^5): the operation
 * `x * y = 2 (x xor y)` (field multiplication modulo x^5 + x^2 + 1) is a Latin square, so any single-character
 * substitution changes the result; `x * x = 0` and `(c * x) * y != (c * y) * x` for `x != y`, so any adjacent swap does
 * too. A code is well formed when folding its 16 characters lands on 0, and the check character is the state the 15
 * drawn ones leave.
 */

const crypto = require('crypto');

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const DRAWN_LENGTH = 15;
const CODE_LENGTH = DRAWN_LENGTH + 1;
const GROUP = 4;
const REDUCER = 0b100101;

const indexOf = new Map([...ALPHABET].map((c, i) => [c, i]));

function fold(state, index) {
  const shifted = (state ^ index) << 1;
  return shifted & 0b100000 ? shifted ^ REDUCER : shifted;
}

const stateOf = (chars) => [...chars].reduce((state, c) => fold(state, indexOf.get(c)), 0);

/**
 * 15 characters from `randomBytes`. 256 is a multiple of 32, so the low five bits of a byte are uniform and no draw
 * is ever rejected: rejection sampling would be dead code over this alphabet.
 */
function draw(randomBytes = crypto.randomBytes) {
  const bytes = randomBytes(DRAWN_LENGTH);
  let body = '';
  for (let i = 0; i < DRAWN_LENGTH; i += 1) body += ALPHABET[bytes[i] & 31];
  return body;
}

/** → the 16 characters of a new code, normalised (no separator). */
function generate(randomBytes = crypto.randomBytes) {
  const body = draw(randomBytes);
  return `${body}${ALPHABET[stateOf(body)]}`;
}

/** Upper case, I and L read as 1, O as 0, every separator dropped (rule 30). */
function normalise(input) {
  return String(input == null ? '' : input).toUpperCase().replace(/[\s\-_.·]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
}

/** 16 characters of the alphabet, whatever their check. */
const isWellFormed = (normalised) => normalised.length === CODE_LENGTH && [...normalised].every((c) => indexOf.has(c));

/** Rule 34 — false for a code a person mistyped: answered before any lookup, never counted. */
const hasValidCheck = (normalised) => isWellFormed(normalised) && stateOf(normalised) === 0;

/** `7K2Q-HD9M-4TXB-3NPC` */
const format = (normalised) => normalised.match(new RegExp(`.{1,${GROUP}}`, 'g')).join('-');

/** The last 4 characters, shown on the operator's page and in the booking summary (rule 26). */
const mask = (normalised) => `····${normalised.slice(-GROUP)}`;

/** Rule 32 — the lookup key: HMAC-SHA-256 under the pepper, hex. */
const hashCode = (pepper, normalised) => crypto.createHmac('sha256', String(pepper)).update(normalised, 'utf8').digest('hex');

module.exports = {
  ALPHABET, CODE_LENGTH, generate, normalise, isWellFormed, hasValidCheck, format, mask, hashCode,
};
