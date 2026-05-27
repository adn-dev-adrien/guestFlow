const crypto = require('crypto');

/**
 * Password hashing with Node's built-in scrypt (no external dependency).
 *
 * Stored format: `scrypt:<saltBase64>:<hashBase64>`. Each hash uses a fresh 16-byte salt.
 * Verification is constant-time. Never log passwords or hashes.
 */

const SALT_BYTES = 16;
const KEY_LEN = 64;

function hashPassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Password must be a non-empty string');
  }
  const salt = crypto.randomBytes(SALT_BYTES);
  const derived = crypto.scryptSync(password, salt, KEY_LEN);
  return `scrypt:${salt.toString('base64')}:${derived.toString('base64')}`;
}

function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'base64');
  const expected = Buffer.from(parts[2], 'base64');
  let derived;
  try {
    derived = crypto.scryptSync(password, salt, expected.length);
  } catch {
    return false;
  }
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

module.exports = { hashPassword, verifyPassword };
