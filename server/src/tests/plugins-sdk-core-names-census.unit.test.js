// specs/plugins-phase-4-registry.md rule 35, reading of 2026-11-05 (audit R24-P2) — the contract lists the names a plugin
// reads, not only the modules it reaches. Every name a plugin takes from `coreModule('m')` (destructured, read as
// `coreModule('m').x`, or through a variable holding the module) is in `coreModules.json` under `m`; otherwise a core change
// could remove it with no guard and an installed package would read `undefined`. A second-level read
// (`coreModule('qonto').qontoService.x`) belongs to the object it is read from, not to the contract.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const CONTRACT = require('../plugins/sdk/coreModules.json');

const PLUGINS = path.join(__dirname, '..', 'plugins');
const MODULE = String.raw`(?:[\w.]+\.)?coreModule\('([^']+)'\)`;
const names = (list) => list.split(',').map((part) => part.trim().split(/[:=\s]/)[0]).filter((name) => /^\w+$/.test(name));

/** → [[file, module, name]] for every name the source reads from a core module. */
function readsOf(file, source) {
  const out = [];
  for (const m of source.matchAll(new RegExp(String.raw`(?:const|let|var)\s*\{([^}]+)\}\s*=\s*${MODULE}\s*(?=[;\n,)])`, 'g'))) {
    names(m[1]).forEach((name) => out.push([file, m[2], name]));
  }
  for (const m of source.matchAll(new RegExp(String.raw`${MODULE}\.(\w+)`, 'g'))) out.push([file, m[1], m[2]]);
  for (const m of source.matchAll(new RegExp(String.raw`(?:const|let|var)\s+(\w+)\s*=\s*${MODULE}\s*;`, 'g'))) {
    const [, variable, mod] = m;
    for (const u of source.matchAll(new RegExp(String.raw`(?<![\w.])${variable}\.(\w+)`, 'g'))) out.push([file, mod, u[1]]);
    for (const u of source.matchAll(new RegExp(String.raw`\{([^}]+)\}\s*=\s*${variable}\s*;`, 'g'))) names(u[1]).forEach((name) => out.push([file, mod, name]));
  }
  return out;
}

function pluginReads() {
  const out = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['tests', 'sdk', 'node_modules'].includes(e.name)) walk(p); return; }
    if (e.name.endsWith('.js')) out.push(...readsOf(path.relative(PLUGINS, p), fs.readFileSync(p, 'utf8')));
  });
  walk(PLUGINS);
  return out;
}

test('rule 35 (R24-P2) — every name a plugin reads from a core module is in the contract', () => {
  const reads = pluginReads();
  assert.ok(reads.length > 100, `${reads.length} reads: the plugins do take names this way`);
  const outside = [...new Set(reads.filter(([, mod, name]) => CONTRACT[mod] && !CONTRACT[mod].includes(name)).map(([file, mod, name]) => `${mod}#${name} (${file})`))];
  assert.deepEqual(outside, [], 'add the name to sdk/coreModules.json and record it in sdk/coreModuleHistory.json');
});

test('rule 35 (R24-P2) — the census reads the three forms, and leaves a second-level read alone', () => {
  const source = [
    "const { a, b: renamed, c = 1 } = sdk.coreModule('m');",
    "const d = coreModule('m').e;",
    "const mod = ctx.sdk.coreModule('m');",
    'mod.f(); const { g } = mod;',
    "const { qontoSettingsController } = coreModule('qonto').qontoSettingsController;",
    "const { inner } = coreModule('qonto').qontoService;",
  ].join('\n');
  const found = readsOf('x.js', source).map(([, mod, name]) => `${mod}#${name}`).sort();
  assert.deepEqual(found, ['m#a', 'm#b', 'm#c', 'm#e', 'm#f', 'm#g', 'qonto#qontoService', 'qonto#qontoSettingsController']);
});
