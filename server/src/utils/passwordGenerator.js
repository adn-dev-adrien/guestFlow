// Generates the temporary password emailed to a newly-created user (specs/admin-account-management.md).
// The alphabet purposely excludes I / O / l / 0 / 1 — characters that look alike on most fonts and
// are a common source of "the password didn't work" support tickets. Each call returns an
// independent random string built from a CSPRNG (crypto.randomInt).

const crypto = require('crypto');

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   // no I, no O
const LOWER = 'abcdefghjkmnpqrstuvwxyz';    // no i, no l, no o
const DIGITS = '23456789';                   // no 0, no 1
const ALPHABET = UPPER + LOWER + DIGITS;

const DEFAULT_LENGTH = 12;
const MIN_LENGTH = 8;
const MAX_LENGTH = 64;

function pickFrom(chars) {
  return chars[crypto.randomInt(0, chars.length)];
}

function generateTemporaryPassword(length = DEFAULT_LENGTH) {
  if (!Number.isInteger(length) || length < MIN_LENGTH || length > MAX_LENGTH) {
    throw new Error(`INVALID_PASSWORD_LENGTH (got ${length}, expected ${MIN_LENGTH}..${MAX_LENGTH})`);
  }
  // Guarantee at least one character from each class so the password is "obviously" mixed-strength
  // even when the user just glances at it.
  const required = [pickFrom(UPPER), pickFrom(LOWER), pickFrom(DIGITS)];
  const rest = [];
  for (let i = 0; i < length - required.length; i += 1) {
    rest.push(pickFrom(ALPHABET));
  }
  // Fisher-Yates shuffle so the required characters land in random positions.
  const chars = [...required, ...rest];
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

module.exports = {
  generateTemporaryPassword,
  __test: { UPPER, LOWER, DIGITS, ALPHABET, DEFAULT_LENGTH },
};
