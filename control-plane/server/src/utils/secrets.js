/**
 * AES-256-GCM for the secrets the console keeps at rest (the operators' TOTP seeds, the Qonto
 * credentials). The key lives in `<CP_DATA_DIR>/.key`, created on first run with mode 0600, never in
 * the database. The directory's HMAC key (rule 26) is another file of the same kind.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function loadOrCreateKey(dataDir, name = '.key') {
  const file = path.join(dataDir, name);
  if (fs.existsSync(file)) return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
  const key = crypto.randomBytes(32);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, key.toString('base64'), { mode: 0o600 });
  return key;
}

function createSecrets(key) {
  return {
    encrypt(plain) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
      return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${data.toString('base64')}`;
    },
    decrypt(stored) {
      const [v, iv, tag, data] = String(stored).split(':');
      if (v !== 'v1') throw new Error('unknown secret format');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
    },
  };
}

module.exports = { loadOrCreateKey, createSecrets };
