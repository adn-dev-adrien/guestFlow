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

// GUESTFLOW_LOCAL_ENV moves it out of a release shared by several instances (specs/hosting-h1-fleet-runtime.md H-D4).
const ENV_PATH = require('./instancePaths').localEnvPath();

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

function readFileVars() {
  return fs.existsSync(ENV_PATH) ? parseEnv(fs.readFileSync(ENV_PATH, 'utf8')) : {};
}

// Secrets the operator can rotate from the app (rotateSecret). For these the file is the only
// authority: a value inherited from the environment is a stale copy — pm2 saves the environment it was
// restarted with (`--update-env`), so the key read at the previous boot would come back after every
// restart and silently undo the rotation.
const rotatableNames = new Set();

function loadLocalEnv() {
  if (!fs.existsSync(ENV_PATH)) return;
  const parsed = readFileVars();
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined || rotatableNames.has(key)) process.env[key] = value;
  }
}

/**
 * A copy of `process.env` for a child process that outlives this one (the self-update helper hands
 * its environment to `pm2 … --update-env`, which saves it for every later restart). Values that came
 * from `.env.local` are left out, so the file stays their single source of truth.
 */
function environmentWithoutLocalFile(env = process.env) {
  const fileVars = readFileVars();
  const out = { ...env };
  for (const [key, value] of Object.entries(fileVars)) {
    if (rotatableNames.has(key) || out[key] === value) delete out[key];
  }
  return out;
}

function appendVar(name, value) {
  const line = `${name}=${value}\n`;
  const prefix = fs.existsSync(ENV_PATH) && fs.readFileSync(ENV_PATH, 'utf8').endsWith('\n') === false ? '\n' : '';
  fs.appendFileSync(ENV_PATH, prefix + line, { mode: 0o600 });
  try { fs.chmodSync(ENV_PATH, 0o600); } catch { /* best effort on non-POSIX */ }
}

/**
 * Returns a persistent base64 secret named `name`, generating `byteLength` random bytes and writing
 * it to `.env.local` the first time. Reads from `process.env` first (real env wins), except for a
 * `rotatable` secret the file already holds: there the file wins (see `rotatableNames`).
 */
function getOrCreateSecret(name, byteLength = 32, { rotatable = false } = {}) {
  if (rotatable) rotatableNames.add(name);
  loadLocalEnv();
  const existing = process.env[name];
  if (existing && existing.trim()) return existing.trim();
  const secret = crypto.randomBytes(byteLength).toString('base64');
  process.env[name] = secret;
  appendVar(name, secret);
  return secret;
}

/**
 * Persist a specific (non-random) value to `.env.local` + `process.env` if not already set. Used for
 * value pairs that must be generated together (e.g. the VAPID keypair). Real env wins.
 */
function persistVar(name, value) {
  loadLocalEnv();
  if (process.env[name] && String(process.env[name]).trim()) return process.env[name].trim();
  process.env[name] = value;
  appendVar(name, value);
  return value;
}

/**
 * Replaces the secret `name` with `byteLength` fresh random bytes, in `.env.local` and `process.env`,
 * and returns it; from then on the file wins over any inherited copy. A value only the real
 * environment sets (absent from the file) cannot be rotated from here: that throws an error with
 * `code = 'SECRET_FROM_ENVIRONMENT'`.
 */
function rotateSecret(name, byteLength = 32) {
  rotatableNames.add(name);
  loadLocalEnv();
  const fileVars = readFileVars();
  const current = process.env[name] && String(process.env[name]).trim();
  if (current && fileVars[name] === undefined) {
    const err = new Error(`${name} is set by the environment`);
    err.code = 'SECRET_FROM_ENVIRONMENT';
    throw err;
  }
  const secret = crypto.randomBytes(byteLength).toString('base64');
  if (fileVars[name] === undefined) {
    appendVar(name, secret);
  } else {
    const lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n')
      .map((line) => (line.trim().startsWith(`${name}=`) ? `${name}=${secret}` : line));
    fs.writeFileSync(ENV_PATH, lines.join('\n'), { mode: 0o600 });
  }
  process.env[name] = secret;
  return secret;
}

module.exports = {
  loadLocalEnv, getOrCreateSecret, persistVar, rotateSecret, environmentWithoutLocalFile, ENV_PATH,
};
