/**
 * An instance's environment file, `<CP_INSTANCES_ROOT>/<slug>/env` (mode 600) — the whole of its
 * configuration (specs/hosting-h1-fleet-runtime.md rules 1, 18; H-D4). systemd reads it as an
 * `EnvironmentFile`, the local process driver as the child's environment.
 *
 * Rewritten whole each time something changes (a port, a version, a rename): only the two secrets
 * are carried over from the existing file, everything else is derived from the console's records.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ENV_FILE = 'env';
const SECRET_KEYS = ['GUESTFLOW_ENCRYPTION_KEY', 'GUESTFLOW_SESSION_SECRET'];

function parseEnv(text) {
  const out = {};
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    let value = line.slice(eq + 1);
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    out[line.slice(0, eq)] = value;
  }
  return out;
}

// systemd's EnvironmentFile and our parser both read KEY="value" with \" and \\ escaped.
function serializeEnv(vars) {
  const lines = ['# Written by the GuestFlow console (specs/hosting-h1-fleet-runtime.md) — edits are overwritten.'];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined || v === null) continue;
    lines.push(`${k}="${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  }
  return `${lines.join('\n')}\n`;
}

function readEnv(dir) {
  try {
    return parseEnv(fs.readFileSync(path.join(dir, ENV_FILE), 'utf8'));
  } catch {
    return null;
  }
}

function writeEnv(dir, vars) {
  const file = path.join(dir, ENV_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, serializeEnv(vars), { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
  return file;
}

const newSecrets = () => ({
  GUESTFLOW_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
  GUESTFLOW_SESSION_SECRET: crypto.randomBytes(32).toString('base64'),
});

function secretsOf(env) {
  if (!env) return null;
  return SECRET_KEYS.every((k) => env[k]) ? Object.fromEntries(SECRET_KEYS.map((k) => [k, env[k]])) : null;
}

/**
 * The variables of one instance. `inst` = { slug, dir, port, version }; `releasesDir` the shared
 * releases; `extra` the drivers' own variables (proxy: trust and TLS; mail: the platform sender).
 */
function buildEnv({ inst, releasesDir, secrets, licencePublicKey, extra = {} }) {
  const data = path.join(inst.dir, 'data');
  return {
    NODE_ENV: 'production',
    PORT: inst.port || undefined,
    GUESTFLOW_VERSION: inst.version || undefined,
    GUESTFLOW_RELEASE_DIR: inst.version ? path.join(releasesDir, inst.version) : undefined,
    GUESTFLOW_MANAGED: '1',
    GUESTFLOW_SLUG: inst.slug,
    GUESTFLOW_SELF_UPDATE: 'off',
    DB_PATH: path.join(data, 'guestflow.db'),
    GUESTFLOW_UPLOADS_DIR: path.join(inst.dir, 'uploads'),
    GUESTFLOW_LOCAL_ENV: path.join(data, 'local.env'),
    GUESTFLOW_LICENCE_PUBLIC_KEY: licencePublicKey || undefined,
    TZ: 'Europe/Paris',
    ...(secrets || {}),
    ...extra,
  };
}

module.exports = { ENV_FILE, SECRET_KEYS, parseEnv, serializeEnv, readEnv, writeEnv, newSecrets, secretsOf, buildEnv };
