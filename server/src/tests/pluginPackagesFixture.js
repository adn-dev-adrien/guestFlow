// Shared by the plugin-package suites (specs/plugins-phase-4-registry.md): packages built on the
// fly, a release's plugins-dist, a signed registry served from memory, and the real plugins
// controller over a temporary data dir. Not a test file.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { execFileSync } = require('child_process');

process.env.GUESTFLOW_ENCRYPTION_KEY = process.env.GUESTFLOW_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const { createPackageStore } = require('../plugins/packageStore');
const { createRegistryClient, signIndex } = require('../plugins/registryClient');
const { ensurePluginsTable, ensurePluginSettingsTable } = require('../utils/pluginsSchema');
const { buildModel: buildPluginsModel } = require('../models/pluginsModel');
const { createController } = require('../controllers/pluginsController');
const registry = require('../plugins/sdk/registry');
const loader = require('../plugins/loader');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gf-phase4-'));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function manifest(id, version, extra = {}) {
  return {
    id, name: `Plugin ${id}`, version, description: 'd', icon: 'extension', surfaces: ['Une page'],
    requires: [], guestflow: '>=3.9.0', sdk: '^2.0.0', changelog: { [version]: [`Version ${version}.`] }, ...extra,
  };
}

// A package archive as the build writes it: manifest.json, server/index.js, client/index.js.
function makePackage(m, { serverCode, extraMember } = {}) {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m));
  fs.mkdirSync(path.join(dir, 'server'));
  fs.mkdirSync(path.join(dir, 'client'));
  fs.writeFileSync(path.join(dir, 'server', 'index.js'), serverCode || `module.exports = { id: '${m.id}', register() {} };`);
  fs.writeFileSync(path.join(dir, 'client', 'index.js'), `export default { id: '${m.id}', contributes: {} };`);
  const members = ['manifest.json', 'server', 'client'];
  if (extraMember) { fs.writeFileSync(path.join(dir, extraMember), 'x'); members.push(extraMember); }
  const file = path.join(dir, `${m.id}-${m.version}.tgz`);
  execFileSync('tar', ['-czf', file, '-C', dir, ...members], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  return { dir, file, buf: fs.readFileSync(file) };
}

// The release's plugins-dist: unpacked packages + SHA256SUMS.
function makeDist(manifests) {
  const dist = tmp();
  const sums = [];
  manifests.forEach((m) => {
    const pkg = makePackage(m);
    const into = path.join(dist, m.id);
    fs.mkdirSync(into);
    execFileSync('tar', ['-xzf', pkg.file, '-C', into]);
    fs.copyFileSync(pkg.file, path.join(dist, `${m.id}-${m.version}.tgz`));
    sums.push(`${sha(pkg.buf)}  ${m.id}-${m.version}.tgz`);
  });
  fs.writeFileSync(path.join(dist, 'SHA256SUMS'), `${sums.join('\n')}\n`);
  return dist;
}

const keys = () => crypto.generateKeyPairSync('ed25519');
const spki = (publicKey) => publicKey.export({ format: 'der', type: 'spki' }).toString('base64');

// A fetch serving a registry from memory: { '/index.json': text, ... }.
function fakeFetch(files, { fail = false } = {}) {
  return async (url) => {
    if (fail) throw new Error('ECONNREFUSED');
    const key = new URL(url).pathname.replace(/^\/registry\/v1/, '');
    if (!(key in files)) return { ok: false, status: 404 };
    const body = files[key];
    return {
      ok: true, status: 200,
      text: async () => String(body),
      arrayBuffer: async () => { const b = Buffer.isBuffer(body) ? body : Buffer.from(String(body)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); },
    };
  };
}

function indexOf(entries, generatedAt = '2026-10-08T10:00:00.000Z') {
  const plugins = {};
  entries.forEach(({ m, buf }) => {
    (plugins[m.id] ||= []).push({ version: m.version, sha256: sha(buf), size: buf.length, manifest: m, publishedAt: '2026-10-08T10:00:00Z' });
  });
  return JSON.stringify({ format: 1, generatedAt, plugins });
}

function freshDb() {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE migrations (name TEXT PRIMARY KEY, ran_at TEXT NOT NULL DEFAULT (datetime('now')))");
  db.exec('CREATE TABLE properties (id INTEGER PRIMARY KEY); CREATE TABLE reservations (id INTEGER PRIMARY KEY);');
  db.exec("CREATE TABLE payment_links (id INTEGER PRIMARY KEY, status TEXT); CREATE TABLE users (id INTEGER PRIMARY KEY, isActive INTEGER); CREATE TABLE user_roles (userId INTEGER, role TEXT);");
  ensurePluginsTable(db);
  ensurePluginSettingsTable(db);
  return db;
}

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

// The host of a release (packages mode) over a temporary data dir and dist.
function fakeHost({ dist, dataDir = tmp(), registryClient, supervised = true, loaded = {}, hostExports = null }) {
  const store = createPackageStore({ dataDir, distDir: dist, fetchImpl: registryClient && registryClient.fetchImpl });
  const restarts = [];
  const state = {
    mode: 'packages', store, registryClient, incompatible: {}, loaded: { ...loaded }, updating: false,
    restart: { supervised, schedule: (o) => { restarts.push(o); return supervised; } },
  };
  return {
    restarts,
    state: () => state,
    mode: () => state.mode,
    store: () => store,
    registryClient: () => registryClient,
    runningCopy: (id) => { const p = store.bundled()[id]; return p ? { manifest: p.manifest, sha256: p.sha256 } : null; },
    hostExports: () => hostExports,
    setLoaded: (id, v) => { state.loaded[id] = v; },
    unsetLoaded: (id) => { delete state.loaded[id]; },
  };
}

const allowAll = { allowsPlugin: () => true, planFor: () => null };
const fakeLoader = (calls = []) => ({
  migrate: (db, id) => { calls.push(['migrate', id]); return 0; },
  runInstallHooks: async (id) => { calls.push(['hooks', id]); },
  runActivateHooks: (id) => { calls.push(['activate', id]); },
  markInactive: () => {},
  beginInstall: () => {},
  endInstall: () => {},
  requirePackage: (id) => ({ id, register() {} }),
  registerLive: (mod) => { calls.push(['live', mod.id]); return true; },
});

function setup({ bundled = [], regEntries = [], supervised = true, installed = [], loaded = {} } = {}) {
  const db = freshDb();
  const model = buildPluginsModel(db);
  const dist = makeDist(bundled);
  const { publicKey, privateKey } = keys();
  const files = {};
  regEntries.forEach(({ m, buf }) => { files[`/packages/${m.id}-${m.version}.tgz`] = buf; });
  const index = indexOf(regEntries);
  files['/index.json'] = index;
  files['/index.json.sig'] = signIndex(index, privateKey);
  const fetchImpl = fakeFetch(files);
  const registryClient = createRegistryClient({ url: 'https://r.example/registry/v1', publicKey: spki(publicKey), fetchImpl, log: { warn() {}, error() {} } });
  registryClient.fetchImpl = fetchImpl;
  const host = fakeHost({ dist, registryClient, supervised, loaded });
  installed.forEach((row) => model.install(row.id, row));
  registry.reset();
  const calls = [];
  const ctrl = createController(model, {
    registry, host: () => host, db: () => db, loader: () => fakeLoader(calls), licence: () => allowAll,
    coreVersion: () => '3.9.0', now: () => new Date('2026-10-08T12:00:00Z'),
  });
  return { db, model, host, ctrl, calls, registryClient, files };
}

async function call(handler, { params = {}, body = {}, query = {} } = {}) {
  const res = fakeRes();
  await handler({ params, body, query }, res);
  return res;
}

// The real loader, registry and migrations ledger over a release holding `plugins` (each
// { id, version?, serverCode?, requires? }), nothing installed yet. `eraseData` can be overridden.
function realSetup(plugins, { eraseData } = {}) {
  const manifests = plugins.map((p) => manifest(p.id, p.version || '1.0.0', p.requires ? { requires: p.requires } : {}));
  const dist = tmp();
  const sums = [];
  plugins.forEach((p, i) => {
    const pkg = makePackage(manifests[i], { serverCode: p.serverCode });
    const into = path.join(dist, p.id);
    fs.mkdirSync(into);
    execFileSync('tar', ['-xzf', pkg.file, '-C', into]);
    sums.push(`${sha(pkg.buf)}  ${p.id}-${manifests[i].version}.tgz`);
  });
  fs.writeFileSync(path.join(dist, 'SHA256SUMS'), `${sums.join('\n')}\n`);
  const db = freshDb();
  const model = buildPluginsModel(db);
  const settingsModel = require('../models/pluginSettingsModel').buildModel(db);
  registry.reset();
  registry.configure({ isActive: (id) => model.isActive(id), allows: () => true });
  loader.resetLiveTransitionsForTests();
  const store = createPackageStore({ dataDir: tmp(), distDir: dist });
  if (eraseData) store.eraseData = eraseData;
  const state = {
    mode: 'packages', store, incompatible: {}, loaded: {}, assetKeys: {}, updating: false, restart: { supervised: true, schedule: () => true },
  };
  const host = {
    state: () => state,
    mode: () => 'packages',
    store: () => store,
    registryClient: () => ({ versions: () => [], status: () => ({ configured: false }) }),
    runningCopy: (id) => { const p = store.bundled()[id]; return p ? { manifest: p.manifest, sha256: p.sha256 } : null; },
    hostExports: () => null,
    setLoaded: (id, v) => { state.loaded[id] = v; },
    unsetLoaded: (id) => { delete state.loaded[id]; },
  };
  const realLoader = { ...loader, registerLive: (mod) => loader.registerLive(mod, { db, settingsModel }) };
  const ctrl = createController(model, {
    registry, host: () => host, db: () => db, loader: () => realLoader, licence: () => allowAll, coreVersion: () => '3.18.0', settingsModel: () => settingsModel,
  });
  const hasTable = (name) => Boolean(db.prepare('SELECT 1 FROM sqlite_master WHERE name = ?').get(name));
  return { db, model, ctrl, host, state, hasTable, settingsModel };
}

module.exports = { setup, realSetup, call, manifest, makePackage, registry, freshDb, sha, keys, spki, signIndex, indexOf, fakeFetch, createRegistryClient, createPackageStore, tmp };
