// specs/plugins-phase-4-registry.md rules 4, 5, 23, 24 and P26 — the release tooling of the plugin
// packages: the build's import boundary and host rewrite (scripts/build-plugin-packages.mjs), the
// version check (scripts/check-plugin-versions.mjs) and the plugin changelog lines folded into the
// manifests (scripts/build-changelog.mjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const load = (name) => import(pathToFileURL(path.join(ROOT, 'scripts', name)).href);
const SERVER_PLUGINS = path.join(ROOT, 'server', 'src', 'plugins');
const CLIENT_PLUGINS = path.join(ROOT, 'client', 'src', 'plugins');

test('rule 4: a server require reaching the SDK becomes `guestflow/sdk`; one leaving the folder fails', async () => {
  const { rewriteServerRequires } = await load('build-plugin-packages.mjs');
  const pluginDir = path.join(SERVER_PLUGINS, 'website-booking');
  const file = path.join(pluginDir, 'controllers', 'x.js');
  const out = rewriteServerRequires(
    "const sdk = require('../../sdk'); const t = require('../../sdk/testing'); const own = require('../settings');\nconst e = require('express'); const c = require('node:crypto');",
    { file, pluginDir, dependencies: ['express'] },
  );
  assert.deepEqual(out.errors, []);
  assert.match(out.code, /require\('guestflow\/sdk'\)/);
  assert.match(out.code, /require\('guestflow\/sdk\/testing'\)/);
  assert.match(out.code, /require\('\.\.\/settings'\)/);
  const bad = rewriteServerRequires("require('../../../models/settingsModel'); require('left-pad')", { file, pluginDir, dependencies: ['express'] });
  assert.equal(bad.errors.length, 2);
});

test('rule 4: a client import of the SDK is external; a core file outside the SDK fails the build', async () => {
  const { classifyClientImport } = await load('build-plugin-packages.mjs');
  const pluginDir = path.join(CLIENT_PLUGINS, 'linen');
  const importer = path.join(pluginDir, 'LinenStockPage.jsx');
  assert.deepEqual(classifyClientImport('../sdk', importer, { pluginDir }), { external: 'guestflow/sdk' });
  assert.deepEqual(classifyClientImport('../sdk/ui', importer, { pluginDir }), { external: 'guestflow/sdk/ui' });
  assert.deepEqual(classifyClientImport('./planningDays', importer, { pluginDir }), { bundle: true });
  assert.ok(classifyClientImport('../../api', importer, { pluginDir }).error);
  assert.ok(classifyClientImport('dayjs', importer, { pluginDir }).error);
});

test('rules 5, 26: React, the router, MUI, emotion and the SDK stay the host\'s, whoever imports them; icons are bundled', async () => {
  const { classifyClientImport, HOST_MODULES } = await load('build-plugin-packages.mjs');
  const pluginDir = path.join(CLIENT_PLUGINS, 'linen');
  const importer = path.join(pluginDir, 'index.js');
  const icon = path.join(ROOT, 'client', 'node_modules', '@mui', 'icons-material', 'utils', 'createSvgIcon.mjs');
  ['react', 'react/jsx-runtime', '@mui/material', 'guestflow/sdk'].forEach((m) => assert.ok(HOST_MODULES.includes(m), m));
  assert.deepEqual(classifyClientImport('react', importer, { pluginDir }), { external: 'react' });
  assert.deepEqual(classifyClientImport('@mui/material/styles', importer, { pluginDir }), { external: '@mui/material/styles' });
  assert.deepEqual(classifyClientImport('@mui/icons-material/Add', importer, { pluginDir }), { bundle: true });
  // An icon's own import of MUI is the host's too: one MUI, one theme (review M1).
  assert.deepEqual(classifyClientImport('@mui/material/SvgIcon', icon, { pluginDir }), { external: '@mui/material/SvgIcon' });
  assert.deepEqual(classifyClientImport('@emotion/react', icon, { pluginDir }), { external: '@emotion/react' });
  assert.deepEqual(classifyClientImport('@mui/system', icon, { pluginDir }), { external: '@mui/system' });
});

test('rule 26: a bundle that carries MUI, emotion or React code fails the build', async () => {
  const { strayBundledModules } = await load('build-plugin-packages.mjs');
  assert.deepEqual(strayBundledModules([
    '/r/client/src/plugins/linen/index.js',
    '/r/client/node_modules/@mui/icons-material/Add.mjs',
    '/r/client/node_modules/@mui/system/esm/styled.js',
    '/r/client/node_modules/@emotion/react/dist/x.js',
  ]), ['/r/client/node_modules/@mui/system/esm/styled.js', '/r/client/node_modules/@emotion/react/dist/x.js']);
});

test('rule 26: the host exposes exactly the names the plugins import, and the build checks it', async () => {
  const { clauseNames, missingHostExports, hostModulesSource, HOST_EXPORTS } = await load('build-plugin-packages.mjs');
  assert.deepEqual(clauseNames('R,{useState as s, Fragment}'), ['default', 'useState', 'Fragment']);
  assert.deepEqual(clauseNames('* as M'), ['*']);
  const usage = { '@mui/material': new Set(['Box', 'Button']), react: new Set(['*']) };
  assert.deepEqual(missingHostExports(usage, { '@mui/material': ['Box'], react: '*' }), ['@mui/material#Button']);
  assert.deepEqual(missingHostExports({ '@mui/material': new Set(['*']) }, { '@mui/material': ['Box'] }), ['@mui/material (whole namespace)']);
  const { js, json } = hostModulesSource(usage);
  assert.deepEqual(json['@mui/material'], ['Box', 'Button']);
  assert.match(js, /import \{ Box as M\d_Box, Button as M\d_Button \} from '@mui\/material';/);
  assert.doesNotMatch(js, /import \* as \w+ from '@mui\/material'/);
  // What is committed matches what the twelve-plus plugins import (the build refuses otherwise).
  assert.ok(Array.isArray(HOST_EXPORTS['@mui/material']) && HOST_EXPORTS['@mui/material'].includes('Box'));
  assert.equal(HOST_EXPORTS.react, '*');
});

test('rule 26: a bundle checks, as it loads, that the host exposes every name it takes', async () => {
  const { rewriteHostImports } = await load('build-plugin-packages.mjs');
  const code = 'import{Box as b}from"@mui/material";';
  const out = rewriteHostImports(code, [{ n: '@mui/material', ss: 0, se: code.length, d: -1 }], { hostModules: ['@mui/material'] });
  assert.match(out, /__gfHost\("@mui\/material",\["Box"\]\)/);
  // eslint-disable-next-line no-new-func
  const run = (modules) => new Function('globalThis', `${out.replace('const{Box:b}', 'var{Box:b}')};return b;`)({ __GUESTFLOW_HOST__: { modules } });
  assert.equal(run({ '@mui/material': { Box: 'B' } }), 'B');
  assert.throws(() => run({ '@mui/material': {} }), /n’expose pas Box/);
});

test('rule 27: the package content hash ignores tar and timestamps; a changed content under the same version is refused', async () => {
  const { contentHash } = await load('build-plugin-packages.mjs');
  const { findContentViolations } = await load('check-plugin-versions.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-hash-'));
  fs.mkdirSync(path.join(dir, 'client'));
  fs.writeFileSync(path.join(dir, 'client', 'index.js'), 'a');
  fs.writeFileSync(path.join(dir, 'manifest.json'), '{"version":"1.0.0"}');
  const h1 = contentHash(dir);
  fs.writeFileSync(path.join(dir, 'manifest.json'), '{"version":"1.0.0","x":1}');
  assert.equal(contentHash(dir), h1, 'the manifest is not content');
  fs.writeFileSync(path.join(dir, 'client', 'index.js'), 'b');
  assert.notEqual(contentHash(dir), h1);
  assert.deepEqual(findContentViolations(
    { linen: { version: '1.0.0', contentHash: 'b' }, neat: { version: '1.1.0', contentHash: 'c' } },
    { linen: { version: '1.0.0', contentHash: 'a' }, neat: { version: '1.0.0', contentHash: 'd' } },
  ), [{ id: 'linen', version: '1.0.0' }]);
});

test('rule 28: a changed plugin is bumped in its own PR, with its French changelog lines', async () => {
  const { missingChangelog } = await load('check-plugin-versions.mjs');
  const headManifests = {
    linen: { version: '1.0.1', changelog: { '1.0.1': ['Le stock se lit sur la bonne semaine.'] } },
    neat: { version: '1.0.1', changelog: { '1.0.0': ['Première.'] } },
  };
  assert.deepEqual(missingChangelog({ changed: new Set(['linen', 'neat']), baseVersions: { linen: '1.0.0', neat: '1.0.0' }, headManifests }),
    [{ id: 'neat', version: '1.0.1' }]);
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'unit-tests.yml'), 'utf8');
  assert.match(workflow, /node scripts\/check-plugin-versions\.mjs --base "origin\/\$\{\{ github\.base_ref \}\}"/);
  const skill = fs.readFileSync(path.join(ROOT, '.claude', 'skills', 'guestflow-release', 'SKILL.md'), 'utf8');
  assert.doesNotMatch(skill, /git add server\/src\/plugins/);
});

test('rule 5: every host import is rewritten to a read of the host modules; a stray bare import fails', async () => {
  const { rewriteHostImports } = await load('build-plugin-packages.mjs');
  const code = 'import R,{useState as s}from"react";import*as M from"@mui/material";import{jsx as j}from"react/jsx-runtime";import{x}from"./chunk.js";';
  const at = (needle) => code.indexOf(needle);
  const imports = [
    { n: 'react', ss: at('import R'), se: at(';import*as M') + 1, d: -1 },
    { n: '@mui/material', ss: at('import*as M'), se: at(';import{jsx') + 1, d: -1 },
    { n: 'react/jsx-runtime', ss: at('import{jsx'), se: at(';import{x}') + 1, d: -1 },
    { n: './chunk.js', ss: at('import{x}'), se: code.length, d: -1 },
  ];
  const out = rewriteHostImports(code, imports);
  assert.match(out, /^const __gfHost=/);
  assert.match(out, /const R=__gfm\d\.default!==undefined\?__gfm\d\.default:__gfm\d/);
  assert.match(out, /const\{useState:s\}=__gfm\d/);
  assert.match(out, /const M=__gfm\d/);
  assert.match(out, /const\{jsx:j\}=__gfm\d/);
  assert.match(out, /import\{x\}from"\.\/chunk\.js"/);
  assert.throws(() => rewriteHostImports('import d from"dayjs";', [{ n: 'dayjs', ss: 0, se: 21, d: -1 }]), /bare import "dayjs"/);
});

test('rule 5: a chunk that re-exports a host name hands the host module on, never a copy', async () => {
  const { rewriteHostImports } = await load('build-plugin-packages.mjs');
  // What @mui/icons-material 9.5 makes of `createSvgIcon` once Vite splits it into a shared chunk.
  const code = 'export { createSvgIcon as t } from "@mui/material/SvgIcon";';
  const usage = {};
  const out = rewriteHostImports(code, [{ n: '@mui/material/SvgIcon', ss: 0, se: code.length, d: -1 }], { usage });
  assert.match(out, /__gfHost\("@mui\/material\/SvgIcon",\["createSvgIcon"\]\)/);
  assert.match(out, /export\{__gfx\d_0 as t\}/);
  assert.doesNotMatch(out, /from"@mui|from "@mui/);
  assert.deepEqual([...usage['@mui/material/SvgIcon']], ['createSvgIcon']);
});

test('rule 23, P26: a plugin that changed since the previous tag must carry a new version', async () => {
  const { findViolations, pluginsOf, bumpPatch } = await load('check-plugin-versions.mjs');
  const changed = pluginsOf([
    'server/src/plugins/linen/routes.js',
    'client/src/plugins/neat/SettingsNeatSection.jsx',
    'server/src/plugins/sas/tests/x.unit.test.js',
    'client/src/plugins/sas/__tests__/a.test.jsx',
    'server/src/plugins/sdk/index.js',
  ]);
  assert.deepEqual([...changed].sort(), ['linen', 'neat']);
  assert.deepEqual(findViolations({
    changed, baseVersions: { linen: '1.0.0', neat: null }, headVersions: { linen: '1.0.0', neat: '1.0.0' },
  }), [{ id: 'linen', version: '1.0.0' }]);
  assert.deepEqual(findViolations({ changed, baseVersions: { linen: '1.0.0' }, headVersions: { linen: '1.0.1' } }), []);
  assert.equal(bumpPatch('1.2.9'), '1.2.10');
});

test('rules 24, 28: `plugin:<id>` bullets name the plugin in the core section; the fold edits no manifest', async () => {
  const { extractPluginLines } = await load('build-changelog.mjs');
  const { byKey } = extractPluginLines({
    fixed: ['- plugin:linen The towel stock\n  is read on the right week.', '- A core fix.'],
    added: ['- plugin:linen — A shortage alert.'],
  });
  assert.deepEqual(byKey.fixed, ['- **Plugin `linen`** — The towel stock is read on the right week.', '- A core fix.']);
  assert.deepEqual(byKey.added, ['- **Plugin `linen`** — A shortage alert.']);
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'build-changelog.mjs'), 'utf8');
  assert.doesNotMatch(source, /manifest\.json/);
});

test('rule 23: the release workflow builds the packages, checks the versions and ships plugins-dist', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
  assert.match(workflow, /node scripts\/check-plugin-versions\.mjs/);
  assert.match(workflow, /node scripts\/build-plugin-packages\.mjs/);
  assert.match(workflow, /plugins-dist\/\*\.tgz/);
  const releaseSh = fs.readFileSync(path.join(ROOT, 'release.sh'), 'utf8');
  assert.match(releaseSh, /plugins-dist/);
});

// ---------- second review (2026-10-18): rules 27, 33 ----------

test('rule 27: the package archive is reproducible — same files, same bytes — and tar reads it', async () => {
  const { reproducibleTgz } = await load('build-plugin-packages.mjs');
  const { execFileSync } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-tgz-'));
  fs.mkdirSync(path.join(dir, 'client', 'chunks'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'server'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), '{}');
  fs.writeFileSync(path.join(dir, 'server', 'index.js'), 'module.exports = {};');
  fs.writeFileSync(path.join(dir, 'client', 'index.js'), 'export default {};');
  const long = `${'a'.repeat(70)}-${'b'.repeat(20)}.js`; // path over 100 bytes: the ustar prefix field
  fs.writeFileSync(path.join(dir, 'client', 'chunks', long), 'x');
  const one = reproducibleTgz(dir, ['manifest.json', 'server', 'client']);
  fs.utimesSync(path.join(dir, 'server', 'index.js'), new Date(), new Date(2001, 1, 1));
  const two = reproducibleTgz(dir, ['server', 'client', 'manifest.json']);
  assert.ok(one.equals(two));
  const file = path.join(dir, 'p.tgz');
  fs.writeFileSync(file, one);
  const names = execFileSync('tar', ['-tzf', file], { encoding: 'utf8' }).split('\n').filter(Boolean);
  assert.ok(names.includes('server/index.js') && names.includes(`client/chunks/${long}`));
});

test('rule 49 (withdraws the reuse of rule 27): a rebuild that differs from the published package fails, and the published one is never shipped again', async () => {
  const { execFileSync, spawnSync } = require('child_process');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-reuse-'));
  const pack = (dir, contentHash, file = 'index.js') => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-reuse-src-'));
    fs.writeFileSync(path.join(src, 'manifest.json'), JSON.stringify({ id: 'linen', version: '1.0.0', contentHash }));
    fs.writeFileSync(path.join(src, file), contentHash === 'a'.repeat(64) ? 'EVIL' : 'GOOD');
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('tar', ['-czf', path.join(dir, 'linen-1.0.0.tgz'), '-C', src, 'manifest.json', file], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  };
  pack(path.join(work, 'built'), 'b'.repeat(64));
  pack(path.join(work, 'prev'), 'a'.repeat(64));
  const before = fs.readFileSync(path.join(work, 'built', 'linen-1.0.0.tgz'));
  for (const extra of [[], ['--previous-tag', 'HEAD']]) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-plugin-versions.mjs'), '--built', path.join(work, 'built'), '--previous', path.join(work, 'prev'), ...extra], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /linen 1\.0\.0: the package differs/);
  }
  assert.ok(fs.readFileSync(path.join(work, 'built', 'linen-1.0.0.tgz')).equals(before), 'the built package is untouched');
  assert.equal(fs.existsSync(path.join(work, 'built', 'SHA256SUMS')), false);
});

test('rule 33: the host module list only grows, and the SDK is exposed whole', async () => {
  const { hostRemovals } = await load('check-plugin-versions.mjs');
  const { hostModulesSource, HOST_EXPORTS } = await load('build-plugin-packages.mjs');
  assert.deepEqual(hostRemovals({ '@mui/material': ['Box', 'Card'], 'react-router': ['Link'] }, { '@mui/material': ['Box'] }),
    ['@mui/material#Card', 'react-router']);
  assert.deepEqual(hostRemovals({ 'guestflow/sdk': ['api'] }, { 'guestflow/sdk': '*' }), []);
  const { json } = hostModulesSource({ '@mui/material': new Set(['Box']) }, { '@mui/material': ['Card'] });
  assert.deepEqual(json['@mui/material'], ['Box', 'Card'], '--write-host keeps what was there');
  assert.equal(HOST_EXPORTS['guestflow/sdk'], '*');
  assert.equal(HOST_EXPORTS['guestflow/sdk/ui'], '*');
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
  assert.doesNotMatch(workflow, /--previous-tag/);
  assert.match(fs.readFileSync(path.join(ROOT, '.claude', 'skills', 'guestflow-release', 'SKILL.md'), 'utf8'), /--built plugins-dist --previous prev-dist/);
});
