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
  state.registryClient = registryClient || fromEnv(env);
  state.restart = restart || require('../utils/processRestart').createRestarter({ env });
  state.incompatible = {};
  state.loaded = {};
  state.updating = false;
  return state;
}

// Before `boot()` (unit suites requiring the controller) the host is the development one: a stray
// `plugins-dist/` built in a checkout never turns a test into a release.
const ensure = () => { if (!state.store) init({ env: { ...process.env, GUESTFLOW_PLUGINS: process.env.GUESTFLOW_PLUGINS || 'sources' } }); return state; };

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

/**
 * Before the modules register: `bundled` rows follow the copy this release ships, an expired
 * rollback window forgets its older copy (rule 16), and the package directories of plugins no
 * longer installed are removed. Returns the rows as they are after that.
 */
function housekeeping({ model, ids, now = new Date() }) {
  const s = ensure();
  ids.forEach((id) => {
    const row = model.get(id);
    if (row && row.source === 'bundled') {
      const copy = runningCopy(id);
      if (copy) model.syncBundled(id, copy.manifest, copy.sha256);
    }
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

/** Rule 18 — the client bundles the browser imports before rendering: every loaded package. */
function clientEntries() {
  const s = ensure();
  if (s.mode !== 'packages') return [];
  return Object.entries(s.loaded).map(([id, version]) => ({
    id,
    version,
    url: `/plugin-assets/${encodeURIComponent(id)}/${encodeURIComponent(version)}/index.js`,
  }));
}

/** Rule 18 — `/plugin-assets/<id>/<version>/…`, immutable: a version's files never change. */
function assetsMiddleware(express) {
  return (req, res, next) => {
    const s = ensure();
    const { id, version } = req.params;
    if (s.mode !== 'packages' || s.loaded[id] !== version) return res.status(404).type('text').send('Introuvable.');
    const dir = s.store.clientDirFor(id, version);
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
  if (s.mode !== 'packages') {
    loader.registerAll({ db, dataDir: (id) => s.store.dataDirPath(id) });
    return;
  }
  registry.configure({ requireRecord: true });
  const { getAppVersion } = require('../utils/appVersion');
  const { SDK_VERSION } = require('./sdk/version');
  const nameOf = (id) => (catalogue.find((p) => p.id === id) || {}).name || id;
  const { modules, incompatible, manifests } = loader.loadPackages({
    store: s.store, rows, order: ids, env: { coreVersion: getAppVersion(), sdkVersion: SDK_VERSION }, nameOf,
  });
  s.incompatible = incompatible;
  Object.values(manifests).forEach((m) => { s.loaded[m.id] = m.version; });
  Object.entries(incompatible).forEach(([id, why]) => console.error(`[plugin:${id}] not loaded — ${why.message}`)); // eslint-disable-line no-console
  loader.registerAll({ db, modules, dataDir: (id) => s.store.dataDirPath(id) });
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
  housekeeping,
  clientEntries,
  assetsMiddleware,
  boot,
  startBackground,
  setIncompatible(map) { ensure().incompatible = { ...map }; },
  setLoaded(id, version) { ensure().loaded[id] = version; },
  dataDirOf: (id) => path.join(ensure().store.dataDirPath(id)),
};
