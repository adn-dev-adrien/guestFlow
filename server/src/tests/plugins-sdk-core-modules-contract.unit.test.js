// specs/plugins-phase-4-registry.md rule 35 — what `coreModule(name)` hands a server plugin is part of
// the SDK contract: `server/src/plugins/sdk/coreModules.json` lists every exposed module and the names
// it exports. A core change that removes or renames one fails here (and in check-plugin-versions
// against the base) unless the SDK major moves.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_PATH = process.env.DB_PATH || path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-core-contract-')), 'c.db');
const silent = console.log;
console.log = () => {};
const sdk = require('../plugins/sdk');
console.log = silent;
const CONTRACT = require('../plugins/sdk/coreModules.json');

const PLUGINS = path.join(__dirname, '..', 'plugins');

test('rule 35 — the contract lists exactly the modules coreModule() exposes', () => {
  assert.deepEqual(Object.keys(CONTRACT).sort(), [...sdk.CORE_MODULE_NAMES].sort());
});

test('rule 35 — every name of the contract is still exported by its core module', () => {
  const missing = [];
  for (const [name, exported] of Object.entries(CONTRACT)) {
    const mod = sdk.coreModule(name);
    exported.forEach((key) => { if (!(key in Object(mod))) missing.push(`${name}#${key}`); });
  }
  assert.deepEqual(missing, [], 'removed or renamed: keep them, or raise the SDK major (sdk/version.js)');
});

test('rule 35 — every coreModule() call of a plugin names an exposed module', () => {
  const calls = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'tests' && e.name !== 'sdk') walk(p); return; }
    if (!e.name.endsWith('.js')) return;
    for (const m of fs.readFileSync(p, 'utf8').matchAll(/coreModule\('([^']+)'\)/g)) calls.push([path.relative(PLUGINS, p), m[1]]);
  });
  walk(PLUGINS);
  assert.ok(calls.length > 20, 'the plugins do reach the core this way');
  assert.deepEqual(calls.filter(([, name]) => !CONTRACT[name]), []);
});

test('rule 35 — the console-shared Qonto library is a core module, not a plugin file', () => {
  assert.equal(sdk.coreModule('qonto').qontoService, require('../utils/qonto/qontoService'));
  assert.ok(CONTRACT.qonto.includes('qontoSettingsController'));
});

test('rule 35 — check-plugin-versions refuses a contract that lost a name, unless the SDK major moved', async () => {
  const { coreRemovals } = await import(path.join(__dirname, '..', '..', '..', 'scripts', 'check-plugin-versions.mjs'));
  const before = { reservationsModel: ['getById', 'update'], pricing: ['calculatePrice'] };
  assert.deepEqual(coreRemovals(before, { reservationsModel: ['getById'], pricing: ['calculatePrice'] }, { sdkBefore: '1.2.0', sdkAfter: '1.3.0' }),
    ['reservationsModel#update']);
  assert.deepEqual(coreRemovals(before, { reservationsModel: ['getById', 'update'] }, { sdkBefore: '1.2.0', sdkAfter: '1.2.1' }), ['pricing']);
  assert.deepEqual(coreRemovals(before, {}, { sdkBefore: '1.2.0', sdkAfter: '2.0.0' }), [], 'a major bump is the way to remove');
  assert.deepEqual(coreRemovals(before, { ...before, qonto: ['qontoService'] }, { sdkBefore: '1.2.0', sdkAfter: '1.2.0' }), [], 'adding is free');
});

test('rule 35 — the contract records names only, nothing it would claim to check about signatures', () => {
  for (const [name, exported] of Object.entries(CONTRACT)) {
    assert.ok(Array.isArray(exported) && exported.every((k) => typeof k === 'string'), name);
  }
});

test('rule 26 of sas-departure-recap-server-side — the departure planner joins the contract, additively (SDK 2.1.0 still satisfies ^2.0.0)', () => {
  ['planDepartureSas', 'resolveSasDepartureItems', 'buildDepartureSeed'].forEach((name) => {
    assert.ok(CONTRACT.reservationsModel.includes(name), name);
    assert.equal(typeof sdk.coreModule('reservationsModel')[name], 'function', name);
  });
  assert.equal(sdk.coreModule('departureSasPlan'), require('../utils/departureSasPlan'));
  assert.ok(CONTRACT.departureSasPlan.includes('recalledArrivalAfter'));
  const { SDK_VERSION } = require('../plugins/sdk/version');
  const { satisfies } = require('../utils/semverRange');
  assert.match(SDK_VERSION, /^2\./);
  assert.equal(satisfies(SDK_VERSION, '^2.0.0'), true);
});
