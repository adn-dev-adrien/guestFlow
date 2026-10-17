/**
 * The official plugin registry, read by the instance (specs/plugins-phase-4-registry.md rules 6, 9).
 *
 *   GUESTFLOW_REGISTRY_URL          the registry's base, e.g. https://console.guestflow.fr/registry/v1
 *   GUESTFLOW_REGISTRY_PUBLIC_KEY   Ed25519, base64 DER SPKI; falls back to GUESTFLOW_LICENCE_PUBLIC_KEY
 *
 * `index.json` lists every published version with its manifest, SHA-256 and size; `index.json.sig`
 * is the base64 Ed25519 signature of those exact bytes. An index whose signature does not verify is
 * ignored entirely: the instance then offers what its release ships, as when it has no registry.
 *
 * Without a URL or a key there is no remote registry, and nothing says so (rule 9): `versions()` is
 * empty and the archive's packages are the only offer.
 */

const crypto = require('crypto');
const fs = require('fs');
const { validateManifest, normalizeManifest } = require('./manifest');
const { isAllowedRegistryUrl, readLimited } = require('./packageStore');

const POLL_MS = 6 * 60 * 60 * 1000;
const MAX_INDEX_BYTES = 2 * 1024 * 1024;
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

function toKey(publicKey) {
  if (!publicKey) return null;
  try {
    return crypto.createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
  } catch {
    return null;
  }
}

/** Sign an index the way the control plane does — tests and the E2E registry use it. */
function signIndex(bytes, privateKey) {
  return crypto.sign(null, Buffer.from(bytes), privateKey).toString('base64');
}

function verifyIndex(bytes, signature, keyObject) {
  try {
    return crypto.verify(null, Buffer.from(bytes), keyObject, Buffer.from(String(signature).trim(), 'base64'));
  } catch {
    return false;
  }
}

/**
 * The entries of a verified index that every instance can use: a valid manifest naming the same
 * id and version, a SHA-256 and a size. → { id: [{ version, sha256, size, manifest, publishedAt }] }
 */
function parseIndex(text) {
  const doc = JSON.parse(text);
  const out = {};
  const plugins = doc && typeof doc.plugins === 'object' && doc.plugins ? doc.plugins : {};
  for (const [id, versions] of Object.entries(plugins)) {
    if (!Array.isArray(versions)) continue;
    const ok = versions.filter((v) => v && v.manifest && validateManifest(v.manifest).length === 0
      && v.manifest.id === id && v.manifest.version === v.version
      && /^[a-f0-9]{64}$/.test(String(v.sha256)) && Number.isInteger(v.size) && v.size > 0);
    if (ok.length) {
      out[id] = ok.map((v) => ({
        version: v.version, sha256: v.sha256, size: v.size, manifest: normalizeManifest(v.manifest), publishedAt: v.publishedAt || null,
      }));
    }
  }
  return out;
}

/**
 * `stateFile` keeps the `generatedAt` of the last index accepted (rule 30): an older one, even
 * correctly signed — a replayed index, still offering versions withdrawn since — is refused.
 */
function createRegistryClient({ url, publicKey, fetchImpl = fetch, now = () => new Date(), log = console, stateFile = null } = {}) {
  const base = url ? String(url).replace(/\/+$/, '') : null;
  const key = toKey(publicKey);
  const configured = Boolean(base && key && isAllowedRegistryUrl(base));
  let plugins = {};
  let state = configured ? 'pending' : 'none';
  let lastOkAt = null;
  let timer = null;

  async function fetchText(target) {
    const res = await fetchImpl(target, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await readLimited(res, MAX_INDEX_BYTES)).toString('utf8');
  }

  // Keyed by registry URL and key (second review m2): changing either starts a fresh history.
  const stateKey = crypto.createHash('sha256').update(`${base}\n${publicKey || ''}`).digest('hex').slice(0, 16);
  const readState = () => {
    if (!stateFile) return {};
    try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')) || {}; } catch { return {}; }
  };
  const readLastGenerated = () => (readState()[stateKey] || {}).generatedAt || null;
  const writeLastGenerated = (generatedAt) => {
    if (!stateFile) return;
    try {
      fs.mkdirSync(require('path').dirname(stateFile), { recursive: true });
      fs.writeFileSync(stateFile, JSON.stringify({ ...readState(), [stateKey]: { generatedAt } }));
    } catch (err) {
      log.warn(`[plugins] registry state not saved: ${err.message}`);
    }
  };
  let lastGenerated = readLastGenerated();

  /** Fetch and verify the index; never throws. → status() */
  async function refresh() {
    if (!configured) return status();
    let text;
    let sig;
    try {
      [text, sig] = await Promise.all([fetchText(`${base}/index.json`), fetchText(`${base}/index.json.sig`)]);
    } catch (err) {
      state = 'unreachable';
      plugins = {};
      log.warn(`[plugins] registry unreachable: ${err.message}`);
      return status();
    }
    if (!verifyIndex(text, sig, key)) {
      state = 'invalid';
      plugins = {};
      log.error('[plugins] registry index signature does not verify — index ignored');
      return status();
    }
    let parsed;
    let generatedAt;
    try {
      parsed = parseIndex(text);
      generatedAt = JSON.parse(text).generatedAt;
      if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('no generatedAt');
    } catch (err) {
      state = 'invalid';
      plugins = {};
      log.error(`[plugins] registry index unreadable: ${err.message}`);
      return status();
    }
    // An index dated beyond tomorrow is never accepted, nor remembered: one bad date would otherwise
    // lock every later, honest index out (second review m2).
    if (Date.parse(generatedAt) > now().getTime() + FUTURE_TOLERANCE_MS) {
      state = 'invalid';
      plugins = {};
      log.error(`[plugins] registry index dated ${generatedAt}, in the future — index ignored`);
      return status();
    }
    if (lastGenerated && Date.parse(generatedAt) < Date.parse(lastGenerated)) {
      state = 'stale';
      plugins = {};
      log.error(`[plugins] registry index of ${generatedAt} is older than the one read before (${lastGenerated}) — index ignored`);
      return status();
    }
    plugins = parsed;
    if (generatedAt !== lastGenerated) {
      lastGenerated = generatedAt;
      writeLastGenerated(generatedAt);
    }
    state = 'ok';
    lastOkAt = now().toISOString();
    return status();
  }

  function status() {
    return { configured, state, lastOkAt };
  }

  return {
    configured,
    refresh,
    status,
    /** The verified versions of `id` (empty while the last read failed: rule 9 edge case). */
    versions: (id) => (state === 'ok' ? plugins[id] || [] : []),
    packageUrl: (id, version) => `${base}/packages/${encodeURIComponent(id)}-${encodeURIComponent(version)}.tgz`,
    /** At boot, then every 6 hours. */
    start({ intervalMs = POLL_MS, setIntervalFn = setInterval } = {}) {
      if (!configured || timer) return;
      refresh();
      timer = setIntervalFn(() => { refresh(); }, intervalMs);
      if (timer && timer.unref) timer.unref();
    },
  };
}

function fromEnv(env = process.env, opts = {}) {
  return createRegistryClient({
    url: env.GUESTFLOW_REGISTRY_URL,
    publicKey: env.GUESTFLOW_REGISTRY_PUBLIC_KEY || env.GUESTFLOW_LICENCE_PUBLIC_KEY,
    ...opts,
  });
}

module.exports = { createRegistryClient, fromEnv, parseIndex, verifyIndex, signIndex, POLL_MS };
