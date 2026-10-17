/**
 * Where plugin packages live on disk (specs/plugins-phase-4-registry.md rules 1, 10–11, 15–17).
 *
 *   <release>/plugins-dist/                   the packages the release archive ships (P24, rule 10)
 *     SHA256SUMS                              one line per `<id>-<version>.tgz`
 *     <id>-<version>.tgz                      the package itself, attached to the GitHub release
 *     <id>/{manifest.json,server/,client/}    the same package, unpacked — what a `bundled` row runs
 *   <data>/plugins/<id>/<version>/            a package installed from the registry (rule 11)
 *   <data>/plugins/<id>/current -> <version>  its pointer, switched last
 *   <data>/plugin-data/<id>/                  the plugin's own files, `ctx.dataDir` (rule 15)
 *
 * A download is verified before anything moves: size, then SHA-256 against the signed index, then
 * the archive's members (no link, no absolute path, no `..`, nothing outside manifest.json, server/
 * and client/), then the manifest itself. Any failure leaves the running version untouched.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { parseManifest } = require('./manifest');

const execFileAsync = promisify(execFile);

const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;
const ROOT_ENTRIES = new Set(['manifest.json', 'server', 'client']);
const SERVER_ROOT = path.resolve(__dirname, '..', '..');

/** Thrown with a code the controller turns into a French refusal (rule 22). */
class PackageError extends Error {
  constructor(code, detail) {
    super(`${code}${detail ? `:${detail}` : ''}`);
    this.code = code;
  }
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** `<sha>  <file>` lines → { file: sha }. Bare names only, like the release's own SHA256SUMS. */
function parseSums(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const m = line.trim().match(/^([a-f0-9]{64})\s+\*?(\S+)$/i);
    if (m) out[path.basename(m[2])] = m[1].toLowerCase();
  }
  return out;
}

/**
 * The member checks of a package archive (rule 1). `names` is `tar -tzf`, `verbose` is `tar -tvzf`
 * (only its first column is read: GNU tar and bsdtar agree on it). Pure, for the unit suite.
 */
function assertPackageMembers({ names, verbose }) {
  for (const line of String(verbose || '').split('\n')) {
    const t = line.trim();
    if (t && (t[0] === 'l' || t[0] === 'h')) throw new PackageError('PACKAGE_REJECTED', `link member ${t}`);
  }
  const list = String(names || '').split('\n').map((l) => l.trim().replace(/^\.\//, '')).filter((l) => l && l !== '.' && l !== './');
  if (!list.length) throw new PackageError('PACKAGE_REJECTED', 'empty archive');
  for (const name of list) {
    if (name.startsWith('/') || name.startsWith('~') || name.split('/').includes('..')) {
      throw new PackageError('PACKAGE_REJECTED', `unsafe member ${name}`);
    }
    if (!ROOT_ENTRIES.has(name.split('/')[0])) throw new PackageError('PACKAGE_REJECTED', `unexpected member ${name}`);
  }
  if (!list.includes('manifest.json')) throw new PackageError('PACKAGE_REJECTED', 'no manifest.json');
  return list;
}

/** The unpacked tree must be the package it claims to be (rules 1–2). Returns its manifest. */
function assertPackageLayout(dir, { id, version } = {}) {
  let manifest;
  try {
    manifest = parseManifest(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  } catch (err) {
    throw new PackageError('PACKAGE_REJECTED', err.message);
  }
  if (id && manifest.id !== id) throw new PackageError('PACKAGE_REJECTED', `manifest names ${manifest.id}`);
  if (version && manifest.version !== version) throw new PackageError('PACKAGE_REJECTED', `manifest says ${manifest.version}`);
  if (!fs.existsSync(path.join(dir, 'server', 'index.js'))) throw new PackageError('PACKAGE_REJECTED', 'no server/index.js');
  if (!fs.existsSync(path.join(dir, 'client', 'index.js'))) throw new PackageError('PACKAGE_REJECTED', 'no client/index.js');
  return manifest;
}

async function extractPackage(file, destDir) {
  const options = { maxBuffer: 32 * 1024 * 1024 };
  const [{ stdout: names }, { stdout: verbose }] = await Promise.all([
    execFileAsync('tar', ['-tzf', file], options),
    execFileAsync('tar', ['-tvzf', file], options),
  ]);
  assertPackageMembers({ names, verbose });
  fs.mkdirSync(destDir, { recursive: true });
  await execFileAsync('tar', ['-xzf', file, '-C', destDir, '--no-same-owner'], options);
}

/** Only https, except a loopback registry (the E2E suite and a development machine). */
function isAllowedRegistryUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol === 'https:') return true;
  return parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
}

/**
 * The body of `res`, refused as soon as it goes beyond `maxBytes` (review minor 5): the declared
 * length first, then the bytes as they stream — never the whole body first and the limit after.
 */
async function readLimited(res, maxBytes) {
  const declared = Number(res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-length') : 0);
  if (declared && declared > maxBytes) throw new Error(`too large (${declared} bytes)`);
  if (!res.body || typeof res.body.getReader !== 'function') {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error(`too large (${buf.length} bytes)`);
    return buf;
  }
  const reader = res.body.getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read(); // eslint-disable-line no-await-in-loop
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`too large (over ${maxBytes} bytes)`);
    }
    parts.push(Buffer.from(value));
  }
  return Buffer.concat(parts);
}

async function download(url, { fetchImpl = fetch, maxBytes = MAX_PACKAGE_BYTES, timeoutMs = 60_000 } = {}) {
  if (!isAllowedRegistryUrl(url)) throw new PackageError('DOWNLOAD_FAILED', 'forbidden url');
  let res;
  try {
    res = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new PackageError('DOWNLOAD_FAILED', err.message);
  }
  if (!res.ok) throw new PackageError('DOWNLOAD_FAILED', `HTTP ${res.status}`);
  try {
    return await readLimited(res, maxBytes);
  } catch (err) {
    throw new PackageError(/too large/.test(err.message) ? 'PACKAGE_REJECTED' : 'DOWNLOAD_FAILED', err.message);
  }
}

/**
 * @param {object} opts
 * @param {string} opts.dataDir   the instance's data directory (deploymentPaths.resolvePaths().dataDir)
 * @param {string} opts.distDir   the release's `plugins-dist/`
 */
function createPackageStore({ dataDir, distDir, fetchImpl = fetch, now = () => new Date() } = {}) {
  const packagesDir = path.join(dataDir, 'plugins');
  const pluginDataRoot = path.join(dataDir, 'plugin-data');
  const versionDir = (id, version) => path.join(packagesDir, id, version);
  let bundledCache = null;

  // The packages the running release ships (P24). Read once: a release never changes under a process.
  function bundled() {
    if (bundledCache) return bundledCache;
    const out = {};
    let sums = {};
    try { sums = parseSums(fs.readFileSync(path.join(distDir, 'SHA256SUMS'), 'utf8')); } catch { sums = {}; }
    let entries = [];
    try { entries = fs.readdirSync(distDir, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { entries = []; }
    for (const e of entries) {
      const dir = path.join(distDir, e.name);
      try {
        const manifest = assertPackageLayout(dir, { id: e.name });
        const file = `${manifest.id}-${manifest.version}.tgz`;
        out[manifest.id] = { manifest, dir, file, sha256: sums[file] || null };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[plugins] ignoring ${dir}: ${err.message}`);
      }
    }
    bundledCache = out;
    return out;
  }

  /** The directory a row runs from, or null when its files are missing. */
  function packageDirFor(id, row) {
    if (!row) return null;
    if (row.source === 'registry') {
      const dir = versionDir(id, row.version);
      return fs.existsSync(path.join(dir, 'manifest.json')) ? dir : null;
    }
    const pkg = bundled()[id];
    return pkg ? pkg.dir : null;
  }

  /** The `client/` directory serving `/plugin-assets/<id>/<version>/` (rule 18), or null. */
  function clientDirFor(id, version) {
    const pkg = bundled()[id];
    if (pkg && pkg.manifest.version === version) return path.join(pkg.dir, 'client');
    const dir = path.join(versionDir(id, version), 'client');
    return fs.existsSync(dir) ? dir : null;
  }

  // Switches `<id>/current` to `version` atomically (temp link + rename).
  function setCurrent(id, version) {
    const link = path.join(packagesDir, id, 'current');
    const tmp = `${link}.${process.pid}.tmp`;
    fs.rmSync(tmp, { force: true });
    fs.symlinkSync(version, tmp);
    fs.renameSync(tmp, link);
  }

  function clearCurrent(id) {
    fs.rmSync(path.join(packagesDir, id, 'current'), { force: true });
  }

  function readCurrent(id) {
    try { return fs.readlinkSync(path.join(packagesDir, id, 'current')); } catch { return null; }
  }

  /**
   * Download, verify and unpack `<id>@<version>` (rule 11). Leaves `current` and the running
   * version alone: the caller switches once the row is ready. → { manifest, dir, sha256 }
   */
  async function fetchFromRegistry({ id, version, sha256: expected, size, url }) {
    const buf = await download(url, { fetchImpl });
    if (size && buf.length !== size) throw new PackageError('PACKAGE_REJECTED', `size ${buf.length} ≠ ${size}`);
    const actual = sha256(buf);
    if (!expected || actual !== String(expected).toLowerCase()) throw new PackageError('PACKAGE_REJECTED', `sha256 ${actual}`);
    return unpack({ id, version, buf, sha: actual });
  }

  async function unpack({ id, version, buf, sha }) {
    const tmpRoot = path.join(packagesDir, '.tmp');
    fs.mkdirSync(tmpRoot, { recursive: true });
    const stamp = `${id}-${version}-${process.pid}-${Date.now()}`;
    const file = path.join(tmpRoot, `${stamp}.tgz`);
    const staging = path.join(tmpRoot, stamp);
    fs.writeFileSync(file, buf);
    try {
      await extractPackage(file, staging);
      const manifest = assertPackageLayout(staging, { id, version });
      const dest = versionDir(id, version);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      // The same version installed again (a reinstall) replaces its directory as a whole.
      const old = `${dest}.old-${process.pid}`;
      if (fs.existsSync(dest)) fs.renameSync(dest, old);
      fs.renameSync(staging, dest);
      fs.rmSync(old, { recursive: true, force: true });
      return { manifest, dir: dest, sha256: sha };
    } catch (err) {
      if (err instanceof PackageError) throw err;
      throw new PackageError('PACKAGE_REJECTED', err.message);
    } finally {
      fs.rmSync(file, { force: true });
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }

  /** Rule 16: keep `keep` (the running version and, inside its window, the previous one). */
  function prune(id, keep) {
    const dir = path.join(packagesDir, id);
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { return []; }
    const removed = [];
    for (const name of entries) {
      if (name === 'current' || keep.includes(name)) continue;
      fs.rmSync(path.join(dir, name), { recursive: true, force: true });
      removed.push(name);
    }
    if (!keep.length) fs.rmSync(dir, { recursive: true, force: true });
    return removed;
  }

  /** Rule 15: the plugin's own directory, created on first use. */
  function dataDirFor(id) {
    const dir = path.join(pluginDataRoot, id);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function eraseData(id) {
    fs.rmSync(path.join(pluginDataRoot, id), { recursive: true, force: true });
  }

  return {
    packagesDir,
    distDir,
    bundled,
    packageDirFor,
    clientDirFor,
    setCurrent,
    clearCurrent,
    readCurrent,
    fetchFromRegistry,
    prune,
    dataDirFor,
    dataDirPath: (id) => path.join(pluginDataRoot, id),
    eraseData,
    now,
  };
}

/** The `plugins-dist/` of the running release: next to `server/`, or GUESTFLOW_PLUGINS_DIST. */
function resolveDistDir(env = process.env) {
  return env.GUESTFLOW_PLUGINS_DIST ? path.resolve(env.GUESTFLOW_PLUGINS_DIST) : path.join(SERVER_ROOT, '..', 'plugins-dist');
}

/**
 * Rule 19 / P27 — `packages` loads every plugin from a package directory, `sources` imports the
 * folders of `server/src/plugins/` (development, unit suites). GUESTFLOW_PLUGINS decides; without it,
 * a process that finds its release's `plugins-dist/` runs packages — whatever NODE_ENV says, because
 * a release's client build carries no plugin code. `npm run dev` and the dev E2E suite set `sources`.
 */
function resolveMode(env = process.env, distDir = resolveDistDir(env)) {
  if (env.GUESTFLOW_PLUGINS === 'packages' || env.GUESTFLOW_PLUGINS === 'sources') return env.GUESTFLOW_PLUGINS;
  return fs.existsSync(path.join(distDir, 'SHA256SUMS')) ? 'packages' : 'sources';
}

module.exports = {
  createPackageStore,
  PackageError,
  parseSums,
  assertPackageMembers,
  assertPackageLayout,
  extractPackage,
  isAllowedRegistryUrl,
  readLimited,
  resolveDistDir,
  resolveMode,
  sha256,
  MAX_PACKAGE_BYTES,
};
