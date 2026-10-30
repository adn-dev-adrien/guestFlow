// specs/plugin-removal-resilience.md rules 3, 4, 5, 13, 14, 19, 20 — the removal matrix builds itself from the
// folders, every plugin can be taken out of the tree, and no core test needs a plugin it does not name.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { CATALOG_ORDER } = require('../constants/plugins');
const { listPlugins, missingPlugins, skipWithout } = require('../plugins/sdk/testing');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SERVER_PLUGINS = path.join(ROOT, 'server', 'src', 'plugins');
const CLIENT_PLUGINS = path.join(ROOT, 'client', 'src', 'plugins');
const tool = () => import(path.join(ROOT, 'scripts', 'plugin-removal.mjs'));

test('rule 13: the matrix is the folders — the catalogue and the client know them all', async () => {
  const { listPlugins: matrix, listClientPlugins } = await tool();
  const ids = matrix(ROOT);
  assert.deepEqual(ids, listPlugins());
  const unknown = ids.filter((id) => !CATALOG_ORDER.includes(id));
  assert.deepEqual(unknown, [], 'a plugin folder missing from CATALOG_ORDER (constants/plugins.js)');
  assert.deepEqual(listClientPlugins(ROOT), ids, 'a plugin with a folder on one side only');
});

test('rule 13: every plugin brings its part of the removal seed, or says why it has none', () => {
  listPlugins().forEach((id) => {
    const file = path.join(SERVER_PLUGINS, id, 'tests', 'removalSeed.js');
    assert.ok(fs.existsSync(file), `${id}: tests/removalSeed.js is missing`);
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const mod = require(file);
    if (mod.seed === null) assert.ok(mod.reason, `${id}: seed is null without a reason`);
    else assert.equal(typeof mod.seed, 'function', id);
  });
});

function treeWithIndexes() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-removal-tree-'));
  fs.mkdirSync(path.join(root, 'server', 'src', 'plugins'), { recursive: true });
  fs.mkdirSync(path.join(root, 'client', 'src', 'plugins'), { recursive: true });
  fs.copyFileSync(path.join(SERVER_PLUGINS, 'index.js'), path.join(root, 'server', 'src', 'plugins', 'index.js'));
  fs.copyFileSync(path.join(CLIENT_PLUGINS, 'index.js'), path.join(root, 'client', 'src', 'plugins', 'index.js'));
  listPlugins().forEach((id) => {
    fs.mkdirSync(path.join(root, 'server', 'src', 'plugins', id));
    fs.copyFileSync(path.join(SERVER_PLUGINS, id, 'manifest.json'), path.join(root, 'server', 'src', 'plugins', id, 'manifest.json'));
    fs.mkdirSync(path.join(root, 'client', 'src', 'plugins', id));
    fs.writeFileSync(path.join(root, 'client', 'src', 'plugins', id, 'index.js'), '');
  });
  return root;
}

const camel = (id) => id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

test('rule 13: removing any plugin leaves both module lists parseable and without it', async () => {
  const { removePlugin } = await tool();
  for (const id of listPlugins()) {
    const root = treeWithIndexes();
    try {
      const removed = removePlugin(root, id);
      const server = fs.readFileSync(path.join(root, 'server', 'src', 'plugins', 'index.js'), 'utf8');
      const client = fs.readFileSync(path.join(root, 'client', 'src', 'plugins', 'index.js'), 'utf8');
      const required = [...server.matchAll(/require\('\.\/([a-z-]+)'\)/g)].map((m) => m[1]);
      const imported = [...client.matchAll(/^import (\w+) from '\.\/([a-z-]+)';/gm)];
      const listed = (client.match(/PLUGIN_MODULES = \[([^\]]*)\]/) || [])[1].split(',').map((s) => s.trim()).filter(Boolean);
      removed.forEach((r) => {
        assert.ok(!required.includes(r), `${id}: server list still names ${r}`);
        assert.ok(!imported.some((m) => m[2] === r) && !listed.includes(camel(r)), `${id}: client list still names ${r}`);
        assert.ok(!fs.existsSync(path.join(root, 'server', 'src', 'plugins', r)) && !fs.existsSync(path.join(root, 'client', 'src', 'plugins', r)));
      });
      const kept = listPlugins().filter((p) => !removed.includes(p));
      assert.deepEqual([...required].sort(), kept, `${id}: server list`);
      assert.deepEqual(imported.map((m) => m[2]).sort(), kept, `${id}: client imports`);
      assert.deepEqual(listed.sort(), kept.map(camel).sort(), `${id}: client array`);
      assert.doesNotThrow(() => new Function('module', 'require', server)({ exports: {} }, (p) => ({ id: p })), `${id}: server list parses`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('rule 14: a plugin another one requires goes with it, transitively', { skip: skipWithout(['website-booking', 'google-vacation-rentals']) }, async () => {
  const { removalSet } = await tool();
  const root = treeWithIndexes();
  try {
    assert.deepEqual(removalSet(root, 'website-booking'), ['google-vacation-rentals', 'website-booking']);
    assert.deepEqual(removalSet(root, 'google-vacation-rentals'), ['google-vacation-rentals']);
    const alone = listPlugins().find((id) => !['website-booking', 'google-vacation-rentals'].includes(id));
    assert.deepEqual(removalSet(root, alone), [alone]);
    assert.throws(() => removalSet(root, 'nope'), /unknown plugin/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function testFiles(dir, out = []) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) testFiles(full, out);
    else if (e.name.endsWith('.js')) out.push(full);
  });
  return out;
}

// Code that reads a plugin's folder: a path literal starting at `plugins/<id>` (`../plugins/sas/controller`,
// `plugins/sas/index.js`) or a `path.join(__dirname, …, 'plugins', '<id>')`. Comments, URLs
// (`/plugins/<id>/install`) and the data directory of a package (`<dataDir>/plugins/<id>`) name no file.
function pluginsNamedBy(source, ids) {
  const code = source.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n')
    .replace(/optionalPlugin\(\(\) => require\([^)]*\)\)/g, '');
  return ids.filter((id) => {
    const folder = id.replace(/-/g, '\\-');
    return new RegExp(`['"\`](?:\\.{1,2}/)*(?:src/)?plugins/${folder}(?:/|['"\`])|__dirname[^\\n]*['"]plugins['"],\\s*['"]${folder}['"]`).test(code);
  });
}

const GUARD = /(?:requirePlugins|missingPlugins|skipWithout)\(\[([^\]]*)\]/g;
const guardedIn = (source) => [...source.matchAll(GUARD)].flatMap((m) => [...m[1].matchAll(/'([a-z-]+)'/g)].map((x) => x[1]));

test('rules 3, 4: a test or fixture that reads a plugin folder loads it with optionalPlugin or names it in requirePlugins / skipWithout, unless it lives in that plugin', () => {
  const ids = listPlugins();
  const violations = [];
  const scan = (dir, ownerOf) => testFiles(dir).forEach((file) => {
    const source = fs.readFileSync(file, 'utf8');
    const guarded = guardedIn(source);
    pluginsNamedBy(source, ids).filter((id) => id !== ownerOf(file) && !guarded.includes(id)).forEach((id) => {
      violations.push(`${path.relative(ROOT, file)} → ${id}`);
    });
  });
  scan(path.join(SERVER_PLUGINS, '..', 'tests'), () => null);
  ids.forEach((id) => {
    const dir = path.join(SERVER_PLUGINS, id, 'tests');
    if (fs.existsSync(dir)) scan(dir, () => id);
  });
  assert.deepEqual(violations, []);
});

// What names a plugin without a path: a fake package or manifest that carries a shipped id
// (`{ id: 'linen', serverCode … }`, which the controller only installs while the catalogue lists that id), an
// array of shipped ids that a loop walks, or a path built from a variable (`plugins/${id}`, `readSourceManifest(id)`,
// `path.join(SRC_PLUGINS, id)`). A bare id in a message, a settings key or a fixture row is not matched: a test that
// merely mentions a plugin runs whatever the tree holds. A guard with a variable (`skipWithout([id])`) covers the
// loop that names the variable.
function pluginsNamedByIdentity(source, ids) {
  const code = source.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
  const quoted = (id) => new RegExp(`['"\`]${id.replace(/-/g, '\\-')}['"\`]`);
  const named = new Set();
  const add = (list) => ids.filter((id) => quoted(id).test(list)).forEach((id) => named.add(id));
  if (/pluginPackagesFixture/.test(code)) ids.filter((id) => new RegExp(`\\bid:\\s*${quoted(id).source}`).test(code)).forEach((id) => named.add(id));
  const modVars = [...code.matchAll(/(?:const|let)\s+(\w+)\s*=\s*require\(\s*['"]\.\.?\/plugins['"]\s*\)/g)].map((m) => m[1]);
  const receiver = `(?:require\\(\\s*['"]\\.\\.?/plugins['"]\\s*\\)${modVars.map((v) => `|\\b${v}`).join('')})`;
  ids.forEach((id) => {
    const q = quoted(id).source;
    if (new RegExp(`${receiver}\\s*\\.find\\(\\s*\\(?(\\w+)\\)?\\s*=>\\s*\\1\\.id\\s*===?\\s*${q}`).test(code)
      || new RegExp(`\\.find\\(\\s*\\(?(\\w+)\\)?\\s*=>\\s*\\1\\.id\\s*===?\\s*${q}\\s*\\)\\s*[.\\[]`).test(code)
      || new RegExp(`\\bfindPlugin\\(\\s*${q}`).test(code)
      || new RegExp(`\\bapplyPluginSchema\\(\\s*\\w+\\s*,\\s*${q}`).test(code)) named.add(id);
  });
  return [...named, ...loopsOver(code, ids).filter((l) => !l.guarded).flatMap((l) => l.ids)].filter((id, i, all) => all.indexOf(id) === i);
}

// Loops that walk a list of shipped ids into something that loads a plugin; `guarded` when the loop's own body
// guards its variable (`skipWithout([id])`), not when the file guards some other loop.
const LOADS = /(?<![`'"])require\(|readSourceManifest|applyPluginSchema|registerAll|realSetup|path\.join|copyFileSync/;
function loopsOver(code, ids) {
  const quoted = (id) => new RegExp(`['"\`]${id.replace(/-/g, '\\-')}['"\`]`);
  const lists = [];
  for (const m of code.matchAll(/(?:const|let)\s+(\w+)\s+of\s*\[([^\]]*)\]|\[([^\]]*)\]\s*\.(?:forEach|map|flatMap)\(\s*\(?\s*\[?(\w+)/g)) {
    lists.push({ at: m.index, list: m[2] || m[3], variable: m[1] || m[4] });
  }
  for (const c of code.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*\[([^\]]*)\]/g)) {
    const use = new RegExp(`(?:(?:const|let)\\s+(\\w+)\\s+of\\s+${c[1]}\\b|\\b${c[1]}\\s*\\.\\s*(?:filter|forEach|map|flatMap)\\(\\s*\\(?\\s*\\[?(\\w+))`).exec(code);
    if (use) lists.push({ at: use.index, list: c[2], variable: use[1] || use[2] });
  }
  return lists.filter((l) => LOADS.test(code.slice(l.at, l.at + 400))).map((l) => ({
    ids: ids.filter((id) => quoted(id).test(l.list)),
    guarded: Boolean(l.variable) && new RegExp(`(?:requirePlugins|missingPlugins|skipWithout)\\(\\[?\\s*${l.variable}\\b`).test(code.slice(l.at, l.at + 1500)),
  })).filter((l) => l.ids.length);
}

// A path built from a variable names a plugin folder; it is guarded when that same variable is handed to a guard.
function dynamicLoadVariables(source) {
  const code = source.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
  return [...code.matchAll(/plugins\/\$\{(\w+)\}|path\.join\(\s*(?:SRC_PLUGINS|SERVER_PLUGINS),\s*(\w+)\s*[,)]|'plugins',\s*([A-Za-z_]\w*)\s*[,)]/g)]
    .map((m) => m[1] || m[2] || m[3]).filter((v) => !/^[A-Z_]*DIR$/.test(v))
    .filter((v) => !new RegExp(`(?:requirePlugins|missingPlugins|skipWithout)\\(\\[?\\s*${v}\\b`).test(code));
}
const dynamicPluginLoad = (source) => dynamicLoadVariables(source).length > 0;

test('rule 19 (rules 3, 4): a core test that names a shipped plugin by its id — fake package, loop over ids, lookup, path built from a variable — is guarded', () => {
  const ids = listPlugins();
  const violations = [];
  testFiles(path.join(SERVER_PLUGINS, '..', 'tests')).forEach((file) => {
    const source = fs.readFileSync(file, 'utf8');
    if (path.basename(file) === path.basename(__filename)) return;
    const guarded = guardedIn(source);
    pluginsNamedByIdentity(source, ids).filter((id) => !guarded.includes(id))
      .forEach((id) => violations.push(`${path.relative(ROOT, file)} → ${id}`));
    if (dynamicPluginLoad(source)) violations.push(`${path.relative(ROOT, file)} → a plugin folder named by a variable`);
  });
  assert.deepEqual(violations, []);
});

test('rule 19: the identity guard sees fake packages, loops, lookups and variable paths, ties a variable guard to its own loop, and leaves synthetic manifests of test-only ids alone', () => {
  const ids = ['linen', 'sas', 'neat'];
  assert.deepEqual(pluginsNamedByIdentity("const h = require('./pluginPackagesFixture');\nconst D = { id: 'linen', serverCode: 'x' };", ids), ['linen']);
  assert.deepEqual(pluginsNamedByIdentity("const ROWS = [{ id: 'linen' }];", ids), []);
  assert.deepEqual(pluginsNamedByIdentity("const RELYING = ['linen', 'sas'];\nfor (const id of RELYING) readSourceManifest(id);", ids), ['linen', 'sas']);
  assert.deepEqual(pluginsNamedByIdentity("for (const fact of ['linen']) assert.ok(readiness(fact));", ids), []);
  assert.deepEqual(pluginsNamedByIdentity("const KEPT = ['linen'];\nassert.deepEqual(got, KEPT);", ids), []);
  assert.deepEqual(pluginsNamedByIdentity("for (const id of ['sas', 'x']) { applyPluginSchema(db, id); }", ids), ['sas']);
  assert.deepEqual(pluginsNamedByIdentity("['linen', 'sas'].forEach((id) => require(`./x/${id}`));", ids), ['linen', 'sas']);
  assert.deepEqual(pluginsNamedByIdentity("const R = { id: 'fx-linen' }; assert.equal(row.channel, 'sas');", ids), []);
  assert.deepEqual(pluginsNamedByIdentity("// { id: 'linen' }\nconst m = h.manifest('fx-sas', '1.0.0');", ids), []);
  // the reviewer's probes: each must be flagged
  assert.deepEqual(pluginsNamedByIdentity("for (const p of ['neat']) test(p, { skip: skipWithout([p]) }, () => { require(`../plugins/${p}`); });\nconst h = require('./pluginPackagesFixture');\nconst F = { id: 'linen', serverCode: 'x' };", ids), ['linen']);
  assert.deepEqual(pluginsNamedByIdentity("require('../plugins').find((m) => m.id === 'linen');", ids), ['linen']);
  assert.deepEqual(pluginsNamedByIdentity("const m = findPlugin('sas').manifest;", ids), ['sas']);
  assert.deepEqual(pluginsNamedByIdentity("applyPluginSchema(db, 'neat');", ids), ['neat']);
  assert.deepEqual(pluginsNamedByIdentity("const IDS = ['linen', 'sas'];\nIDS.filter((id) => id !== 'x').forEach(load);\nfunction load(id) {}", ids), []);
  assert.deepEqual(pluginsNamedByIdentity("const IDS = ['linen', 'sas'];\nIDS.filter((id) => id !== 'x').forEach((id) => require(`./x/${id}`));", ids), ['linen', 'sas']);
  assert.deepEqual(pluginsNamedByIdentity("const items = list.find((i) => i.id === 'linen');", ids), []);
  assert.deepEqual(pluginsNamedByIdentity("expect(list.find((p) => p.id === 'neat').plan).toBe(1); const x = list.find((p) => p.id === 'sas');", ids), ['neat']);
  assert.deepEqual(pluginsNamedByIdentity("const MODULES = require('../plugins');\nMODULES.find((m) => m.id === 'sas'); body.find((p) => p.id === 'neat');", ids), ['sas']);
  assert.deepEqual(dynamicLoadVariables("test('a', { skip: skipWithout(['neat']) }, () => {});\nrequire(`../plugins/${id}`);"), ['id']);
  assert.deepEqual(dynamicLoadVariables("const ID = 'linen';\nrequire(path.join(__dirname, '..', 'plugins', ID, 'x'));"), ['ID']);
  assert.deepEqual(dynamicLoadVariables("for (const id of L) { test('a', { skip: skipWithout([id]) }, () => { require(`../plugins/${id}`); }); }"), []);
  assert.deepEqual(dynamicLoadVariables("path.join(SRC_PLUGINS, id, 'manifest.json')"), ['id']);
  assert.deepEqual(dynamicLoadVariables(["require('../plugins/", "linen')"].join('')), []);
  assert.deepEqual(dynamicLoadVariables('path.relative(SRC_PLUGINS, full)'), []);
});

// An optionalPlugin load lets a file load without the plugin; the tests that then fail must say so, or the
// file would be green with a plugin that is absent only because nothing exercised it.
test('rules 3, 4: a file that loads a plugin with optionalPlugin marks the tests that need it', () => {
  const ids = listPlugins();
  const unmarked = [];
  const scan = (dir, ownerOf) => testFiles(dir).filter((file) => file.endsWith('.test.js')).forEach((file) => {
    const source = fs.readFileSync(file, 'utf8');
    const guarded = guardedIn(source);
    [...source.matchAll(/optionalPlugin\(\(\) => require\(['"]([^'"]+)['"]\)\)/g)].forEach((m) => {
      const id = ids.concat(CATALOG_ORDER).find((p) => m[1].includes(`/${p}/`) || m[1].endsWith(`/${p}`));
      if (id && id !== ownerOf(file) && !guarded.includes(id)) unmarked.push(`${path.relative(ROOT, file)} → ${id}`);
    });
  });
  scan(path.join(SERVER_PLUGINS, '..', 'tests'), () => null);
  ids.forEach((id) => {
    const dir = path.join(SERVER_PLUGINS, id, 'tests');
    if (fs.existsSync(dir)) scan(dir, () => id);
  });
  assert.deepEqual(unmarked, []);
});

test('rule 4: a missing plugin is named, a shipped one is not', () => {
  const present = listPlugins()[0];
  assert.deepEqual(missingPlugins([present, 'not-a-plugin']), ['not-a-plugin']);
  assert.deepEqual(missingPlugins(listPlugins()), []);
  assert.equal(skipWithout([present]), false);
  assert.equal(skipWithout([present, 'not-a-plugin']), 'requires not-a-plugin');
});

test('rule 20: the snapshot server port is a flag of the cell, port + 2 by default', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'plugin-removal.mjs'), 'utf8');
  assert.match(source, /const snapshotPort = Number\(flag\('--snapshot-port', String\(port \+ 2\)\)\)/);
  assert.match(source, /SNAPSHOT_PORT: String\(snapshotPort\)/);
  assert.doesNotMatch(source, /SNAPSHOT_PORT: String\(port \+ 2\)/);
});
