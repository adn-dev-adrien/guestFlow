const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Minimal `.env.local` manager (no dotenv dependency).
 *
 * - `loadLocalEnv()` parses `server/.env.local` into `process.env` (without overwriting vars already
 *   set in the real environment), so secrets persist across restarts.
 * - `getOrCreateSecret(name)` returns a base64 secret, generating and persisting it on first use.
 *
 * The file holds auto-generated secrets (encryption key, session secret). It is git-ignored
 * (`.env.*`) and must never be committed.
 */

const ENV_PATH = path.join(__dirname, '..', '..', '.env.local');

function parseEnv(content) {
  const out = {};
  for (const rawLine of String(content).split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

function loadLocalEnv() {
  if (!fs.existsSync(ENV_PATH)) return;
  const parsed = parseEnv(fs.readFileSync(ENV_PATH, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function appendVar(name, value) {
  const line = `${name}=${value}\n`;
  const prefix = fs.existsSync(ENV_PATH) && fs.readFileSync(ENV_PATH, 'utf8').endsWith('\n') === false ? '\n' : '';
  fs.appendFileSync(ENV_PATH, prefix + line, { mode: 0o600 });
  try { fs.chmodSync(ENV_PATH, 0o600); } catch { /* best effort on non-POSIX */ }
}

/**
 * Returns a persistent base64 secret named `name`, generating `byteLength` random bytes and writing
 * it to `.env.local` the first time. Reads from `process.env` first (real env wins).
 */
function getOrCreateSecret(name, byteLength = 32) {
  loadLocalEnv();
  const existing = process.env[name];
  if (existing && existing.trim()) return existing.trim();
  const secret = crypto.randomBytes(byteLength).toString('base64');
  process.env[name] = secret;
  appendVar(name, secret);
  return secret;
}

module.exports = { loadLocalEnv, getOrCreateSecret, ENV_PATH };
