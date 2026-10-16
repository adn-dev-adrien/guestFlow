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

test('rule 5: React, the router, MUI and the SDK are externals; icons are bundled', async () => {
  const { classifyClientImport, HOST_MODULES } = await load('build-plugin-packages.mjs');
  const pluginDir = path.join(CLIENT_PLUGINS, 'linen');
  const importer = path.join(pluginDir, 'index.js');
  ['react', 'react/jsx-runtime', 'react-dom', 'react-router', '@mui/material', 'guestflow/sdk'].forEach((m) => assert.ok(HOST_MODULES.includes(m), m));
  assert.deepEqual(classifyClientImport('react', importer, { pluginDir }), { external: 'react' });
  assert.deepEqual(classifyClientImport('@mui/material/styles', importer, { pluginDir }), { external: '@mui/material/styles' });
  assert.deepEqual(classifyClientImport('@mui/icons-material/Add', importer, { pluginDir }), { bundle: true });
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

test('rule 24: `plugin:<id>` bullets go to the core section and to the manifest of that version', async () => {
  const { extractPluginLines, foldIntoManifests } = await load('build-changelog.mjs');
  const { byKey, pluginLines } = extractPluginLines({
    fixed: ['- plugin:linen Le stock des serviettes\n  se lit sur la bonne semaine.', '- A core fix.'],
    added: ['- plugin:linen — Une alerte de rupture.'],
  });
  assert.deepEqual(byKey.fixed, ['- **Plugin `linen`** — Le stock des serviettes se lit sur la bonne semaine.', '- A core fix.']);
  assert.deepEqual(pluginLines, { linen: ['Le stock des serviettes se lit sur la bonne semaine.', 'Une alerte de rupture.'] });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-fold-'));
  fs.mkdirSync(path.join(dir, 'linen'));
  fs.writeFileSync(path.join(dir, 'linen', 'manifest.json'), JSON.stringify({ id: 'linen', version: '1.0.1', changelog: { '1.0.0': ['Première.'] } }));
  assert.deepEqual(foldIntoManifests(pluginLines, { pluginsDir: dir }), ['linen@1.0.1']);
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'linen', 'manifest.json'), 'utf8'));
  assert.deepEqual(m.changelog['1.0.1'], pluginLines.linen);
  assert.deepEqual(m.changelog['1.0.0'], ['Première.']);
  assert.throws(() => foldIntoManifests({ ghost: ['x'] }, { pluginsDir: dir }), /unknown plugin "ghost"/);
});

test('rule 23: the release workflow builds the packages, checks the versions and ships plugins-dist', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
  assert.match(workflow, /node scripts\/check-plugin-versions\.mjs/);
  assert.match(workflow, /node scripts\/build-plugin-packages\.mjs/);
  assert.match(workflow, /plugins-dist\/\*\.tgz/);
  const releaseSh = fs.readFileSync(path.join(ROOT, 'release.sh'), 'utf8');
  assert.match(releaseSh, /plugins-dist/);
});
