const crypto = require('crypto');
const { getOrCreateSecret } = require('./localEnv');

/**
 * AES-256-GCM encryption for credentials at rest (e.g. Google service-account private key).
 *
 * Values are stored tagged as `enc:v1:<iv>:<authTag>:<ciphertext>` (each part base64) so encrypted
 * values are self-describing and legacy cleartext is detectable for transparent migration.
 *
 * The 32-byte key lives in `GUESTFLOW_ENCRYPTION_KEY` (base64), auto-generated into `.env.local` on
 * first use. Never log the key or decrypted secrets.
 */

const PREFIX = 'enc:v1:';
const IV_BYTES = 12; // GCM standard nonce length

let cachedKey = null;
function getKey() {
  if (cachedKey) return cachedKey;
  const b64 = getOrCreateSecret('GUESTFLOW_ENCRYPTION_KEY', 32);
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) {
    throw new Error('GUESTFLOW_ENCRYPTION_KEY must decode to 32 bytes');
  }
  cachedKey = key;
  return key;
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/**
 * Encrypts a string. Empty/nullish input is returned unchanged (nothing to protect).
 */
function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return plaintext;
  if (isEncrypted(plaintext)) return plaintext; // already encrypted, idempotent
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/**
 * Decrypts a tagged value. A legacy cleartext (untagged) value is returned as-is so reads keep working
 * during/after migration. Throws on a tampered/corrupted tagged value (fail loud, never silent-empty).
 */
function decrypt(value) {
  if (!isEncrypted(value)) return value;
  const parts = value.slice(PREFIX.length).split(':');
  if (parts.length !== 3) throw new Error('Malformed encrypted value');
  const [ivB64, tagB64, dataB64] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  return plaintext.toString('utf8');
}

module.exports = { encrypt, decrypt, isEncrypted };
