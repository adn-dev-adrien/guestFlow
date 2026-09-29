/**
 * The instance's licence (specs/control-plane-plans-and-access.md §3.C, rules 9–16, 29–30).
 *
 * The control plane writes `<dataDir>/licence.jws`, a compact JWS signed with Ed25519, carrying the
 * plan, the allowed plugins, the quotas and the subscription state. The instance only reads it: no
 * port is opened for it. It is re-read at most once a minute.
 *
 * Enforcement is off on an unmanaged install with no licence file (rule 29): Solio on its own host,
 * dev machines, the E2E server. A managed install (`GUESTFLOW_MANAGED=1`) with a missing, forged or
 * expired licence falls back to read-only, never to suspended (rule 10). The verification key comes
 * from `GUESTFLOW_LICENCE_PUBLIC_KEY` (base64 DER SPKI), set by the operator (rule 30).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FILE_NAME = 'licence.jws';
const CACHE_MS = 60 * 1000;
const STATES = ['trial', 'active', 'due', 'grace', 'read_only', 'suspended', 'archived'];
const READ_ONLY_STATES = new Set(['read_only', 'suspended', 'archived']);

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function parisDay(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(date);
}

function daysBetween(fromDay, toDay) {
  return Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86400000);
}

function toKeyObject(publicKey) {
  if (!publicKey) return null;
  if (typeof publicKey === 'object') return publicKey;
  try {
    return crypto.createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
  } catch {
    return null;
  }
}

// Returns the payload, or throws with a short reason.
function verifyJws(token, keyObject) {
  const parts = String(token).trim().split('.');
  if (parts.length !== 3) throw new Error('malformed');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  if (header.alg !== 'EdDSA') throw new Error('unsupported alg');
  const ok = crypto.verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), keyObject, Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new Error('bad signature');
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

// Test and tooling helper: the control plane's side of the contract.
function signLicence(payload, privateKey) {
  const head = b64url(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.sign(null, Buffer.from(`${head}.${body}`), privateKey);
  return `${head}.${body}.${b64url(sig)}`;
}

function createLicenceReader({
  dataDir,
  publicKey,
  managed = false,
  now = () => new Date(),
  readFile = (file) => fs.readFileSync(file, 'utf8'),
  log = (msg) => console.error(msg),
} = {}) {
  const file = path.join(dataDir || '.', FILE_NAME);
  const keyObject = toKeyObject(publicKey);
  let cached = null;
  let cachedAt = 0;
  let lastReason = null;

  function load() {
    let token;
    try {
      token = readFile(file);
    } catch {
      return managed ? { enforced: true, valid: false, reason: 'missing' } : { enforced: false };
    }
    if (!keyObject) return { enforced: true, valid: false, reason: 'no verification key' };
    let payload;
    try {
      payload = verifyJws(token, keyObject);
    } catch (err) {
      return { enforced: true, valid: false, reason: err.message };
    }
    if (!payload.expiresAt || Date.parse(payload.expiresAt) <= now().getTime()) {
      return { enforced: true, valid: false, reason: 'expired' };
    }
    if (!STATES.includes(payload.state)) return { enforced: true, valid: false, reason: 'unknown state' };
    return { enforced: true, valid: true, payload };
  }

  function current() {
    const t = now().getTime();
    if (cached && t - cachedAt < CACHE_MS) return cached;
    cached = load();
    cachedAt = t;
    const reason = cached.enforced && !cached.valid ? cached.reason : null;
    if (reason && reason !== lastReason) log(`[licence] ${reason} — the instance is read-only (${file})`);
    lastReason = reason;
    return cached;
  }

  function effectiveState() {
    const lic = current();
    if (!lic.enforced) return null;
    return lic.valid ? lic.payload.state : 'read_only';
  }

  // An invalid licence keeps the plugins the stored states allow: the read-only guard already stops
  // every write, and hiding screens would only make the instance harder to diagnose.
  function allowsPlugin(id) {
    const lic = current();
    if (!lic.enforced || !lic.valid) return true;
    return Array.isArray(lic.payload.plugins) && lic.payload.plugins.includes(id);
  }

  return {
    current,
    effectiveState,
    isReadOnly: () => READ_ONLY_STATES.has(effectiveState()),
    allowsPlugin,
    planName: () => {
      const lic = current();
      return lic.enforced && lic.valid ? lic.payload.planName || lic.payload.plan : null;
    },
    // null = unlimited (or nothing enforced).
    quota(name) {
      const lic = current();
      if (!lic.enforced || !lic.valid) return null;
      const value = lic.payload.quotas && lic.payload.quotas[name];
      return Number.isInteger(value) ? value : null;
    },
    // The name of the lowest plan that includes the plugin; null when it is sold à la carte only.
    planFor(id) {
      const lic = current();
      if (!lic.enforced || !lic.valid || !lic.payload.planOf) return null;
      return lic.payload.planOf[id] || null;
    },
    banner() {
      const lic = current();
      if (!lic.enforced) return { state: null };
      if (!lic.valid) return { state: 'read_only', endsAt: null, daysLeft: null, planName: null, payUrl: null };
      const { state, endsAt, planName, plan, payUrl } = lic.payload;
      const daysLeft = endsAt ? daysBetween(parisDay(now()), String(endsAt).slice(0, 10)) : null;
      return { state, endsAt: endsAt || null, daysLeft, planName: planName || plan || null, payUrl: payUrl || null };
    },
    invalidate() { cached = null; },
  };
}

let defaultReader = null;
function defaults() {
  if (!defaultReader) {
    const { resolvePaths } = require('./deploymentPaths');
    defaultReader = createLicenceReader({
      dataDir: resolvePaths().dataDir,
      publicKey: process.env.GUESTFLOW_LICENCE_PUBLIC_KEY,
      managed: process.env.GUESTFLOW_MANAGED === '1',
    });
  }
  return defaultReader;
}

module.exports = {
  FILE_NAME,
  createLicenceReader,
  signLicence,
  verifyJws,
  parisDay,
  get default() { return defaults(); },
  allowsPlugin: (id) => defaults().allowsPlugin(id),
  isReadOnly: () => defaults().isReadOnly(),
};
