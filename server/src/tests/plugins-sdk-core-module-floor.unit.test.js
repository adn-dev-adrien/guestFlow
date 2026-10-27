// specs/plugins-phase-1-sdk.md, SDK 2.5.0 note (audit 2026-10-27) — a plugin may only reach a core
// module, or a name of one, that exists at the FLOOR of the SDK range its manifest declares. The core
// refuses a package whose range the running SDK does not satisfy (phase 4 rule 12), so a plugin that
// declares `^2.0.0` but calls `coreModule('installmentPlan')` (SDK 2.5.0) would load on a 2.4 core and
// crash on its first export. `sdk/coreModuleHistory.json` records what each SDK minor added.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const semver = require('semver');

const CONTRACT = require('../plugins/sdk/coreModules.json');
const HISTORY = require('../plugins/sdk/coreModuleHistory.json');
const { SDK_VERSION } = require('../plugins/sdk/version');
const { readSourceManifest } = require('../plugins/manifest');
const { PLUGIN_IDS } = require('../constants/plugins');

const PLUGINS = path.join(__dirname, '..', 'plugins');

function pluginSources(id) {
  const out = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'tests' && e.name !== 'node_modules') walk(p); return; }
    if (e.name.endsWith('.js')) out.push(fs.readFileSync(p, 'utf8'));
  });
  walk(path.join(PLUGINS, id));
  return out.join('\n');
}

const moduleSince = new Map(HISTORY.baseline.modules.map((m) => [m, HISTORY.baseline.version]));
const namesSince = [];
HISTORY.added.forEach(({ version, modules, names }) => {
  modules.forEach((m) => moduleSince.set(m, version));
  Object.entries(names).forEach(([m, list]) => list.forEach((n) => namesSince.push({ module: m, name: n, version })));
});

test('the history covers exactly the modules of the contract, and names it records exist there', () => {
  assert.deepEqual([...moduleSince.keys()].sort(), Object.keys(CONTRACT).sort(),
    'a module added to coreModules.json must be recorded in coreModuleHistory.json under the SDK minor that ships it');
  namesSince.forEach(({ module, name }) => assert.ok(CONTRACT[module].includes(name), `${module}#${name}`));
  HISTORY.added.forEach(({ version }) => assert.ok(semver.lte(version, SDK_VERSION), `${version} <= SDK ${SDK_VERSION}`));
});

test('every plugin calls only core modules and names that exist at the floor of its sdk range', () => {
  const late = [];
  PLUGIN_IDS.forEach((id) => {
    const src = pluginSources(id);
    const floor = semver.minVersion(readSourceManifest(id).sdk).version;
    const used = new Set([...src.matchAll(/coreModule\('([^']+)'\)/g)].map((m) => m[1]));
    used.forEach((m) => {
      const since = moduleSince.get(m);
      if (since && semver.gt(since, floor)) late.push(`${id} (sdk floor ${floor}) calls coreModule('${m}') of SDK ${since}`);
    });
    namesSince.forEach(({ module, name, version }) => {
      if (used.has(module) && new RegExp(`\\b${name}\\b`).test(src) && semver.gt(version, floor)) {
        late.push(`${id} (sdk floor ${floor}) uses ${module}#${name} of SDK ${version}`);
      }
    });
  });
  assert.deepEqual(late, []);
});

test('the audit case: accounting-export reaches installmentPlan, so it declares SDK 2.5 at least', () => {
  assert.match(pluginSources('accounting-export'), /coreModule\('installmentPlan'\)/);
  assert.equal(semver.minVersion(readSourceManifest('accounting-export').sdk).version, '2.5.0');
});
