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
const RETRY_MS = 2 * 1000;
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

const frDay = (day) => (day ? `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : '');

function bannerText(state, { endDay = null, daysLeft = null, planName = null } = {}) {
  switch (state) {
    case 'trial':
      if (daysLeft !== null && daysLeft > 1) return { severity: 'info', text: `Période d’essai : ${daysLeft} jours restants.` };
      if (daysLeft === 1 || daysLeft === 0) return { severity: 'info', text: 'Dernier jour de la période d’essai.' };
      return { severity: 'info', text: 'Période d’essai.' };
    case 'due':
      return { severity: 'info', text: `Abonnement${planName ? ` ${planName}` : ''} jusqu’au ${frDay(endDay)}.` };
    case 'grace':
      return { severity: 'warning', text: `Abonnement échu depuis le ${frDay(endDay)} : à renouveler pour garder l’accès complet.` };
    case 'read_only':
    case 'suspended':
    case 'archived':
      return { severity: 'error', text: 'Lecture seule : données consultables et exportables, calendriers toujours synchronisés.' };
    default:
      return { severity: null, text: null };
  }
}

function createLicenceReader({
  dataDir,
  publicKey,
  managed = false,
  slug = null,
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
    } catch (err) {
      // Rule 29: only an absent file is « no licence ». One that is there but unreadable is enforced.
      if (err && err.code && err.code !== 'ENOENT') return { enforced: true, valid: false, reason: `unreadable (${err.code})` };
      return managed ? { enforced: true, valid: false, reason: 'missing' } : { enforced: false };
    }
    if (!keyObject) return { enforced: true, valid: false, reason: 'no verification key' };
    let payload;
    try {
      payload = verifyJws(token, keyObject);
    } catch (err) {
      return { enforced: true, valid: false, reason: err.message };
    }
    if (slug && payload.slug !== slug) return { enforced: true, valid: false, reason: `issued for another instance (${payload.slug})` };
    // Fail closed: a date that cannot be read is no bound at all.
    const expiresAt = Date.parse(payload.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= now().getTime()) {
      return { enforced: true, valid: false, reason: 'expired', expired: payload };
    }
    if (!STATES.includes(payload.state)) return { enforced: true, valid: false, reason: 'unknown state' };
    return { enforced: true, valid: true, payload };
  }

  // A file that does not verify may be half written: it is read again within seconds, not a minute.
  const cacheMs = (lic) => (lic.enforced && !lic.valid && !lic.expired && lic.reason !== 'missing' ? RETRY_MS : CACHE_MS);

  function current() {
    const t = now().getTime();
    if (cached && t - cachedAt < cacheMs(cached)) return cached;
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

  // The plugins of the licence in force — or, once it has expired, of that same signed licence: a
  // plugin withdrawn from the plan never comes back because the console stopped re-issuing. Only a
  // licence that cannot be read at all keeps the stored states (the read-only guard stops every
  // write, and hiding screens would only make the instance harder to diagnose).
  const pluginSource = (lic) => (lic.valid ? lic.payload : lic.expired || null);

  function allowsPlugin(id) {
    const lic = current();
    if (!lic.enforced) return true;
    const source = pluginSource(lic);
    if (!source) return true;
    return Array.isArray(source.plugins) && source.plugins.includes(id);
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
      const source = lic.enforced ? pluginSource(lic) : null;
      if (!source || !source.planOf) return null;
      return source.planOf[id] || null;
    },
    // The banner as the admin reads it: `text` and `severity` are decided here, null when nothing
    // is shown (nothing enforced, or active).
    banner() {
      const lic = current();
      if (!lic.enforced) return { state: null, text: null };
      if (!lic.valid) return { state: 'read_only', endsAt: null, daysLeft: null, planName: null, payUrl: null, ...bannerText('read_only') };
      const { state, endsAt, planName, plan, payUrl } = lic.payload;
      // A date-time is read as its Paris day, not its UTC one.
      const endDay = endsAt ? (String(endsAt).length > 10 ? parisDay(new Date(endsAt)) : String(endsAt)) : null;
      const daysLeft = endDay ? daysBetween(parisDay(now()), endDay) : null;
      const name = planName || plan || null;
      return { state, endsAt: endDay, daysLeft, planName: name, payUrl: payUrl || null, ...bannerText(state, { endDay, daysLeft, planName: name }) };
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
      slug: process.env.GUESTFLOW_SLUG || null,
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
