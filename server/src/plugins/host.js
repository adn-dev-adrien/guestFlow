/**
 * The running instance's plugin packages, as one object the boot, the controller and the asset
 * route share (specs/plugins-phase-4-registry.md rules 9–19).
 *
 *   mode            `packages` (a release: every plugin from its package, P27) or `sources`
 *                   (development and unit suites: the folders of server/src/plugins, rule 19)
 *   store           packageStore — the archive's packages, the registry's, `ctx.dataDir`
 *   registryClient  the signed index, read at boot, every 6 hours and on demand (rule 9)
 *   incompatible    the installed packages left unloaded at boot (rule 14)
 *   loaded          id → version actually running in this process
 *   assetKeys       id → `<version>-<hash12>`, the cache key of its client files (rule 27)
 *
 * `boot()` runs before the plugin modules register; `startBackground()` after the server listens.
 */

const path = require('path');
const { createPackageStore, resolveDistDir, resolveMode } = require('./packageStore');
const { fromEnv } = require('./registryClient');
const { POLL_MS } = require('./registryClient');

const state = {
  mode: 'sources',
  store: null,
  registryClient: null,
  incompatible: {},
  loaded: {},
  assetKeys: {},
  restart: null,
  updating: false,
};

function init({ env = process.env, dataDir, store, registryClient, restart } = {}) {
  const distDir = resolveDistDir(env);
  state.mode = resolveMode(env, distDir);
  state.store = store || createPackageStore({
    dataDir: dataDir || require('../utils/deploymentPaths').resolvePaths(env).dataDir,
    distDir,
  });
  state.registryClient = registryClient || fromEnv(env, { stateFile: path.join(state.store.packagesDir, 'registry-state.json') });
  state.restart = restart || require('../utils/processRestart').createRestarter({ env });
  hostExportsCache = undefined;
  state.incompatible = {};
  state.loaded = {};
  state.assetKeys = {};
  state.updating = false;
  return state;
}

// Before `boot()` (unit suites requiring the controller) the host is the development one: a stray
// `plugins-dist/` built in a checkout never turns a test into a release.
const ensure = () => { if (!state.store) init({ env: { ...process.env, GUESTFLOW_PLUGINS: process.env.GUESTFLOW_PLUGINS || 'sources' } }); return state; };

/**
 * Rule 33 — the names this release's app gives the plugin bundles (`plugins-dist/hostModules.json`,
 * copied by the package build). Null in a development tree: its client imports the sources.
 */
let hostExportsCache;
function hostExports() {
  const s = ensure();
  if (s.mode !== 'packages') return null;
  if (hostExportsCache === undefined) {
    try {
      hostExportsCache = JSON.parse(require('fs').readFileSync(path.join(s.store.distDir, 'hostModules.json'), 'utf8'));
    } catch {
      hostExportsCache = null;
    }
  }
  return hostExportsCache;
}

/**
 * The manifest the running release ships for `id`: the unpacked package in `packages` mode, the
 * source folder otherwise (both are the same files at release time).
 */
function runningCopy(id) {
  const s = ensure();
  if (s.mode === 'packages') {
    const pkg = s.store.bundled()[id];
    return pkg ? { manifest: pkg.manifest, sha256: pkg.sha256 } : null;
  }
  try {
    return { manifest: require('./manifest').readSourceManifest(id), sha256: null };
  } catch {
    return null;
  }
}

const refusedSyncs = new Set();

// Rule 55 — a release never rewrites a row with a manifest that would close a dependency cycle.
function syncClosesCycle(model, id, manifest) {
  const manifests = Object.fromEntries(model.list().map((r) => [r.id, r.manifest || { id: r.id, requires: [] }]));
  manifests[id] = manifest;
  return Boolean(require('../utils/pluginGraph').createGraph({ manifests }).cycleOf(id));
}

/**
 * Rule 57 — a release whose manifest makes an ACTIVE plugin require an installed but OFF plugin switches the
 * dependant off (and its active dependants), never the requirement on: the home says so.
 */
function switchOffOverInactive(model, ids) {
  const rows = model.list();
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const graph = require('../utils/pluginGraph').createGraph({
    manifests: Object.fromEntries(rows.map((r) => [r.id, r.manifest || { id: r.id, requires: [] }])),
    states: Object.fromEntries(rows.map((r) => [r.id, r.enabled ? 'active' : 'inactive'])),
  });
  const off = new Set();
  const requiresOff = (id, isOff) => ((byId[id].manifest || {}).requires || []).find((r) => byId[r.id] && isOff(r.id));
  ids.filter((id) => byId[id] && byId[id].enabled).forEach((id) => {
    const missing = requiresOff(id, (other) => !byId[other].enabled);
    if (!missing) return;
    model.switchOff(id, missing.id);
    off.add(id);
    // Nearest dependant first (the closure lists the deepest first), so the requirement that caused each is already off.
    [...graph.activeDependantClosure(id)].reverse().filter((f) => !off.has(f)).forEach((f) => {
      const cause = requiresOff(f, (other) => off.has(other) || other === id);
      model.switchOff(f, cause ? cause.id : id);
      off.add(f);
    });
    console.error(`[plugins] ${id} switched off: ${missing.id} is installed but off`); // eslint-disable-line no-console
  });
}

/**
 * Before the modules register: `bundled` rows follow the copy this release ships, an expired
 * rollback window forgets its older copy (rule 16), and the package directories of plugins no
 * longer installed are removed. Returns the rows as they are after that.
 */
function housekeeping({ model, ids, now = new Date(), copyOf = runningCopy }) {
  const s = ensure();
  // The sync of the bundled rows and the switch-offs it calls for are ONE transaction (rule 57): a failure saves
  // nothing, so the next boot finds the same rows to sync and retries, and never leaves a dependant on over a
  // requirement that was switched off. The boot goes on either way: the plugins then stay as they were.
  try {
    model.transaction(() => {
      const synced = [];
      ids.forEach((id) => {
        const row = model.get(id);
        if (!row || row.source !== 'bundled') return;
        const copy = copyOf(id);
        if (copy && syncClosesCycle(model, id, copy.manifest)) {
          const key = `${id}@${copy.manifest.version}`;
          if (!refusedSyncs.has(key)) { // once per release, not at every hourly pass
            refusedSyncs.add(key);
            console.error(`[plugins] ${key} not synced: REQUIREMENT_CYCLE`); // eslint-disable-line no-console
          }
        } else if (copy && model.syncBundled(id, copy.manifest, copy.sha256)) synced.push(id);
      });
      switchOffOverInactive(model, synced);
    });
  } catch (err) {
    console.error('[plugins] syncing the bundled rows failed, nothing was saved:', err.message); // eslint-disable-line no-console
  }
  ids.forEach((id) => {
    const row = model.get(id);
    if (row && row.rollbackUntil && Date.parse(row.rollbackUntil) <= now.getTime()) model.expireRollback(id);
    if (s.mode !== 'packages') return;
    const fresh = model.get(id);
    const keep = [];
    if (fresh && fresh.source === 'registry') keep.push(fresh.version);
    if (fresh && fresh.previousSource === 'registry' && fresh.previousVersion) keep.push(fresh.previousVersion);
    s.store.prune(id, keep);
    if (fresh && fresh.source === 'registry' && s.store.readCurrent(id) !== fresh.version) {
      try { s.store.setCurrent(id, fresh.version); } catch { /* the loader reports the package missing */ }
    }
  });
  return model.list();
}

// Rule 27 — the URL of a package's client files carries its content hash (the package manifest's
// `contentHash`, second review m5), so a file served immutable is never one of another build.
const assetKey = (version, contentHash) => `${version}-${String(contentHash || 'nohash').slice(0, 12)}`;

function setLoaded(id, version, contentHash) {
  const s = ensure();
  s.loaded[id] = version;
  s.assetKeys[id] = assetKey(version, contentHash);
}

// Rule 29 — a requirement whose install was undone is no longer offered to the browser.
function unsetLoaded(id) {
  const s = ensure();
  delete s.loaded[id];
  delete s.assetKeys[id];
}

/** Rule 18 — the client bundles the browser imports before rendering: every loaded package. */
function clientEntries() {
  const s = ensure();
  if (s.mode !== 'packages') return [];
  return Object.entries(s.loaded).map(([id, version]) => ({
    id,
    version,
    url: `/plugin-assets/${encodeURIComponent(id)}/${encodeURIComponent(s.assetKeys[id])}/index.js`,
  }));
}

/** Rules 18, 27 — `/plugin-assets/<id>/<version>-<hash>/…`, immutable: that key's files never change. */
function assetsMiddleware(express) {
  return (req, res, next) => {
    const s = ensure();
    const { id, key } = req.params;
    if (s.mode !== 'packages' || !s.assetKeys[id] || s.assetKeys[id] !== key) return res.status(404).type('text').send('Introuvable.');
    const dir = s.store.clientDirFor(id, s.loaded[id]);
    if (!dir) return res.status(404).type('text').send('Introuvable.');
    return express.static(dir, { immutable: true, maxAge: '365d', fallthrough: false, index: false })(req, res, next);
  };
}

/**
 * The boot of the plugin modules (rules 14, 17, 19). `sources`: every module of the source list
 * registers, as before phase 4. `packages`: only the installed packages that still match the core
 * load, each from its directory; the others are reported incompatible.
 */
function boot({ db, loader, registry, model, catalogue }) {
  const s = init();
  const ids = catalogue.map((p) => p.id);
  const rows = housekeeping({ model, ids });
  // specs/plugin-removal-resilience.md rule 1 — an installed plugin whose code is gone from this
  // release (it left the catalogue) is still reported, and can be uninstalled.
  const order = [...ids, ...rows.map((r) => r.id).filter((id) => !ids.includes(id))];
  const missing = { code: 'PACKAGE_MISSING', message: 'Paquet introuvable : à réinstaller.' };
  if (s.mode !== 'packages') {
    loader.registerAll({ db, dataDir: (id) => s.store.dataDirPath(id) });
    rows.filter((r) => !registry.has(r.id)).forEach((r) => { s.incompatible[r.id] = missing; });
    return;
  }
  const { getAppVersion } = require('../utils/appVersion');
  const { SDK_VERSION } = require('./sdk/version');
  const nameOf = (id) => (catalogue.find((p) => p.id === id) || {}).name || id;
  const { modules, incompatible, manifests } = loader.loadPackages({
    store: s.store, rows, order, env: { coreVersion: getAppVersion(), sdkVersion: SDK_VERSION, hostExports: hostExports() }, nameOf,
  });
  s.incompatible = incompatible;
  Object.values(manifests).forEach((m) => setLoaded(m.id, m.version, m.contentHash));
  Object.entries(incompatible).forEach(([id, why]) => console.error(`[plugin:${id}] not loaded — ${why.message}`)); // eslint-disable-line no-console
  loader.registerAll({ db, modules, dataDir: (id) => s.store.dataDirPath(id) });
}

/**
 * specs/hosting-h1-fleet-runtime.md rule 11 — whether a plugin pushed by the console came up: the
 * version this process loaded, and `ok` false when it was left out or its `register` threw.
 */
function pluginHealth(id, registry = require('./sdk/registry')) {
  const s = ensure();
  const record = registry.get ? registry.get(id) : null;
  const version = s.loaded[id] || null;
  return { id, version, ok: Boolean(version) && !s.incompatible[id] && !(record && record.failed) };
}

function startBackground({ model, ids, setIntervalFn = setInterval } = {}) {
  const s = ensure();
  if (s.mode !== 'packages') return;
  s.registryClient.start();
  const timer = setIntervalFn(() => {
    try { housekeeping({ model, ids }); } catch (err) { console.error('[plugins] housekeeping failed:', err.message); } // eslint-disable-line no-console
  }, POLL_MS);
  if (timer && timer.unref) timer.unref();
}

module.exports = {
  init,
  state: () => ensure(),
  mode: () => ensure().mode,
  store: () => ensure().store,
  registryClient: () => ensure().registryClient,
  runningCopy,
  hostExports,
  housekeeping,
  clientEntries,
  assetsMiddleware,
  boot,
  startBackground,
  setIncompatible(map) { ensure().incompatible = { ...map }; },
  setLoaded,
  unsetLoaded,
  pluginHealth,
  dataDirOf: (id) => path.join(ensure().store.dataDirPath(id)),
};
