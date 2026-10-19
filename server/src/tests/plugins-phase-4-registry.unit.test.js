// specs/plugins-phase-4-registry.md — plugin packages, the signed registry, install, update and
// rollback from the Plugins page. Covers the manifest, the SDK version, the package store, the
// registry client, the offers and their refusals, the loader's package path, the controller flows
// and the migration of an existing install (Solio: twelve `builtin` rows → `bundled`).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const Database = require('better-sqlite3');
const { execFileSync } = require('child_process');

process.env.GUESTFLOW_ENCRYPTION_KEY = process.env.GUESTFLOW_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const { validateManifest, readSourceManifest, parseManifest } = require('../plugins/manifest');
const { PLUGIN_CATALOG, PLUGIN_IDS, SEEDED_ON_EXISTING_IDS } = require('../constants/plugins');
const { SDK_VERSION } = require('../plugins/sdk/version');
const { satisfies, floorLabel } = require('../utils/semverRange');
const {
  createPackageStore, assertPackageMembers, resolveMode, PackageError,
} = require('../plugins/packageStore');
const { createRegistryClient, signIndex } = require('../plugins/registryClient');
const {
  rangeRefusal, bestCandidate, requirementPlan, changelogBetween, dependentsOf,
} = require('../utils/pluginOffers');
const { ensurePluginsTable, ensurePluginSettingsTable, seedBuiltinPlugins } = require('../utils/pluginsSchema');
const { buildModel: buildPluginsModel } = require('../models/pluginsModel');
const { createController } = require('../controllers/pluginsController');
const { createRestarter } = require('../utils/processRestart');
const registry = require('../plugins/sdk/registry');
const loader = require('../plugins/loader');
const { createContext } = require('../plugins/sdk/createContext');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gf-phase4-'));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function manifest(id, version, extra = {}) {
  return {
    id, name: `Plugin ${id}`, version, description: 'd', icon: 'extension', surfaces: ['Une page'],
    requires: [], guestflow: '>=3.9.0', sdk: '^1.0.0', changelog: { [version]: [`Version ${version}.`] }, ...extra,
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
  requirePackage: (id) => ({ id, register() {} }),
  registerLive: (mod) => { calls.push(['live', mod.id]); return true; },
});

// ---------- §3.B package and manifest (rules 1–5) ----------

test('rule 2: each plugin has a valid manifest, and the catalogue is built from them', () => {
  assert.equal(PLUGIN_CATALOG.length, PLUGIN_IDS.length);
  assert.ok(PLUGIN_IDS.length >= 12);
  PLUGIN_IDS.forEach((id) => {
    const m = readSourceManifest(id);
    assert.deepEqual(validateManifest(m), [], id);
    assert.equal(PLUGIN_CATALOG.find((p) => p.id === id).name, m.name);
    assert.ok(satisfies(SDK_VERSION, m.sdk), `${id} accepts the running SDK`);
  });
});

test('rule 2: a manifest missing a field, or with a bad range, is refused with French reasons', () => {
  assert.ok(validateManifest({ ...manifest('x-y', '1.0.0'), version: '1.0' }).includes('Version absente ou invalide (x.y.z).'));
  assert.ok(validateManifest({ ...manifest('x-y', '1.0.0'), guestflow: 'not a range' }).length > 0);
  assert.ok(validateManifest({ ...manifest('x-y', '1.0.0'), requires: [{ id: 'linen' }] }).includes('Dépendances invalides.'));
  assert.throws(() => parseManifest('{'), /INVALID_MANIFEST/);
});

// 1.1.0 since the Booking intake added `ctx.core.reservations.platformCommission`,
// `ctx.core.clients.update` and the `planningDateRange` core module; 1.2.0 since `ctx.secretRoutes`,
// the `qonto` core module (2026-10-18 code review) and `secrets.rotate`, for the website key's
// « Régénérer ». 1.3.0 since `ctx.setupStatus` (specs/plugins-phase-0-foundation.md rule 25, the
// plugin cards' real state). All minor bumps.
test('rule 3: the SDK has a semver version starting at 1.0.0', () => {
  assert.equal(SDK_VERSION, '1.3.0');
  assert.equal(satisfies(SDK_VERSION, '^1.0.0'), true);
  assert.equal(satisfies(SDK_VERSION, '^2.0.0'), false);
});

test('rule 1: a package holds manifest.json, server/ and client/ only — no link, no absolute path, no ..', () => {
  assert.doesNotThrow(() => assertPackageMembers({ names: 'manifest.json\nserver/\nserver/index.js\nclient/index.js\n', verbose: '-rw-r--r-- manifest.json' }));
  assert.throws(() => assertPackageMembers({ names: 'manifest.json\n../evil.js', verbose: '' }), /PACKAGE_REJECTED/);
  assert.throws(() => assertPackageMembers({ names: 'manifest.json\n/etc/passwd', verbose: '' }), /PACKAGE_REJECTED/);
  assert.throws(() => assertPackageMembers({ names: 'manifest.json\nnode_modules/x.js', verbose: '' }), /PACKAGE_REJECTED/);
  assert.throws(() => assertPackageMembers({ names: 'manifest.json', verbose: 'lrwxr-xr-x server -> /' }), /PACKAGE_REJECTED/);
  assert.throws(() => assertPackageMembers({ names: 'server/index.js', verbose: '' }), /no manifest/);
});

// ---------- §3.C registry (rules 6–9) ----------

test('rules 6, 9: a signed index is read; its packages are offered with their hash and size', async () => {
  const { publicKey, privateKey } = keys();
  const m = manifest('linen', '1.0.1');
  const pkg = makePackage(m);
  const index = indexOf([{ m, buf: pkg.buf }]);
  const client = createRegistryClient({
    url: 'https://console.example/registry/v1', publicKey: spki(publicKey), log: { warn() {}, error() {} },
    fetchImpl: fakeFetch({ '/index.json': index, '/index.json.sig': signIndex(index, privateKey) }),
    now: () => new Date('2026-10-08T12:00:00Z'),
  });
  const status = await client.refresh();
  assert.equal(status.state, 'ok');
  assert.equal(status.lastOkAt, '2026-10-08T12:00:00.000Z');
  assert.deepEqual(client.versions('linen').map((v) => [v.version, v.size]), [['1.0.1', pkg.buf.length]]);
  assert.equal(client.packageUrl('linen', '1.0.1'), 'https://console.example/registry/v1/packages/linen-1.0.1.tgz');
});

test('rule 6: an index whose signature does not verify is ignored entirely', async () => {
  const { privateKey } = keys();
  const other = keys();
  const m = manifest('linen', '1.0.1');
  const index = indexOf([{ m, buf: makePackage(m).buf }]);
  const client = createRegistryClient({
    url: 'https://console.example/registry/v1', publicKey: spki(other.publicKey), log: { warn() {}, error() {} },
    fetchImpl: fakeFetch({ '/index.json': index, '/index.json.sig': signIndex(index, privateKey) }),
  });
  assert.equal((await client.refresh()).state, 'invalid');
  assert.deepEqual(client.versions('linen'), []);
});

test('rule 9: without a URL or a key there is no registry, and nothing is fetched', async () => {
  let called = false;
  const client = createRegistryClient({ url: '', publicKey: null, fetchImpl: async () => { called = true; } });
  assert.deepEqual(await client.refresh(), { configured: false, state: 'none', lastOkAt: null });
  assert.equal(called, false);
});

test('rule 9 edge case: an unreachable registry offers nothing and keeps the time of its last read', async () => {
  const { publicKey, privateKey } = keys();
  const m = manifest('linen', '1.0.1');
  const index = indexOf([{ m, buf: makePackage(m).buf }]);
  let down = false;
  const ok = fakeFetch({ '/index.json': index, '/index.json.sig': signIndex(index, privateKey) });
  const client = createRegistryClient({
    url: 'https://console.example/registry/v1', publicKey: spki(publicKey), log: { warn() {}, error() {} },
    fetchImpl: (url) => (down ? fakeFetch({}, { fail: true })(url) : ok(url)),
  });
  await client.refresh();
  down = true;
  const status = await client.refresh();
  assert.equal(status.state, 'unreachable');
  assert.ok(status.lastOkAt);
  assert.deepEqual(client.versions('linen'), []);
});

// ---------- §3.D offers and refusals (rules 10, 12, 22) ----------

const sourcesOf = ({ registry: reg = {}, bundled = {} }) => ({
  registry: (id) => reg[id] || [],
  bundled: (id) => (bundled[id] ? { manifest: bundled[id], sha256: 'a'.repeat(64) } : null),
});
const ENV = { coreVersion: '3.9.0', sdkVersion: '1.0.0' };

test('rule 10: the highest compatible version is offered; the archive copy wins a tie', () => {
  const src = sourcesOf({
    registry: { linen: [{ version: '1.0.0', manifest: manifest('linen', '1.0.0') }, { version: '1.2.0', manifest: manifest('linen', '1.2.0') }, { version: '2.0.0', manifest: manifest('linen', '2.0.0', { guestflow: '>=4.1.0' }) }] },
    bundled: { linen: manifest('linen', '1.2.0') },
  });
  const offer = bestCandidate('linen', src, ENV);
  assert.equal(offer.version, '1.2.0');
  assert.equal(offer.source, 'bundled');
});

test('rule 22: a core too old is said « Nécessite GuestFlow 4.1 ou plus récent. »', () => {
  assert.deepEqual(rangeRefusal(manifest('linen', '2.0.0', { guestflow: '>=4.1.0' }), ENV), { code: 'CORE_TOO_OLD', message: 'Nécessite GuestFlow 4.1 ou plus récent.' });
  assert.equal(rangeRefusal(manifest('linen', '2.0.0', { sdk: '^2.0.0' }), ENV).code, 'SDK_INCOMPATIBLE');
  assert.equal(rangeRefusal(manifest('linen', '2.0.0', { guestflow: '<3.0.0' }), ENV).message, 'Incompatible avec cette version de GuestFlow.');
  assert.equal(rangeRefusal(manifest('linen', '2.0.0', { guestflow: '>=9.0.0' }), { ...ENV, coreVersion: '0.0.0-dev' }), null);
  assert.equal(floorLabel('>=4.1.2'), '4.1.2');
});

test('rule 12: a missing requirement is proposed for the same confirmation, before the plugin', () => {
  const sas = manifest('sas', '1.1.0', { requires: [{ id: 'linen', range: '^1.0.0' }] });
  const ctx = {
    sources: sourcesOf({ bundled: { linen: manifest('linen', '1.0.0'), sas } }), env: ENV, installed: {}, nameOf: (id) => `Nom ${id}`, allows: () => true,
  };
  assert.deepEqual(requirementPlan(sas, ctx), { plan: [{ id: 'linen', name: 'Nom linen', version: '1.0.0', source: 'bundled' }], refusal: null });
  assert.deepEqual(requirementPlan(sas, { ...ctx, installed: { linen: '1.0.0' } }).plan, []);
  assert.equal(requirementPlan(sas, { ...ctx, installed: { linen: '0.9.0' } }).refusal.code, 'REQUIREMENT_TOO_OLD');
  assert.equal(requirementPlan(sas, { ...ctx, allows: () => false }).refusal.message, 'Nécessite Nom linen, hors forfait.');
});

test('rule 12: uninstalling a plugin another installed plugin requires names that plugin', () => {
  const dependents = dependentsOf('linen', { sas: manifest('sas', '1.0.0', { requires: [{ id: 'linen', range: '^1.0.0' }] }), neat: manifest('neat', '1.0.0') });
  assert.deepEqual(dependents.map((m) => m.id), ['sas']);
});

test('rule 20: the changelog lines of the versions in between, newest first', () => {
  const m = manifest('linen', '1.3.0', { changelog: { '1.0.0': ['a'], '1.1.0': ['b'], '1.2.0': ['c'], '1.3.0': ['d', 'e'] } });
  assert.deepEqual(changelogBetween(m, '1.1.0', '1.3.0'), [{ version: '1.3.0', lines: ['d', 'e'] }, { version: '1.2.0', lines: ['c'] }]);
});

// ---------- §3.D store (rules 11, 15, 16) ----------

test('rule 11: a registry package is verified, then unpacked to <data>/plugins/<id>/<version>', async () => {
  const m = manifest('linen', '1.0.1');
  const pkg = makePackage(m);
  const dataDir = tmp();
  const store = createPackageStore({ dataDir, distDir: tmp(), fetchImpl: fakeFetch({ '/packages/linen-1.0.1.tgz': pkg.buf }) });
  const got = await store.fetchFromRegistry({ id: 'linen', version: '1.0.1', sha256: sha(pkg.buf), size: pkg.buf.length, url: 'https://r.example/registry/v1/packages/linen-1.0.1.tgz' });
  assert.equal(got.manifest.version, '1.0.1');
  assert.ok(fs.existsSync(path.join(dataDir, 'plugins', 'linen', '1.0.1', 'server', 'index.js')));
  store.setCurrent('linen', '1.0.1');
  assert.equal(store.readCurrent('linen'), '1.0.1');
});

test('rule 11: a hash mismatch or a failed download leaves the running version untouched', async () => {
  const m = manifest('linen', '1.0.1');
  const pkg = makePackage(m);
  const dataDir = tmp();
  const store = createPackageStore({ dataDir, distDir: tmp(), fetchImpl: fakeFetch({ '/packages/linen-1.0.1.tgz': pkg.buf }) });
  fs.mkdirSync(path.join(dataDir, 'plugins', 'linen', '1.0.0'), { recursive: true });
  store.setCurrent('linen', '1.0.0');
  await assert.rejects(store.fetchFromRegistry({ id: 'linen', version: '1.0.1', sha256: 'f'.repeat(64), size: pkg.buf.length, url: 'https://r.example/registry/v1/packages/linen-1.0.1.tgz' }),
    (err) => err instanceof PackageError && err.code === 'PACKAGE_REJECTED');
  const offline = createPackageStore({ dataDir, distDir: tmp(), fetchImpl: fakeFetch({}, { fail: true }) });
  await assert.rejects(offline.fetchFromRegistry({ id: 'linen', version: '1.0.1', sha256: sha(pkg.buf), url: 'https://r.example/registry/v1/packages/linen-1.0.1.tgz' }),
    (err) => err.code === 'DOWNLOAD_FAILED');
  assert.equal(store.readCurrent('linen'), '1.0.0');
  assert.equal(fs.existsSync(path.join(dataDir, 'plugins', 'linen', '1.0.1')), false);
});

test('rule 11: a package whose manifest names another version is refused', async () => {
  const pkg = makePackage(manifest('linen', '1.0.2'));
  const store = createPackageStore({ dataDir: tmp(), distDir: tmp(), fetchImpl: fakeFetch({ '/packages/linen-1.0.1.tgz': pkg.buf }) });
  await assert.rejects(store.fetchFromRegistry({ id: 'linen', version: '1.0.1', sha256: sha(pkg.buf), url: 'https://r.example/registry/v1/packages/linen-1.0.1.tgz' }),
    /PACKAGE_REJECTED:manifest says 1.0.2/);
});

test('rule 15: ctx.dataDir is the plugin\'s own directory, created on first read, erased only on demand', () => {
  const dataDir = tmp();
  const store = createPackageStore({ dataDir, distDir: tmp() });
  const ctx = createContext('linen', { dataDir: () => store.dataDirPath('linen') });
  assert.equal(ctx.dataDir, path.join(dataDir, 'plugin-data', 'linen'));
  assert.ok(fs.statSync(ctx.dataDir).isDirectory());
  store.prune('linen', []);
  assert.ok(fs.existsSync(ctx.dataDir), 'removing the package keeps the data');
  store.eraseData('linen');
  assert.equal(fs.existsSync(path.join(dataDir, 'plugin-data', 'linen')), false);
});

test('rule 16: pruning keeps the running version and the previous one only', () => {
  const dataDir = tmp();
  const store = createPackageStore({ dataDir, distDir: tmp() });
  ['1.0.0', '1.0.1', '1.0.2'].forEach((v) => fs.mkdirSync(path.join(dataDir, 'plugins', 'linen', v), { recursive: true }));
  assert.deepEqual(store.prune('linen', ['1.0.2', '1.0.1']), ['1.0.0']);
});

test('rule 19: a release runs packages, a development tree its sources', () => {
  const dist = makeDist([]);
  assert.equal(resolveMode({ GUESTFLOW_PLUGINS_DIST: dist }, dist), 'packages');
  assert.equal(resolveMode({ GUESTFLOW_PLUGINS: 'sources' }, dist), 'sources');
  assert.equal(resolveMode({}, tmp()), 'sources');
});

// ---------- §3.E loading (rules 13, 14, 17) ----------

test('rules 4, 17: a package loads from its directory, `guestflow/sdk` and npm packages resolve to the core', () => {
  const code = `const sdk = require('guestflow/sdk'); const { SDK_VERSION } = require('guestflow/sdk/version');
    const express = require('express');
    module.exports = { id: 'weather-alerts', register(ctx) { ctx.marker = typeof express.Router + SDK_VERSION + typeof sdk.coreModule; } };`;
  const m = manifest('weather-alerts', '1.0.0');
  const dist = makeDist([m]);
  fs.writeFileSync(path.join(dist, 'weather-alerts', 'server', 'index.js'), code);
  const store = createPackageStore({ dataDir: tmp(), distDir: dist });
  const out = loader.loadPackages({ store, rows: [{ id: 'weather-alerts', source: 'bundled', version: '1.0.0' }], order: ['weather-alerts'], env: ENV });
  assert.deepEqual(out.incompatible, {});
  assert.equal(out.modules.length, 1);
  const ctx = {};
  out.modules[0].register(ctx);
  assert.equal(ctx.marker, `function${SDK_VERSION}function`);
});

test('rule 14: a package the running core no longer satisfies stays installed but is not loaded', () => {
  const m = manifest('linen', '1.0.0', { guestflow: '>=5.0.0' });
  const sas = manifest('sas', '1.0.0', { requires: [{ id: 'linen', range: '^1.0.0' }] });
  const store = createPackageStore({ dataDir: tmp(), distDir: makeDist([m, sas]) });
  const out = loader.loadPackages({
    store, rows: [{ id: 'linen', source: 'bundled' }, { id: 'sas', source: 'bundled' }], order: ['linen', 'sas'], env: ENV, nameOf: (id) => `Nom ${id}`,
  });
  assert.deepEqual(out.modules, []);
  assert.equal(out.incompatible.linen.message, 'Incompatible avec cette version.');
  assert.equal(out.incompatible.sas.message, 'Nécessite Nom linen.');
});

test('rules 14, 17: in the package mode a plugin that did not load is not live', () => {
  registry.reset();
  registry.configure({ isActive: () => true, allows: () => true, requireRecord: true });
  assert.equal(registry.isLive('linen'), false);
  registry.ensure('linen');
  assert.equal(registry.isLive('linen'), true);
  registry.reset();
});

test('rule 13: an install registers live — its routes answer without a restart', async () => {
  registry.reset();
  registry.configure({ isActive: () => true, allows: () => true });
  const app = express();
  loader.mountPublic(app);
  loader.mountApi(app);
  app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found' }));
  const mod = { id: 'school-holidays', register(ctx) { const r = express.Router(); r.get('/', (req, res) => res.json({ ok: true })); ctx.mount('/api/school-holidays', r); } };
  const server = app.listen(0);
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/school-holidays`;
    assert.equal((await fetch(url)).status, 404);
    assert.equal(loader.registerLive(mod, { db: null }), true);
    assert.deepEqual(await (await fetch(url)).json(), { ok: true });
  } finally {
    server.close();
    registry.reset();
  }
});

// ---------- the controller (rules 10–16, 20–22) ----------

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

test('rules 10, 20: an installed plugin shows its version and the update with its changelog lines', async () => {
  const next = manifest('linen', '1.1.0', { changelog: { '1.0.1': ['Correctif.'], '1.1.0': ['Nouveau rapport.'] } });
  const { ctrl, registryClient } = setup({
    bundled: [manifest('linen', '1.0.0')], regEntries: [{ m: next, buf: makePackage(next).buf }],
    installed: [{ id: 'linen', version: '1.0.0', source: 'bundled' }],
  });
  await registryClient.refresh();
  const linen = (await call(ctrl.list)).body.find((p) => p.id === 'linen');
  assert.equal(linen.version, '1.0.0');
  assert.deepEqual(linen.update, { version: '1.1.0', changelog: [{ version: '1.1.0', lines: ['Nouveau rapport.'] }, { version: '1.0.1', lines: ['Correctif.'] }], refusal: null });
  const status = (await call(ctrl.status)).body;
  assert.equal(status.banner, '1 mise à jour disponible');
  assert.match(status.registry.label, /^Registre lu/);
});

test('rule 21: an available plugin is listed with the version it would install', async () => {
  const { ctrl } = setup({ bundled: [manifest('neat', '1.0.0')] });
  const neat = (await call(ctrl.list)).body.find((p) => p.id === 'neat');
  assert.equal(neat.state, 'available');
  assert.deepEqual(neat.offer, { version: '1.0.0', requirements: [], refusal: null });
});

test('rules 11, 13, 16: an update verifies, switches, keeps the previous copy for 7 days and restarts', async () => {
  const next = manifest('linen', '1.1.0');
  const pkg = makePackage(next);
  const { ctrl, model, registryClient, host } = setup({
    bundled: [manifest('linen', '1.0.0')], regEntries: [{ m: next, buf: pkg.buf }],
    installed: [{ id: 'linen', version: '1.0.0', source: 'bundled' }],
  });
  await registryClient.refresh();
  const res = await call(ctrl.update, { params: { id: 'linen' } });
  assert.equal(res.statusCode, 202);
  assert.deepEqual(res.body, { restarting: true, version: '1.1.0' });
  const row = model.get('linen');
  assert.equal(row.version, '1.1.0');
  assert.equal(row.source, 'registry');
  assert.equal(row.pinnedSha256, sha(pkg.buf));
  assert.equal(row.previousVersion, '1.0.0');
  assert.equal(row.rollbackUntil, '2026-10-15T12:00:00.000Z');
  assert.equal(host.restarts.length, 1);
  assert.equal(host.store().readCurrent('linen'), '1.1.0');
});

test('rule 22, edge case: a second « Mettre à jour » during an update gets 409 « Mise à jour déjà en cours »', async () => {
  const next = manifest('linen', '1.1.0');
  const { ctrl, registryClient, host } = setup({
    bundled: [manifest('linen', '1.0.0')], regEntries: [{ m: next, buf: makePackage(next).buf }],
    installed: [{ id: 'linen', version: '1.0.0', source: 'bundled' }],
  });
  await registryClient.refresh();
  host.state().updating = true;
  const res = await call(ctrl.update, { params: { id: 'linen' } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.message, 'Mise à jour déjà en cours.');
});

test('rules 11, 22: a package that does not match its signature is refused and nothing changes', async () => {
  const next = manifest('linen', '1.1.0');
  const { ctrl, model, registryClient, files, host } = setup({
    bundled: [manifest('linen', '1.0.0')], regEntries: [{ m: next, buf: makePackage(next).buf }],
    installed: [{ id: 'linen', version: '1.0.0', source: 'bundled' }],
  });
  await registryClient.refresh();
  files['/packages/linen-1.1.0.tgz'] = makePackage({ ...next, description: 'autre' }).buf;
  const res = await call(ctrl.update, { params: { id: 'linen' } });
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.message, 'Le paquet reçu ne correspond pas à sa signature — rien n’a été modifié.');
  assert.equal(model.get('linen').version, '1.0.0');
  assert.equal(host.state().updating, false);
  assert.equal(host.restarts.length, 0);
});

test('rule 22: a download that fails is said « Téléchargement impossible »', async () => {
  const next = manifest('linen', '1.1.0');
  const { ctrl, registryClient, files } = setup({
    bundled: [manifest('linen', '1.0.0')], regEntries: [{ m: next, buf: makePackage(next).buf }],
    installed: [{ id: 'linen', version: '1.0.0', source: 'bundled' }],
  });
  await registryClient.refresh();
  delete files['/packages/linen-1.1.0.tgz'];
  const res = await call(ctrl.update, { params: { id: 'linen' } });
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.message, 'Téléchargement impossible — rien n’a été modifié.');
});

test('rule 13: without a supervisor to restart it, an update is refused before anything moves', async () => {
  const next = manifest('linen', '1.1.0');
  const { ctrl, registryClient, model } = setup({
    bundled: [manifest('linen', '1.0.0')], regEntries: [{ m: next, buf: makePackage(next).buf }],
    installed: [{ id: 'linen', version: '1.0.0', source: 'bundled' }], supervised: false,
  });
  await registryClient.refresh();
  assert.equal((await call(ctrl.update, { params: { id: 'linen' } })).statusCode, 412);
  assert.equal(model.get('linen').version, '1.0.0');
  assert.equal(createRestarter({ env: {} }).supervised, false);
  assert.equal(createRestarter({ env: { pm_id: '0' } }).supervised, true);
});

test('rule 16: « Revenir à la version précédente » inside the window, not after it', async () => {
  const next = manifest('linen', '1.1.0');
  const { ctrl, model, registryClient, host } = setup({
    bundled: [manifest('linen', '1.0.0')], regEntries: [{ m: next, buf: makePackage(next).buf }],
    installed: [{ id: 'linen', version: '1.0.0', source: 'bundled' }],
  });
  await registryClient.refresh();
  await call(ctrl.update, { params: { id: 'linen' } });
  const view = (await call(ctrl.list)).body.find((p) => p.id === 'linen');
  assert.equal(view.rollback.version, '1.0.0');
  host.state().updating = false; // the restart that followed the update
  const res = await call(ctrl.rollback, { params: { id: 'linen' } });
  assert.equal(res.statusCode, 202);
  const row = model.get('linen');
  assert.equal(row.version, '1.0.0');
  assert.equal(row.source, 'bundled');
  assert.equal(row.previousVersion, null);
  model.switchVersion('linen', { version: '1.1.0', source: 'registry', manifest: next }, { rollbackUntil: '2026-10-01T00:00:00.000Z' });
  assert.equal((await call(ctrl.list)).body.find((p) => p.id === 'linen').rollback, null);
});

test('rule 14: an incompatible plugin is shown as such, with the compatible version offered', async () => {
  const { ctrl, host } = setup({
    bundled: [manifest('linen', '1.0.0')], installed: [{ id: 'linen', version: '2.0.0', source: 'registry' }],
  });
  host.state().incompatible.linen = { code: 'CORE_TOO_OLD', message: 'Incompatible avec cette version.' };
  const linen = (await call(ctrl.list)).body.find((p) => p.id === 'linen');
  assert.equal(linen.state, 'incompatible');
  assert.equal(linen.incompatible.compatibleVersion, '1.0.0');
  assert.equal(linen.update.version, '1.0.0');
});

test('rules 10, 13: installing from the archive registers the plugin live and records the package', async () => {
  const { ctrl, model, calls } = setup({ bundled: [manifest('neat', '1.0.0')] });
  const res = await call(ctrl.install, { params: { id: 'neat' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reload, true);
  assert.deepEqual(calls.map((c) => c[0]), ['live', 'migrate', 'hooks']);
  const row = model.get('neat');
  assert.equal(row.source, 'bundled');
  assert.equal(row.version, '1.0.0');
  assert.equal(row.manifest.id, 'neat');
});

test('rule 12: installing a plugin whose requirement is missing asks first, then installs both', async () => {
  const sas = manifest('sas', '1.0.0', { requires: [{ id: 'linen', range: '^1.0.0' }] });
  const { ctrl, model } = setup({ bundled: [manifest('linen', '1.0.0'), sas] });
  const first = await call(ctrl.install, { params: { id: 'sas' } });
  assert.equal(first.statusCode, 409);
  assert.equal(first.body.error, 'REQUIREMENTS');
  assert.deepEqual(first.body.requirements.map((r) => r.id), ['linen']);
  const second = await call(ctrl.install, { params: { id: 'sas' }, body: { withRequirements: true } });
  assert.equal(second.statusCode, 200);
  assert.ok(model.get('linen') && model.get('sas'));
  const refused = await call(ctrl.uninstall, { params: { id: 'linen' } });
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.body.error, 'REQUIRED_BY');
});

test('rule 22: an install whose only version needs a newer core is refused in plain French', async () => {
  const { ctrl } = setup({ bundled: [manifest('neat', '1.0.0', { guestflow: '>=4.1.0' })] });
  const res = await call(ctrl.install, { params: { id: 'neat' } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.message, 'Nécessite GuestFlow 4.1 ou plus récent.');
});

test('rule 15: « Effacer aussi ses données » removes the plugin data directory', async () => {
  const { ctrl, host, model } = setup({ bundled: [manifest('neat', '1.0.0')], installed: [{ id: 'neat', version: '1.0.0', source: 'bundled' }] });
  registry.ensure('neat').data = { tables: [], describe: () => [] };
  const dir = host.store().dataDirFor('neat');
  const res = await call(ctrl.uninstall, { params: { id: 'neat' }, query: { purge: '1' } });
  assert.equal(res.statusCode, 200);
  assert.equal(fs.existsSync(dir), false);
  assert.equal(model.get('neat'), null);
  registry.reset();
});

test('rule 20: « Tout mettre à jour » verifies every package first, then switches all and restarts once', async () => {
  const l = manifest('linen', '1.1.0');
  const n = manifest('neat', '1.2.0');
  const { ctrl, model, registryClient, host } = setup({
    bundled: [manifest('linen', '1.0.0'), manifest('neat', '1.0.0')],
    regEntries: [{ m: l, buf: makePackage(l).buf }, { m: n, buf: makePackage(n).buf }],
    installed: [{ id: 'linen', version: '1.0.0', source: 'bundled' }, { id: 'neat', version: '1.0.0', source: 'bundled' }],
  });
  await registryClient.refresh();
  assert.equal((await call(ctrl.status)).body.banner, '2 mises à jour disponibles');
  const res = await call(ctrl.updateAll);
  assert.equal(res.statusCode, 202);
  assert.deepEqual([model.get('linen').version, model.get('neat').version], ['1.1.0', '1.2.0']);
  assert.equal(host.restarts.length, 1);
});

// ---------- §5 data model: an existing install keeps everything ----------

test('§5, rule 25: an existing install\'s `builtin` rows become `bundled` and follow the running copy', () => {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE migrations (name TEXT PRIMARY KEY, ran_at TEXT NOT NULL DEFAULT (datetime('now')))");
  db.exec(`CREATE TABLE plugins (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, source TEXT NOT NULL DEFAULT 'builtin',
    version TEXT, installed_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.prepare("INSERT INTO plugins (id, enabled, source) VALUES ('linen', 1, 'builtin'), ('neat', 0, 'builtin')").run();
  db.exec('CREATE TABLE payment_links (id INTEGER PRIMARY KEY, status TEXT); CREATE TABLE users (id INTEGER PRIMARY KEY, isActive INTEGER); CREATE TABLE user_roles (userId INTEGER, role TEXT);');
  ensurePluginsTable(db);
  ensurePluginsTable(db);
  const model = buildPluginsModel(db);
  assert.deepEqual(model.list().map((r) => [r.id, r.enabled, r.source]), [['linen', true, 'bundled'], ['neat', false, 'bundled']]);
  assert.ok(model.syncBundled('linen', readSourceManifest('linen'), 'a'.repeat(64)));
  assert.equal(model.get('linen').version, readSourceManifest('linen').version);
  assert.equal(model.syncBundled('linen', readSourceManifest('linen'), 'a'.repeat(64)), false, 'idempotent');
});

// The seed installs the twelve former core features only (specs/plugins-phase-0-foundation.md rule 10).
test('§5: a database seeded before phase 4 or after gets every seeded plugin as `bundled`', () => {
  const db = freshDb();
  db.prepare('INSERT INTO properties (id) VALUES (1)').run();
  seedBuiltinPlugins(db);
  const rows = buildPluginsModel(db).list();
  assert.equal(rows.length, SEEDED_ON_EXISTING_IDS.length);
  assert.ok(rows.every((r) => r.source === 'bundled' && r.enabled));
});

// ---------- added after the review of 2026-10-17 (rules 13, 14, 27, 29–31) ----------

test('rule 14: an older version is offered only to a plugin the core cannot run', async () => {
  const { ctrl, host } = setup({ bundled: [manifest('linen', '1.0.0')], installed: [{ id: 'linen', version: '2.0.0', source: 'registry' }] });
  const refused = await call(ctrl.update, { params: { id: 'linen' }, body: { version: '1.0.0' } });
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.body.error, 'NO_UPDATE');
  host.state().incompatible.linen = { code: 'CORE_TOO_OLD', message: 'Incompatible avec cette version.' };
  assert.equal((await call(ctrl.update, { params: { id: 'linen' }, body: { version: '1.0.0' } })).statusCode, 202);
});

test('rule 13: the restart goes through the server\'s own shutdown, not a bare exit', () => {
  const calls = [];
  const restarter = createRestarter({ env: { pm_id: '0' }, stop: () => calls.push('stop'), setTimeoutFn: (fn) => fn(), log: { error() {} } });
  assert.equal(restarter.schedule(), true);
  assert.deepEqual(calls, ['stop']);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'utils', 'processRestart.js'), 'utf8'), /process\.exit/);
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  assert.match(index, /startedAt: PROCESS_STARTED_AT/, '/api/version says when the process started, not when it was asked');
});

test('rule 29: an install needing a restart is refused without a supervisor, and one install runs at a time', async () => {
  const { ctrl, host, model } = setup({ bundled: [manifest('neat', '1.1.0')], supervised: false, loaded: { neat: '1.0.0' } });
  const res = await call(ctrl.install, { params: { id: 'neat' } });
  assert.equal(res.statusCode, 412);
  assert.equal(model.get('neat'), null);
  host.state().loaded = {};
  host.state().updating = true;
  assert.equal((await call(ctrl.install, { params: { id: 'neat' } })).body.error, 'UPDATE_IN_PROGRESS');
});

test('rule 29: a requirement installed for a plugin whose install fails is uninstalled again', async () => {
  const sas = manifest('sas', '1.0.0', { requires: [{ id: 'linen', range: '^1.0.0' }] });
  const { ctrl, model, host } = setup({ bundled: [manifest('linen', '1.0.0'), sas] });
  const db = freshDb();
  const failing = createController(model, {
    registry,
    host: () => host,
    db: () => db,
    licence: () => allowAll,
    coreVersion: () => '3.9.0',
    loader: () => ({ ...fakeLoader(), registerLive: (mod) => mod.id !== 'sas' }),
  });
  const res = await call(failing.install, { params: { id: 'sas' }, body: { withRequirements: true } });
  assert.equal(res.statusCode, 500);
  assert.equal(model.get('linen'), null);
  assert.equal(model.get('sas'), null);
  assert.equal(host.state().updating, false);
  // Second review m4 — the browser is no longer offered the undone requirement's bundle.
  assert.equal(host.state().loaded.linen, undefined);
  assert.ok(ctrl);
});

test('rule 29: a requirement downloaded from the registry and undone leaves no `current` pointer', async () => {
  const linen = manifest('linen', '1.1.0');
  const sas = manifest('sas', '1.0.0', { requires: [{ id: 'linen', range: '^1.1.0' }] });
  const { model, host, registryClient } = setup({ bundled: [manifest('linen', '1.0.0'), sas], regEntries: [{ m: linen, buf: makePackage(linen).buf }] });
  await registryClient.refresh();
  const failing = createController(model, {
    registry, host: () => host, db: () => freshDb(), licence: () => allowAll, coreVersion: () => '3.9.0',
    loader: () => ({ ...fakeLoader(), registerLive: (mod) => mod.id !== 'sas' }),
  });
  assert.equal((await call(failing.install, { params: { id: 'sas' }, body: { withRequirements: true } })).statusCode, 500);
  assert.equal(host.store().readCurrent('linen'), null);
  assert.equal(model.get('linen'), null);
});

test('rule 29 (second review m3): every refusal releases the lock; only a restart keeps it', async () => {
  const next = manifest('linen', '1.1.0');
  const buf = makePackage(next).buf;
  const { ctrl, registryClient, host, files } = setup({
    bundled: [manifest('linen', '1.0.0'), manifest('neat', '1.0.0', { guestflow: '>=9.0.0' })],
    regEntries: [{ m: next, buf }],
    installed: [{ id: 'linen', version: '1.0.0', source: 'bundled' }],
  });
  await registryClient.refresh();
  delete files['/packages/linen-1.1.0.tgz'];
  assert.equal((await call(ctrl.update, { params: { id: 'linen' } })).statusCode, 502);
  assert.equal(host.state().updating, false);
  assert.equal((await call(ctrl.updateAll)).statusCode, 502);
  assert.equal(host.state().updating, false);
  assert.equal((await call(ctrl.install, { params: { id: 'neat' } })).statusCode, 409);
  assert.equal(host.state().updating, false);
  files['/packages/linen-1.1.0.tgz'] = buf;
  assert.equal((await call(ctrl.update, { params: { id: 'linen' } })).statusCode, 202);
  assert.equal(host.state().updating, true, 'held until the restart');
});

test('rule 27: the client files are listed under a URL carrying the package hash', () => {
  const pluginHost = require('../plugins/host');
  const dist = makeDist([manifest('linen', '1.0.0')]);
  pluginHost.init({ env: { GUESTFLOW_PLUGINS: 'packages', GUESTFLOW_PLUGINS_DIST: dist }, dataDir: tmp() });
  pluginHost.setLoaded('linen', '1.0.0', 'abcdef0123456789');
  assert.deepEqual(pluginHost.clientEntries(), [{ id: 'linen', version: '1.0.0', url: '/plugin-assets/linen/1.0.0-abcdef012345/index.js' }]);
  pluginHost.init({ env: { GUESTFLOW_PLUGINS: 'sources' }, dataDir: tmp() });
});

test('rule 30: a signed index older than the last one read is refused (replay)', async () => {
  const { publicKey, privateKey } = keys();
  const m = manifest('linen', '1.0.1');
  const files = {};
  const publish = (generatedAt) => {
    const index = indexOf([{ m, buf: makePackage(m).buf }], generatedAt);
    files['/index.json'] = index;
    files['/index.json.sig'] = signIndex(index, privateKey);
  };
  const stateFile = path.join(tmp(), 'registry-state.json');
  const make = () => createRegistryClient({ url: 'https://r.example/registry/v1', publicKey: spki(publicKey), fetchImpl: fakeFetch(files), stateFile, log: { warn() {}, error() {} } });
  publish('2026-10-10T00:00:00.000Z');
  assert.equal((await make().refresh()).state, 'ok');
  publish('2026-10-01T00:00:00.000Z');
  const later = make();
  assert.equal((await later.refresh()).state, 'stale', 'remembered across a restart');
  assert.deepEqual(later.versions('linen'), []);
});

test('rule 30: a download beyond the size limit is cut while it streams', async () => {
  const { readLimited } = require('../plugins/packageStore');
  const declared = { headers: { get: () => '999999' }, arrayBuffer: async () => { throw new Error('read'); } };
  await assert.rejects(readLimited(declared, 1000), /too large/);
  let pulled = 0;
  const stream = new ReadableStream({ pull(c) { pulled += 1; c.enqueue(new Uint8Array(400)); if (pulled > 50) c.close(); } });
  await assert.rejects(readLimited({ headers: { get: () => null }, body: stream }, 1000), /too large/);
  assert.ok(pulled < 10, 'stopped reading once over the limit');
});

test('rule 31: a write under /api from another site is refused; webhooks and non-browser calls pass', async () => {
  const { createSameOriginWrites } = require('../middleware/sameOriginWrites');
  const app = express();
  app.set('trust proxy', false);
  app.use('/api', createSameOriginWrites({ allowedOrigins: ['http://localhost:3000'], isExempt: (req) => req.path === '/payments/qonto/webhook' }));
  app.all(/^\/api\/.*/, (req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, headers = {}) => fetch(base + url, { method: 'POST', headers }).then((r) => r.status);
  try {
    assert.equal(await post('/api/plugins/linen/install', { origin: 'https://evil.example' }), 403);
    assert.equal(await post('/api/plugins/linen/install', { referer: 'https://evil.example/page' }), 403);
    assert.equal(await post('/api/plugins/linen/install', { origin: 'null' }), 403);
    assert.equal(await post('/api/plugins/linen/install', { origin: base }), 200);
    assert.equal(await post('/api/plugins/linen/install', { origin: 'http://localhost:3000' }), 200);
    assert.equal(await post('/api/plugins/linen/install'), 200);
    assert.equal(await post('/api/payments/qonto/webhook', { origin: 'https://qonto.example' }), 200);
    assert.equal((await fetch(`${base}/api/plugins`, { headers: { origin: 'https://evil.example' } })).status, 200);
  } finally {
    server.close();
  }
});

// ---------- second review (2026-10-18): rules 30, 31, 33 ----------

test('rule 33: a package needing a host name this app does not expose is refused as « newer GuestFlow needed »', () => {
  const m = parseManifest(JSON.stringify(manifest('linen', '1.2.0', { hostImports: { '@mui/material': ['Box', 'Rating'], react: ['*'] }, contentHash: 'c'.repeat(64) })));
  assert.deepEqual(m.hostImports['@mui/material'], ['Box', 'Rating'], 'kept by the manifest reader');
  assert.equal(m.contentHash, 'c'.repeat(64));
  const host = { '@mui/material': ['Box'], react: '*' };
  assert.deepEqual(rangeRefusal(m, { ...ENV, hostExports: host }), { code: 'CORE_TOO_OLD', message: 'Nécessite une version plus récente de GuestFlow.' });
  assert.equal(rangeRefusal(m, { ...ENV, hostExports: { ...host, '@mui/material': ['Box', 'Rating'] } }), null);
  assert.equal(rangeRefusal(m, ENV), null, 'a development tree has no list: nothing refused');
});

test('rule 33: the offer skips a registry version the app cannot serve', () => {
  const src = sourcesOf({
    registry: { linen: [{ version: '1.3.0', manifest: manifest('linen', '1.3.0', { hostImports: { '@mui/material': ['Rating'] } }) }] },
    bundled: { linen: manifest('linen', '1.0.0') },
  });
  assert.equal(bestCandidate('linen', src, { ...ENV, hostExports: { '@mui/material': ['Box'] } }).version, '1.0.0');
});

test('rule 30: an index dated more than a day ahead is refused and not remembered; the state is per registry', async () => {
  const { publicKey, privateKey } = keys();
  const m = manifest('linen', '1.0.1');
  const files = {};
  const publish = (generatedAt) => {
    const index = indexOf([{ m, buf: makePackage(m).buf }], generatedAt);
    files['/index.json'] = index;
    files['/index.json.sig'] = signIndex(index, privateKey);
  };
  const stateFile = path.join(tmp(), 'registry-state.json');
  const clock = () => new Date('2026-10-18T12:00:00Z');
  const make = (url = 'https://r.example/registry/v1') => createRegistryClient({ url, publicKey: spki(publicKey), fetchImpl: fakeFetch(files), stateFile, now: clock, log: { warn() {}, error() {} } });
  publish('2030-01-01T00:00:00.000Z');
  assert.equal((await make().refresh()).state, 'invalid');
  publish('2026-10-18T11:00:00.000Z');
  assert.equal((await make().refresh()).state, 'ok', 'the future date was not remembered');
  publish('2026-10-10T00:00:00.000Z');
  assert.equal((await make().refresh()).state, 'stale');
  assert.equal((await make('https://other.example/registry/v1').refresh()).state, 'ok', 'another registry has its own history');
});

test('rule 31: same origin means same host AND port', async () => {
  const { createSameOriginWrites } = require('../middleware/sameOriginWrites');
  const app = express();
  app.use('/api', createSameOriginWrites({ allowedOrigins: [] }));
  app.post(/^\/api\/.*/, (req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  const port = server.address().port;
  const post = (origin) => fetch(`http://127.0.0.1:${port}/api/x`, { method: 'POST', headers: { origin } }).then((r) => r.status);
  try {
    assert.equal(await post(`http://127.0.0.1:${port}`), 200);
    assert.equal(await post(`http://127.0.0.1:${port + 1}`), 403);
  } finally {
    server.close();
  }
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  assert.match(index, /GUESTFLOW_DEV !== '1'/, 'on unless the development scripts say otherwise');
  assert.match(index, /same-origin writes: /);
});
