/**
 * TOTP (RFC 6238, over HOTP RFC 4226) on Node's crypto — no dependency. 6 digits, 30-second steps,
 * HMAC-SHA1 (what every authenticator app expects), one step of drift accepted either side
 * (specs/control-plane-plans-and-access.md rule 31).
 */

const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(key, counter, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

function totp(key, date, digits = 6) {
  return hotp(key, Math.floor(date.getTime() / 1000 / STEP_SECONDS), digits);
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function verifyTotp(secretBase32, code, date) {
  const candidate = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(candidate)) return false;
  const key = base32Decode(secretBase32);
  const counter = Math.floor(date.getTime() / 1000 / STEP_SECONDS);
  return [-1, 0, 1].some((drift) => crypto.timingSafeEqual(Buffer.from(hotp(key, counter + drift)), Buffer.from(candidate)));
}

function otpauthUri({ secret, account, issuer = 'Console GuestFlow' }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

// "JBSW Y3DP …" — what an operator types when they cannot scan.
const groupSecret = (secret) => secret.replace(/(.{4})/g, '$1 ').trim();

module.exports = { base32Encode, base32Decode, hotp, totp, generateSecret, verifyTotp, otpauthUri, groupSecret };
