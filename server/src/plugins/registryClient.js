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
const { validateManifest, normalizeManifest } = require('./manifest');
const { isAllowedRegistryUrl } = require('./packageStore');

const POLL_MS = 6 * 60 * 60 * 1000;
const MAX_INDEX_BYTES = 2 * 1024 * 1024;

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

function createRegistryClient({ url, publicKey, fetchImpl = fetch, now = () => new Date(), log = console } = {}) {
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
    const text = await res.text();
    if (text.length > MAX_INDEX_BYTES) throw new Error('index too large');
    return text;
  }

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
    try {
      plugins = parseIndex(text);
    } catch (err) {
      state = 'invalid';
      plugins = {};
      log.error(`[plugins] registry index unreadable: ${err.message}`);
      return status();
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
